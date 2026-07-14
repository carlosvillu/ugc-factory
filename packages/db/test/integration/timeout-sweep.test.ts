// Tests de integración de T0.9 (timeouts, sweeper y retry) contra Postgres real +
// pg-boss real. Prueban las propiedades que el unit de core NO puede: que el
// `start` fija `timeout_at` en la columna, que la query de sweep compara contra el
// `now()` de Postgres, que el filtro `status='running'` es load-bearing (un
// `waiting_approval` NO expira), y que el retry manual + el automático mutan
// retry_count/config bajo el lock. Regresión permanente de la Verificación de T0.9.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeLogger } from '@ugc/core/observability';
import {
  IllegalTransitionError,
  failStep,
  retryStep,
  sweepExpiredSteps,
  timeoutMsFor,
  transition,
} from '@ugc/core/orchestrator';
import { findExpiredRunningStepIds, makeWithTransaction } from '../../src/index';
import { stepRun } from '../../src/schema/pipeline';
import { OrchestratorEnv } from './orchestrator-harness';
import { makeTestLogger } from '@ugc/test-utils';

const env = new OrchestratorEnv('db:timeout-sweep');
const tdb = () => env.tdb;
const activeBoss = () => env.activeBoss();
const seed = (steps: Parameters<OrchestratorEnv['seed']>[0]) => env.seed(steps);
const countJobs = (singletonKey?: string) => env.countJobs(singletonKey);
const deps = () => ({
  withTransaction: makeWithTransaction(tdb().db, activeBoss(), makeTestLogger()),
});
const silentLogger = makeLogger({ name: 'worker', level: 'silent' });
const sweepDeps = () => ({
  ...deps(),
  listExpiredStepIds: () => findExpiredRunningStepIds(tdb().db),
  logger: silentLogger,
});

async function getStep(id: string) {
  const [row] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));
  return row!;
}

beforeAll(() => env.start());
afterAll(() => env.stop());
beforeEach(() => env.reset());

describe('timeout_at por tipo de nodo (Verificación T0.9)', () => {
  it('el start (queued→running) fija timeout_at = now + timeoutFor(nodeKey, config)', async () => {
    const { stepIds } = await seed([{ status: 'queued', nodeKey: 'demo.sleep' }]);
    const id = stepIds[0]!;

    const before = Date.now();
    await transition(deps(), id, 'start');
    const after = Date.now();

    const row = await getStep(id);
    expect(row.status).toBe('running');
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.timeoutAt).toBeInstanceOf(Date);
    // now + timeout del mapa para demo.sleep, con holgura por el tiempo de la tx.
    const expectedMs = timeoutMsFor('demo.sleep', null);
    const at = row.timeoutAt!.getTime();
    expect(at).toBeGreaterThanOrEqual(before + expectedMs - 5);
    expect(at).toBeLessThanOrEqual(after + expectedMs + 5);
  });

  it('config.timeout_ms fuerza un timeout corto (10 s) sobre el mapa del nodo', async () => {
    const { stepIds } = await seed([
      { status: 'queued', nodeKey: 'demo.hang', config: { hang: true, timeout_ms: 10_000 } },
    ]);
    const id = stepIds[0]!;

    const before = Date.now();
    await transition(deps(), id, 'start');

    const row = await getStep(id);
    // 10 s, NO el default del mapa (60 s de demo.hang): el override ganó.
    const at = row.timeoutAt!.getTime();
    expect(at).toBeGreaterThanOrEqual(before + 10_000 - 5);
    expect(at).toBeLessThanOrEqual(before + 10_000 + 1_000);
  });
});

describe('sweep: expira los steps colgados (Verificación T0.9)', () => {
  it('un step running con timeout_at ya pasado se lleva a expired sin intervención', async () => {
    // timeout_at en el PASADO ⇒ ya vencido. El sweep debe expirarlo.
    const { stepIds } = await seed([
      {
        status: 'running',
        nodeKey: 'demo.hang',
        timeoutAt: new Date(Date.now() - 1_000),
      },
    ]);
    const id = stepIds[0]!;

    const ids = await findExpiredRunningStepIds(tdb().db);
    expect(ids).toContain(id);

    const result = await sweepExpiredSteps(sweepDeps());
    expect(result.expired).toBe(1);
    expect((await getStep(id)).status).toBe('expired');
    // expired es terminal ⇒ finished_at fijado.
    expect((await getStep(id)).finishedAt).toBeInstanceOf(Date);
  });

  it('NO expira un step running cuyo timeout_at aún NO ha pasado', async () => {
    const { stepIds } = await seed([
      { status: 'running', nodeKey: 'demo.hang', timeoutAt: new Date(Date.now() + 60_000) },
    ]);
    const id = stepIds[0]!;

    expect(await findExpiredRunningStepIds(tdb().db)).not.toContain(id);
    const result = await sweepExpiredSteps(sweepDeps());
    expect(result.expired).toBe(0);
    expect((await getStep(id)).status).toBe('running');
  });

  it('el filtro status=running es LOAD-BEARING: un waiting_approval con timeout_at pasado NO expira', async () => {
    // Un checkpoint esperando decisión humana conserva el timeout_at que fijó su
    // start; si el sweep lo expirara, un checkpoint caducaría solo. Sólo `running`.
    const { stepIds } = await seed([
      {
        status: 'waiting_approval',
        nodeKey: 'demo.sleep',
        isCheckpoint: true,
        timeoutAt: new Date(Date.now() - 60_000),
      },
    ]);
    const id = stepIds[0]!;

    expect(await findExpiredRunningStepIds(tdb().db)).not.toContain(id);
    const result = await sweepExpiredSteps(sweepDeps());
    expect(result.expired).toBe(0);
    expect((await getStep(id)).status).toBe('waiting_approval');
  });

  it('NO expira un running con timeout_at NULL (nunca se le fijó tope)', async () => {
    const { stepIds } = await seed([{ status: 'running', nodeKey: 'demo.sleep', timeoutAt: null }]);
    const id = stepIds[0]!;
    expect(await findExpiredRunningStepIds(tdb().db)).not.toContain(id);
    expect((await sweepExpiredSteps(sweepDeps())).expired).toBe(0);
    expect((await getStep(id)).status).toBe('running');
  });

  it('barre varios colgados de una pasada y no lanza si no hay ninguno', async () => {
    await seed([
      { status: 'running', nodeKey: 'demo.hang', timeoutAt: new Date(Date.now() - 1_000) },
      { status: 'running', nodeKey: 'demo.hang', timeoutAt: new Date(Date.now() - 2_000) },
    ]);
    const result = await sweepExpiredSteps(sweepDeps());
    expect(result.expired).toBe(2);

    // Segunda pasada: ya no queda nada running ⇒ 0, sin error.
    const again = await sweepExpiredSteps(sweepDeps());
    expect(again.expired).toBe(0);
    expect(again.skipped).toBe(0);
  });
});

describe('retry manual: POST /api/steps/:id/retry (Verificación T0.9)', () => {
  it('reintenta un step failed: failed→queued + re-encolado', async () => {
    const { runId, stepIds } = await seed([{ status: 'failed', nodeKey: 'demo.fail' }]);
    const id = stepIds[0]!;

    await retryStep(deps(), id);

    const row = await getStep(id);
    expect(row.status).toBe('queued');
    expect(row.finishedAt).toBeNull(); // retry limpia finished_at
    // queued ⇒ job encolado (invariante queued = en la cola).
    expect(await countJobs(`${runId}:demo.fail`)).toBe(1);
  });

  it('RESETEA retry_count a 0 aunque estuviera agotado (retry_count >= max_retries)', async () => {
    // Step failed con los reintentos automáticos AGOTADOS.
    const { stepIds } = await seed([
      { status: 'failed', nodeKey: 'demo.fail', retryCount: 3, maxRetries: 3 },
    ]);
    const id = stepIds[0]!;

    await retryStep(deps(), id);

    const row = await getStep(id);
    expect(row.status).toBe('queued');
    // Reset a 0: presupuesto de intentos nuevo (intervención humana).
    expect(row.retryCount).toBe(0);
  });

  it('aplica el patch de config (fail_rate 1→0) en la misma tx antes del re-encolado', async () => {
    const { stepIds } = await seed([
      { status: 'failed', nodeKey: 'demo.fail', config: { failRate: 1 } },
    ]);
    const id = stepIds[0]!;

    await retryStep(deps(), id, { config: { failRate: 0 } });

    const row = await getStep(id);
    expect(row.status).toBe('queued');
    expect(row.config).toEqual({ failRate: 0 });
  });

  it('sin patch de config conserva la config existente', async () => {
    const { stepIds } = await seed([
      { status: 'failed', nodeKey: 'demo.fail', config: { failRate: 1, sleepMs: 5 } },
    ]);
    const id = stepIds[0]!;

    await retryStep(deps(), id);

    expect((await getStep(id)).config).toEqual({ failRate: 1, sleepMs: 5 });
  });

  it('retry sobre un step NO-failed es ilegal (409): un expired no se reintenta', async () => {
    const { stepIds } = await seed([{ status: 'expired', nodeKey: 'demo.hang' }]);
    const id = stepIds[0]!;
    const before = await getStep(id);

    await expect(retryStep(deps(), id)).rejects.toThrow();
    // Rollback total: la fila queda intacta.
    expect(await getStep(id)).toEqual(before);
  });
});

describe('retry AUTOMÁTICO: failStep agota max_retries (confirmación T0.9)', () => {
  it('un step que siempre falla agota max_retries y queda failed terminal', async () => {
    // maxRetries 3, retry_count arranca en 0. Cada failStep aplica fail y, si hay
    // margen, retry (failed→queued + increment). Simulamos que el executor siempre
    // falla: tras cada retry el step vuelve a running (start) y falla de nuevo.
    const { stepIds } = await seed([{ status: 'running', nodeKey: 'demo.fail', maxRetries: 3 }]);
    const id = stepIds[0]!;

    // Intento 0: fail → retry (retry_count 1). Repetimos hasta agotar.
    let outcome = await failStep(deps(), id);
    expect(outcome).toBe('retried');
    expect((await getStep(id)).retryCount).toBe(1);

    // Re-ejecuta: queued→running→fail→retry.
    await transition(deps(), id, 'start');
    outcome = await failStep(deps(), id);
    expect(outcome).toBe('retried');
    expect((await getStep(id)).retryCount).toBe(2);

    await transition(deps(), id, 'start');
    outcome = await failStep(deps(), id);
    expect(outcome).toBe('retried');
    expect((await getStep(id)).retryCount).toBe(3);

    // retry_count (3) >= max_retries (3): el siguiente fallo NO reintenta.
    await transition(deps(), id, 'start');
    outcome = await failStep(deps(), id);
    expect(outcome).toBe('exhausted');
    const row = await getStep(id);
    expect(row.status).toBe('failed');
    expect(row.retryCount).toBe(3);
  });

  it('CARRERA fail-vs-sweeper: failStep sobre un step ya expired lanza IllegalTransitionError', async () => {
    // Escenario real: el sweeper expira un `running` (running→expired, terminal)
    // mientras su executor sigue corriendo; al lanzar el executor, el consumer
    // llama a failStep, que aplica `fail` sobre un step ya `expired` ⇒ transición
    // ilegal. El consumer TRATA esto como no-op idempotente (catch simétrico con el
    // path de éxito). Este test fija la precondición: failStep lanza
    // IllegalTransitionError (no otro error), que es lo que ese catch discrimina.
    const { stepIds } = await seed([{ status: 'expired', nodeKey: 'demo.hang' }]);
    const id = stepIds[0]!;
    const before = await getStep(id);

    await expect(failStep(deps(), id)).rejects.toBeInstanceOf(IllegalTransitionError);
    // Rollback total: la fila `expired` queda intacta.
    expect(await getStep(id)).toEqual(before);
  });
});
