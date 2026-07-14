// Test de CONCURRENCIA dedicado del orquestador (§9.0, db.md §6): el `SELECT …
// FOR UPDATE` es load-bearing pero la Verificación secuencial de T0.7a NO lo
// ejercita. Aquí se prueba directamente: dos `transition()` concurrentes sobre EL
// MISMO step → el segundo BLOQUEA en el lock de fila; al desbloquearse re-lee el
// estado ya committeado y falla limpio (IllegalTransitionError) en vez de pisar
// la transición. Mismo patrón que migrate-lock.test (dos actores + observar la
// espera), aplicado al lock de fila.
//
// La trampa que evita: sin FOR UPDATE (o con READ COMMITTED sin lock) las dos
// transiciones leerían el estado ORIGINAL, ambas lo darían por válido y aplicarían
// la transición dos veces — lost update + doble encolado del dependiente. El lock
// serializa: exactamente UNA aplica.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { eq } from 'drizzle-orm';
import { transition, IllegalTransitionError } from '@ugc/core/orchestrator';
import { makeWithTransaction } from '../../src/index';
import { findDependents, findStepForUpdate } from '../../src/repos/steps.repo';
import { stepRun } from '../../src/schema/pipeline';
import { OrchestratorEnv, type SeedStep } from './orchestrator-harness';
import { makeTestLogger } from '@ugc/test-utils';

// Harness compartido (mismo cableado que orchestrator.test.ts).
const env = new OrchestratorEnv('db:orchestrator-conc');
const tdb = () => env.tdb;
const activeBoss = () => env.activeBoss();
/** Siembra un run con sus steps y devuelve SOLO el runId (esta suite no usa los
 *  ids devueltos por seed: los fija ella misma). */
async function seedRunWith(steps: SeedStep[]): Promise<string> {
  const { runId } = await env.seed(steps);
  return runId;
}

beforeAll(() => env.start());
afterAll(() => env.stop());
beforeEach(() => env.reset());

describe('transition() — carrera sobre el MISMO step: FOR UPDATE serializa', () => {
  it('dos succeed() concurrentes: una aplica, la otra falla limpio; el dependiente se encola UNA vez', async () => {
    const a = '00000000000000000000000000';
    const b = '00000000000000000000000001';
    const runId = await seedRunWith([
      { id: a, status: 'running', nodeKey: 'N0' },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a] },
    ]);
    const deps = { withTransaction: makeWithTransaction(tdb().db, activeBoss(), makeTestLogger()) };

    // Dos transiciones idénticas a la vez sobre el step `a`. La primera en tomar
    // el lock aplica running→succeeded; la segunda BLOQUEA en FOR UPDATE, y al
    // desbloquearse ve `succeeded` (no `running`) → 'succeed' ya no es legal →
    // IllegalTransitionError. No lost update.
    const results = await Promise.allSettled([
      transition(deps, a, 'succeed'),
      transition(deps, a, 'succeed'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1); // exactamente una aplicó
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(IllegalTransitionError);

    // Estado final coherente: a succeeded, b promovido a queued.
    const [aRow] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, a));
    const [bRow] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, b));
    expect(aRow!.status).toBe('succeeded');
    expect(bRow!.status).toBe('queued');

    // El dependiente listo se encoló EXACTAMENTE una vez. Lo que ESTO prueba es la
    // SERIALIZACIÓN por row-lock + revalidación, NO dedup por singletonKey: el
    // perdedor bloquea en el FOR UPDATE de `a`, re-lee `succeeded` y lanza
    // IllegalTransitionError ANTES de llegar a resolveDownstream/encolar — nunca
    // hay un segundo `send`. (La singletonKey es un "belt" de un path que resulta
    // inalcanzable: los dos caminos de encolado — evento `enqueue` sobre `pending`
    // y `resolveDownstream` sobre `awaiting_deps` — son mutuamente excluyentes por
    // estado y se serializan sobre el lock de fila; ver el informe, FIX 6.)
    expect(await env.countJobs(`${runId}:N1`)).toBe(1);
  });

  it('findDependents LOCKEA los dependientes que devuelve (FOR UPDATE)', async () => {
    // Prueba DIRECTA del mecanismo: el FOR UPDATE que findDependents añade sobre
    // los dependientes es la barrera anti lost-wakeup (contrato de
    // StepStore.findDependents). Immune al interleaving: dentro de una tx abierta
    // se llama findDependents(tx, a) —que lockea `b`— y una SEGUNDA sesión intenta
    // lockear `b` con NOWAIT. Con el lock → 55P03 (lock_not_available); sin él, el
    // SELECT plano no toma lock → la sonda tendría éxito y este test fallaría. La
    // consecuencia funcional (b→queued, encolado una vez) ya la cubre el test de
    // resolución aguas abajo; aquí se guarda la línea exacta que el fix añade.
    const a = '00000000000000000000000100';
    const b = '00000000000000000000000101';
    await seedRunWith([
      { id: a, status: 'running', nodeKey: 'N0' },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a] },
    ]);

    await tdb().db.transaction(async (tx) => {
      // findDependents lockea `b` dentro de ESTA tx (que queda abierta).
      const dependents = await findDependents(tx, a);
      expect(dependents.map((d) => d.id)).toContain(b);

      const probe = new Client({ connectionString: tdb().connectionString });
      await probe.connect();
      try {
        // Otra sesión NO puede lockear `b` → 55P03. Sin el FOR UPDATE de
        // findDependents, `b` no estaría lockeado y esta query tendría éxito.
        await expect(
          probe.query('SELECT id FROM step_run WHERE id = $1 FOR UPDATE NOWAIT', [b]),
        ).rejects.toMatchObject({ code: '55P03' });
      } finally {
        await probe.end();
      }
    });
  });

  it('findStepForUpdate LOCKEA la fila PRIMARIA (FOR UPDATE)', async () => {
    // El lock de la fila primaria es el mecanismo MÁS load-bearing de la tarea
    // (elimina la carrera webhook vs consumer, §9.0) y el brief exigía probarlo:
    // sin él, dos transition() sobre el mismo step leerían el estado ORIGINAL y
    // ambas aplicarían → lost update. Misma sonda determinista que findDependents,
    // sobre la fila del propio step: con `.for('update')` → la 2ª sesión no puede
    // lockear (55P03); sin él, el SELECT plano no lockea → la sonda tiene éxito y
    // este test se pone rojo (flip verificado).
    const a = '00000000000000000000000200';
    await seedRunWith([{ id: a, status: 'running', nodeKey: 'N0' }]);

    await tdb().db.transaction(async (tx) => {
      // findStepForUpdate lockea `a` dentro de ESTA tx (que queda abierta).
      const locked = await findStepForUpdate(tx, a);
      expect(locked?.id).toBe(a);

      const probe = new Client({ connectionString: tdb().connectionString });
      await probe.connect();
      try {
        // Otra sesión NO puede lockear `a` → 55P03. Sin el FOR UPDATE de
        // findStepForUpdate, `a` no estaría lockeado y esta query tendría éxito.
        await expect(
          probe.query('SELECT id FROM step_run WHERE id = $1 FOR UPDATE NOWAIT', [a]),
        ).rejects.toMatchObject({ code: '55P03' });
      } finally {
        await probe.end();
      }
    });
  });
});
