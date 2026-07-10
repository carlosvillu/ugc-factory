// Tests de integración de las operaciones de checkpoint/skip/cancel (T0.8, §7.1.b/c)
// contra Postgres real (Testcontainers) + pg-boss real. Codifican las cláusulas
// DETERMINISTAS de la Verificación de T0.8 como tests PERMANENTES del gate (regla
// de trabajo 8): approve reanuda, edit crea fila nueva con supersedes_id (la
// antigua superseded) + diff en audit_log, skip resuelve aguas abajo, cancel barre
// el run entero. La decisión de pausa (autopilot/override) se ejercita end-to-end
// en la suite del worker (step-execute).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  approveStep,
  editStep,
  rejectStep,
  skipStep,
  cancelRun,
  IllegalTransitionError,
} from '@ugc/core/orchestrator';
import { makeWithTransaction } from '../../src/index';
import { stepRun } from '../../src/schema/pipeline';
import { auditLog } from '../../src/schema/ops';
import { OrchestratorEnv } from './orchestrator-harness';

const env = new OrchestratorEnv('db:checkpoint');
const tdb = () => env.tdb;
const activeBoss = () => env.activeBoss();
const seed = (steps: Parameters<OrchestratorEnv['seed']>[0]) => env.seed(steps);
const countJobs = (singletonKey?: string) => env.countJobs(singletonKey);
const makeDeps = () => ({ withTransaction: makeWithTransaction(tdb().db, activeBoss()) });

async function rowsOfRun(runId: string) {
  return tdb().db.select().from(stepRun).where(eq(stepRun.runId, runId));
}
async function rowById(id: string) {
  const [row] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));
  return row;
}

beforeAll(() => env.start());
afterAll(() => env.stop());
beforeEach(() => env.reset());

describe('approve: reanuda el run desde un checkpoint (§7.1.b)', () => {
  it('approve sobre waiting_approval → succeeded y PROMUEVE al dependiente a queued (encolado)', async () => {
    // A (waiting_approval, checkpoint) → B (awaiting_deps, depende de A).
    const a = '00000000000000000000000000';
    const b = '00000000000000000000000001';
    const { runId } = await seed([
      { id: a, status: 'waiting_approval', nodeKey: 'N0', isCheckpoint: true },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a] },
    ]);

    await approveStep(makeDeps(), a);

    expect((await rowById(a))!.status).toBe('succeeded');
    // El dependiente arranca: awaiting_deps → queued (§7.1.a) + job encolado.
    expect((await rowById(b))!.status).toBe('queued');
    expect(await countJobs(`${runId}:N1`)).toBe(1);
  });

  it('approve escribe una fila de audit_log (§19.1) con action=approve', async () => {
    const a = '00000000000000000000000010';
    await seed([
      {
        id: a,
        status: 'waiting_approval',
        nodeKey: 'N0',
        isCheckpoint: true,
        outputRefs: { v: 1 },
      },
    ]);

    await approveStep(makeDeps(), a);

    const audit = await tdb().db.select().from(auditLog).where(eq(auditLog.entityId, a));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('approve');
    expect(audit[0]!.entity).toBe('step_run');
    expect(audit[0]!.actor).toBe('user');
  });

  it('approve sobre un step que NO está en waiting_approval → IllegalTransitionError (BD intacta)', async () => {
    const a = '00000000000000000000000020';
    await seed([{ id: a, status: 'succeeded', nodeKey: 'N0' }]);
    await expect(approveStep(makeDeps(), a)).rejects.toBeInstanceOf(IllegalTransitionError);
    expect((await rowById(a))!.status).toBe('succeeded');
    // Ninguna fila de auditoría en el rollback.
    const audit = await tdb().db.select().from(auditLog).where(eq(auditLog.entityId, a));
    expect(audit).toHaveLength(0);
  });
});

describe('edit: invalidación de sub-grafo con supersedes_id (§7.1.c) + audit_log del diff', () => {
  it('edit crea fila NUEVA aguas abajo con supersedes_id; la antigua queda superseded; el diff va a audit_log', async () => {
    // Cadena A(checkpoint, waiting_approval) → B(awaiting_deps) → C(awaiting_deps).
    const a = '00000000000000000000000100';
    const b = '00000000000000000000000101';
    const c = '00000000000000000000000102';
    const { runId } = await seed([
      {
        id: a,
        status: 'waiting_approval',
        nodeKey: 'N0',
        isCheckpoint: true,
        outputRefs: { text: 'guion IA' },
      },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a] },
      { id: c, status: 'awaiting_deps', nodeKey: 'N2', dependsOn: [b] },
    ]);

    await editStep(makeDeps(), a, { text: 'guion EDITADO por el usuario' });

    // El step editado quedó succeeded con el output_refs editado.
    const aRow = await rowById(a);
    expect(aRow!.status).toBe('succeeded');
    expect(aRow!.outputRefs).toEqual({ text: 'guion EDITADO por el usuario' });

    // Las filas ANTIGUAS del sub-grafo (B, C) quedaron superseded (NUNCA reset).
    expect((await rowById(b))!.status).toBe('superseded');
    expect((await rowById(c))!.status).toBe('superseded');

    // Existen filas NUEVAS con el MISMO node_key y supersedes_id apuntando a las
    // antiguas. El invariante clave: NO hay UNIQUE(run_id,node_key), así que
    // conviven la antigua superseded y la nueva.
    const all = await rowsOfRun(runId);
    const newB = all.find((r) => r.nodeKey === 'N1' && r.supersedesId === b);
    const newC = all.find((r) => r.nodeKey === 'N2' && r.supersedesId === c);
    expect(newB).toBeDefined();
    expect(newC).toBeDefined();

    // El nuevo root del sub-grafo (dependiente DIRECTO de A, ya succeeded) arranca:
    // queued + job encolado. El nuevo C aún espera a newB ⇒ awaiting_deps.
    expect(newB!.status).toBe('queued');
    expect(newC!.status).toBe('awaiting_deps');
    // newC depende del id NUEVO de B (remapeado), no del antiguo (superseded).
    expect(newC!.dependsOn).toEqual([newB!.id]);
    expect(await countJobs(`${runId}:N1`)).toBe(1);

    // audit_log: una fila action=edit con el diff IA-vs-editado.
    const audit = await tdb().db.select().from(auditLog).where(eq(auditLog.entityId, a));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('edit');
    expect(audit[0]!.diff).toEqual({
      ai: { text: 'guion IA' },
      edited: { text: 'guion EDITADO por el usuario' },
    });
  });

  it('edit de un checkpoint HOJA (sin dependientes) succeed sin crear filas nuevas, con su audit', async () => {
    const a = '00000000000000000000000110';
    const { runId } = await seed([
      {
        id: a,
        status: 'waiting_approval',
        nodeKey: 'N0',
        isCheckpoint: true,
        outputRefs: { v: 1 },
      },
    ]);

    await editStep(makeDeps(), a, { v: 2 });

    expect((await rowById(a))!.status).toBe('succeeded');
    // Cierre transitivo vacío ⇒ ninguna fila nueva, ningún job.
    expect(await rowsOfRun(runId)).toHaveLength(1);
    expect(await countJobs()).toBe(0);
    const audit = await tdb().db.select().from(auditLog).where(eq(auditLog.entityId, a));
    expect(audit).toHaveLength(1);
  });
});

describe('reject: → rejected sin resolver aguas abajo (§7.1.b)', () => {
  it('reject deja el dependiente varado en awaiting_deps y escribe audit', async () => {
    const a = '00000000000000000000000200';
    const b = '00000000000000000000000201';
    await seed([
      {
        id: a,
        status: 'waiting_approval',
        nodeKey: 'N0',
        isCheckpoint: true,
        outputRefs: { v: 1 },
      },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a] },
    ]);

    await rejectStep(makeDeps(), a);

    expect((await rowById(a))!.status).toBe('rejected');
    // Rama rechazada NO continúa: el dependiente sigue esperando.
    expect((await rowById(b))!.status).toBe('awaiting_deps');
    const audit = await tdb().db.select().from(auditLog).where(eq(auditLog.entityId, a));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe('reject');
  });
});

describe('skip: cuenta como dep resuelta y el run puede completar (trap C)', () => {
  it('skip de un nodo intermedio PROMUEVE a su dependiente (skipped satisface la dep)', async () => {
    // A(succeeded) → B(pending, a saltar) → C(awaiting_deps, depende de B).
    // Al saltar B, C debe avanzar aunque B NO esté succeeded sino skipped.
    const a = '00000000000000000000000300';
    const b = '00000000000000000000000301';
    const c = '00000000000000000000000302';
    const { runId } = await seed([
      { id: a, status: 'succeeded', nodeKey: 'N0' },
      { id: b, status: 'pending', nodeKey: 'N1', dependsOn: [a] },
      { id: c, status: 'awaiting_deps', nodeKey: 'N2', dependsOn: [b] },
    ]);

    await skipStep(makeDeps(), b);

    expect((await rowById(b))!.status).toBe('skipped');
    // C avanza: awaiting_deps → queued + job. Sin el trato de skipped como dep
    // resuelta, C quedaría varado para siempre y el run no completaría.
    expect((await rowById(c))!.status).toBe('queued');
    expect(await countJobs(`${runId}:N2`)).toBe(1);
  });

  it('skip de un nodo con MÚLTIPLES deps: el dependiente solo avanza si TODAS están resueltas', async () => {
    // C depende de A (succeeded) y B (a saltar). Tras saltar B, ambas resueltas ⇒ C avanza.
    const a = '00000000000000000000000310';
    const b = '00000000000000000000000311';
    const c = '00000000000000000000000312';
    await seed([
      { id: a, status: 'succeeded', nodeKey: 'N0' },
      { id: b, status: 'pending', nodeKey: 'N1' },
      { id: c, status: 'awaiting_deps', nodeKey: 'N2', dependsOn: [a, b] },
    ]);

    await skipStep(makeDeps(), b);

    expect((await rowById(c))!.status).toBe('queued'); // A succeeded + B skipped ⇒ ambas OK
  });
});

describe('cancel: barre TODOS los steps no-terminales del run (§7.1, anclaje B)', () => {
  it('cancel detiene el run: cada step no-terminal → cancelled; los terminales intactos', async () => {
    const a = '00000000000000000000000400'; // running
    const b = '00000000000000000000000401'; // awaiting_deps (sobreviviría si solo canceláramos "el actual")
    const c = '00000000000000000000000402'; // queued
    const d = '00000000000000000000000403'; // succeeded (terminal, no se toca)
    const { runId } = await seed([
      { id: a, status: 'running', nodeKey: 'N0' },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a] },
      { id: c, status: 'queued', nodeKey: 'N2' },
      { id: d, status: 'succeeded', nodeKey: 'N3' },
    ]);

    const cancelled = await cancelRun(makeDeps(), runId);

    expect(cancelled).toBe(3); // a, b, c
    expect((await rowById(a))!.status).toBe('cancelled');
    expect((await rowById(b))!.status).toBe('cancelled');
    expect((await rowById(c))!.status).toBe('cancelled');
    // El terminal sigue succeeded: cancel no toca lo ya terminado.
    expect((await rowById(d))!.status).toBe('succeeded');
    // El run queda DETENIDO: ningún step en vuelo.
    const inFlight = (await rowsOfRun(runId)).filter((r) =>
      ['awaiting_deps', 'pending', 'queued', 'running', 'waiting_approval', 'failed'].includes(
        r.status,
      ),
    );
    expect(inFlight).toHaveLength(0);
  });

  it('cancel es idempotente: un run ya cancelado cancela 0 steps la segunda vez', async () => {
    const a = '00000000000000000000000410';
    const { runId } = await seed([{ id: a, status: 'running', nodeKey: 'N0' }]);
    expect(await cancelRun(makeDeps(), runId)).toBe(1);
    expect(await cancelRun(makeDeps(), runId)).toBe(0); // ya cancelled ⇒ nada que cancelar
    expect((await rowById(a))!.status).toBe('cancelled');
  });
});

describe('lock ordering: editStep + cancelRun concurrentes NO se interbloquean (FIX 40P01)', () => {
  it('un descendiente con id < id(E): edit y cancel concurrentes ambos resuelven, sin deadlock', async () => {
    // Escenario del deadlock: E (step editado, checkpoint waiting_approval) tiene un
    // DESCENDIENTE X con id MENOR (los ULID los genera createRun en orden de
    // DEFINICIÓN, no topológico, así que esto es realizable). Si editStep lockeara E
    // antes que su cierre, tomaría E (id mayor) y esperaría X (id menor); cancelRun
    // lockea el run entero por id, tomaría X y esperaría E → 40P01. Con el barrido
    // {E}∪cierre ordenado por id, ambos adquieren en el mismo orden → sin ciclo.
    //   ids: e (mayor) editable; x (menor) descendiente directo de e.
    const e = '00000000000000000000000900'; // E, id MAYOR
    const x = '00000000000000000000000800'; // X, id MENOR, depende de E
    const y = '00000000000000000000000850'; // otro descendiente, depende de X

    // Repetir varias veces: un deadlock por inversión de locks es probabilístico;
    // varias rondas concurrentes lo destaparían casi siempre si existiera.
    for (let round = 0; round < 8; round++) {
      await env.reset();
      const { runId } = await seed([
        {
          id: e,
          status: 'waiting_approval',
          nodeKey: 'N0',
          isCheckpoint: true,
          outputRefs: { v: round },
        },
        { id: x, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [e] },
        { id: y, status: 'awaiting_deps', nodeKey: 'N2', dependsOn: [x] },
      ]);

      // edit y cancel a la vez sobre el mismo run: adquieren locks solapados
      // ({E}∪cierre vs run entero). Ambos deben resolver — allSettled captura
      // cualquier 40P01 como rejection para afirmar que NO ocurre.
      const results = await Promise.allSettled([
        editStep(makeDeps(), e, { v: `edited-${String(round)}` }),
        cancelRun(makeDeps(), runId),
      ]);
      for (const r of results) {
        if (r.status !== 'rejected') continue;
        // Una carrera LEGÍTIMA: si cancel gana el lock de E primero y lo cancela,
        // el `approve_edited` de edit sobre un E ya `cancelled` es
        // IllegalTransitionError — resultado válido, NO un deadlock. Lo toleramos.
        if (r.reason instanceof IllegalTransitionError) continue;
        // Cualquier OTRO fallo (en particular deadlock 40P01) hace fallar el test.
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        expect.fail(`ronda ${String(round)}: operación concurrente falló (¿deadlock?): ${msg}`);
      }
      // Estado coherente: E quedó succeeded (edit ganó su tx) o cancelled (cancel
      // ganó la carrera por E). Ambos desenlaces son válidos; lo que importa es que
      // NINGUNA lanzó deadlock y la BD quedó consistente.
      const eRow = await rowById(e);
      expect(['succeeded', 'cancelled']).toContain(eRow!.status);
    }
  });
});
