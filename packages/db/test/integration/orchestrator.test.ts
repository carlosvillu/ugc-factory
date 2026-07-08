// Tests de integración del orquestador (§9.0) contra Postgres real
// (Testcontainers) + pg-boss real. Prueba las propiedades que el unit test de
// core NO puede: FOR UPDATE de verdad, encolado transaccional (fromDrizzle),
// NOTIFY entregado en COMMIT, y rollback total en ilegal. La secuencia
// legal/ilegal es la Verificación de T0.7a; el resto son sus propiedades
// load-bearing.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { eq } from 'drizzle-orm';
import { transition, IllegalTransitionError, StepNotFoundError } from '@ugc/core/orchestrator';
import { makeWithTransaction } from '../../src/index';
import { stepRun } from '../../src/schema/pipeline';
import { OrchestratorEnv } from './orchestrator-harness';

// Harness compartido (arranque boss + Testcontainers, limpieza, seed). Los
// helpers ligados al entorno se aliasan para no reescribir cada test.
const env = new OrchestratorEnv('db:orchestrator');
const tdb = () => env.tdb;
const activeBoss = () => env.activeBoss();
const seed = (steps: Parameters<OrchestratorEnv['seed']>[0]) => env.seed(steps);
const countJobs = (singletonKey?: string) => env.countJobs(singletonKey);

beforeAll(() => env.start());
afterAll(() => env.stop());
beforeEach(() => env.reset());

describe('transition() contra la BD real — Verificación T0.7a', () => {
  it('secuencia LEGAL: pending→queued→running→succeeded deja estados y timestamps esperados', async () => {
    const { stepIds } = await seed([{ status: 'pending', nodeKey: 'N0' }]);
    const id = stepIds[0]!;
    const deps = { withTransaction: makeWithTransaction(tdb().db, activeBoss()) };

    await transition(deps, id, 'enqueue');
    await transition(deps, id, 'start');
    await transition(deps, id, 'succeed');

    const [row] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));
    expect(row!.status).toBe('succeeded');
    expect(row!.startedAt).toBeInstanceOf(Date); // start la fijó
    expect(row!.finishedAt).toBeInstanceOf(Date); // succeed la fijó
  });

  it('retry (failed→queued) LIMPIA finished_at que fijó el fail (no queda obsoleto)', async () => {
    const { runId, stepIds } = await seed([{ status: 'running', nodeKey: 'N0' }]);
    const id = stepIds[0]!;
    const deps = { withTransaction: makeWithTransaction(tdb().db, activeBoss()) };

    // fail fija finished_at.
    await transition(deps, id, 'fail');
    const [failed] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));
    expect(failed!.status).toBe('failed');
    expect(failed!.finishedAt).toBeInstanceOf(Date);

    // retry lo LIMPIA (null): el run reintentado no arrastra un finished_at previo
    // (que sería < started_at del siguiente intento). La columna DEBE ir a NULL —
    // un hecho de mapeo Drizzle que solo el test de integración prueba.
    await transition(deps, id, 'retry');
    const [retried] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));
    expect(retried!.status).toBe('queued');
    expect(retried!.finishedAt).toBeNull();
    // retry lleva a `queued` ⇒ un job DEBE existir (invariante de FIX 1: queued =
    // en la cola). Cierra el bug queued-sin-job en el camino de reintento.
    expect(await countJobs(`${runId}:N0`)).toBe(1);
  });

  it('transición ILEGAL lanza IllegalTransitionError SIN tocar la BD (rollback total)', async () => {
    const { stepIds } = await seed([{ status: 'succeeded' }]);
    const id = stepIds[0]!;
    const deps = { withTransaction: makeWithTransaction(tdb().db, activeBoss()) };

    const [before] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));

    await expect(transition(deps, id, 'start')).rejects.toBeInstanceOf(IllegalTransitionError);

    const [after] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));
    // Byte a byte idéntica: ni updated_at cambió (validar-antes-de-escribir).
    expect(after).toEqual(before);
    expect(await countJobs()).toBe(0); // cero jobs
  });

  it('step inexistente → StepNotFoundError', async () => {
    const deps = { withTransaction: makeWithTransaction(tdb().db, activeBoss()) };
    await expect(transition(deps, '00000000000000000000000000', 'start')).rejects.toBeInstanceOf(
      StepNotFoundError,
    );
  });
});

describe('transition() — resolución de depends_on aguas abajo (§7.1.a)', () => {
  it('al completar la dep, el dependiente pasa awaiting_deps→queued y se ENCOLA una vez', async () => {
    const a = '00000000000000000000000000';
    const b = '00000000000000000000000001';
    const { runId } = await seed([
      { id: a, status: 'running', nodeKey: 'N0' },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a] },
    ]);
    const deps = { withTransaction: makeWithTransaction(tdb().db, activeBoss()) };

    await transition(deps, a, 'succeed');

    const [depRow] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, b));
    // El dependiente listo queda `queued` (§7.1: queued = en la cola con job).
    expect(depRow!.status).toBe('queued');
    // Encolado con singletonKey `${runId}:${nodeKey}`.
    expect(await countJobs(`${runId}:N1`)).toBe(1);
  });

  it('con deps AÚN pendientes el dependiente NO avanza ni se encola', async () => {
    const a1 = '00000000000000000000000010';
    const a2 = '00000000000000000000000011';
    const b = '00000000000000000000000012';
    await seed([
      { id: a1, status: 'running', nodeKey: 'N0' },
      { id: a2, status: 'pending', nodeKey: 'N0b' },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a1, a2] },
    ]);
    const deps = { withTransaction: makeWithTransaction(tdb().db, activeBoss()) };

    await transition(deps, a1, 'succeed');

    const [depRow] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, b));
    expect(depRow!.status).toBe('awaiting_deps');
    expect(await countJobs()).toBe(0);
  });
});

describe('transition() — encolado transaccional: rollback DES-ENCOLA (jobs.md §5)', () => {
  it('si la tx falla DESPUÉS de encolar, el job NO queda en la cola', async () => {
    const a = '00000000000000000000000020';
    const b = '00000000000000000000000021';
    const { runId } = await seed([
      { id: a, status: 'running', nodeKey: 'N0' },
      { id: b, status: 'awaiting_deps', nodeKey: 'N1', dependsOn: [a] },
    ]);

    // withTransaction que inyecta un fallo TRAS el callback del orquestador
    // (después de encolar + notify, antes del commit): fuerza el ROLLBACK y
    // prueba que el INSERT del job (fromDrizzle) se deshace con la tx.
    const base = makeWithTransaction(tdb().db, activeBoss());
    const failing = <T>(fn: (s: Parameters<Parameters<typeof base>[0]>[0]) => Promise<T>) =>
      base(async (stores) => {
        await fn(stores);
        throw new Error('fallo inyectado post-encolado');
      });

    await expect(transition({ withTransaction: failing }, a, 'succeed')).rejects.toThrow(
      'fallo inyectado',
    );

    // Rollback total: el step a NO quedó succeeded, el dependiente NO avanzó, y
    // — la propiedad clave — el job NO quedó encolado.
    const [aRow] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, a));
    expect(aRow!.status).toBe('running');
    expect(await countJobs(`${runId}:N1`)).toBe(0);
  });
});

describe('transition() — NOTIFY pipeline_events se entrega en COMMIT', () => {
  it('una legal emite su NOTIFY; una ILEGAL (rollback) no — probado por ORDEN, no por reloj', async () => {
    // Dos runs DISTINTOS para que sus payloads (el run_id) sean distinguibles:
    //   - runA: un step en `succeeded` → disparamos una transición ILEGAL
    //     (enqueue desde succeeded) que hace rollback y NO debe emitir NOTIFY.
    //   - runB: un step en `pending` → una transición LEGAL (enqueue) que commitea
    //     y SÍ emite NOTIFY con el id de runB.
    // Orden: primero la ilegal, luego la legal. Como el NOTIFY solo se entrega en
    // COMMIT y en orden de commit, si la ilegal HUBIERA emitido su payload llegaría
    // ANTES que el de la legal. Esperamos a ver el de runB; en ese punto, si el de
    // runA no está, es DETERMINISTA que nunca se emitió — sin sleeps wall-clock.
    const { runId: runA, stepIds: aSteps } = await seed([{ status: 'succeeded', nodeKey: 'N0' }]);
    const { runId: runB, stepIds: bSteps } = await seed([{ status: 'pending', nodeKey: 'N0' }]);
    const idA = aSteps[0]!;
    const idB = bSteps[0]!;
    const deps = { withTransaction: makeWithTransaction(tdb().db, activeBoss()) };

    const listener = new Client({ connectionString: tdb().connectionString });
    await listener.connect();
    const received: string[] = [];
    listener.on('notification', (msg) => {
      if (msg.channel === 'pipeline_events' && msg.payload) received.push(msg.payload);
    });
    await listener.query('LISTEN pipeline_events');

    try {
      // 1) ILEGAL sobre runA: rollback → sin NOTIFY.
      await expect(transition(deps, idA, 'enqueue')).rejects.toBeInstanceOf(IllegalTransitionError);
      // 2) LEGAL sobre runB: commitea → emite NOTIFY con runB.
      await transition(deps, idB, 'enqueue');

      // 3) Esperar a VER el NOTIFY de runB (condition-poll, no sleep fijo).
      await waitUntil(() => received.includes(runB), 2000);
      // 4) Determinista: en el orden de commit, el de runA habría llegado ANTES
      //    que el de runB. Visto runB y ausente runA ⇒ la ilegal nunca emitió.
      expect(received).toContain(runB);
      expect(received).not.toContain(runA);
    } finally {
      await listener.end();
    }
  });
});

/** Sondea `cond` hasta que sea true o venza `ms`. */
async function waitUntil(cond: () => boolean, ms: number): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitUntil: timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}
