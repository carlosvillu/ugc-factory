// Integración EXHAUSTIVA del consumer genérico de `step.execute` + creación de run
// (T0.7b) contra Postgres 16 real (Testcontainers) y pg-boss real (orchestrator.md
// §2, §4). Cubre: creación de run (estados iniciales + encolado atómico de roots),
// camino feliz (los 3 steps pending→queued→running→succeeded EN ORDEN con
// timestamps coherentes), agotamiento de retry_count (fail_rate → failed terminal,
// no bucle infinito), idempotencia (job duplicado sobre step ya no-queued = no-op)
// y estrés de concurrencia (20 runs sin interbloqueos ni estados corruptos).
//
// Cero mocks de BD, cero fake timers (orchestrator.md): pg-boss hace polling con
// su propio pool y el valor está en el lock/tx/NOTIFY reales.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeLogger } from '@ugc/core/observability';
import { createRun, demoRunDefinition } from '@ugc/core/orchestrator';
import type { StepExecutor, TransitionDeps } from '@ugc/core/orchestrator';
import { createTestDatabase, makeProject } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { stepExecuteJob } from '@ugc/core/jobs';
import { PgBoss } from 'pg-boss';
import { createDbPool, ensureQueue, makeWithTransaction } from '@ugc/db';
import { project } from '@ugc/db/schema';
import { bootstrap } from '../../src/bootstrap';
import type { DemoFailDecider } from '../../src/executors/demo';
import { registerStepConsumer } from '../../src/consumers/step-execute';
import { waitFor } from '../helpers';

const silentLogger = makeLogger({ name: 'worker', level: 'silent' });

interface StepStateRow {
  id: string;
  nodeKey: string;
  status: string;
  retryCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

let tdb: TestDatabase;
let boss: PgBoss | undefined;

/** Decisor de fallo determinista: cada step_id falla sus primeros K intentos y
 *  luego triunfa. Per-INTENTO keyed por step (no per-job): un `fail_rate`
 *  determinista para tests sin flakiness (orchestrator.md §, principio 3). */
function failFirstKAttempts(k: number): DemoFailDecider {
  // El decisor de demo recibe la failRate, no el stepId. Los tests que lo usan
  // encolan UN solo step fallón, así que un contador GLOBAL de intentos es
  // determinista: los primeros K intentos fallan, el resto triunfa.
  let seen = 0;
  return () => {
    const shouldFail = seen < k;
    seen += 1;
    return shouldFail;
  };
}

/** Decisor que SIEMPRE falla (agotamiento de retries determinista). */
const alwaysFail: DemoFailDecider = () => true;

async function fetchSteps(runId: string): Promise<StepStateRow[]> {
  const { rows } = await tdb.pool.query<{
    id: string;
    node_key: string;
    status: string;
    retry_count: string;
    started_at: Date | null;
    finished_at: Date | null;
  }>(
    `SELECT id, node_key, status, retry_count, started_at, finished_at
       FROM step_run WHERE run_id = $1 ORDER BY id`,
    [runId],
  );
  return rows.map((r) => ({
    id: r.id,
    nodeKey: r.node_key,
    status: r.status,
    retryCount: Number(r.retry_count),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  }));
}

/** Ordena los 3 steps del DAG de demo por su posición en la cadena (N0→N1→N2),
 *  leída del sufijo del node_key. No se ordena por id: los ULIDs del mismo ms no
 *  son necesariamente monótonos. */
function orderByChain(steps: StepStateRow[]): StepStateRow[] {
  const order = ['demo.sleep.N0', 'demo.sleep.N1', 'demo.sleep.N2'];
  return [...steps].sort((a, b) => order.indexOf(a.nodeKey) - order.indexOf(b.nodeKey));
}

async function seedProject(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  return p!.id;
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:step-execute' });
  // pg-boss crea su schema `pgboss` en el primer start(). Lo materializamos aquí
  // (start+stop de un boss efímero) para que el DELETE de `pgboss.job` del
  // beforeEach no falle antes de que ningún boss haya arrancado en un test.
  const seedBoss = new PgBoss(tdb.connectionString);
  seedBoss.on('error', () => {
    /* irrelevante */
  });
  await seedBoss.start();
  await stopBossAndWait(seedBoss);
});

afterAll(async () => {
  if (boss !== undefined) await stopBossAndWait(boss);
  await tdb.close();
});

afterEach(async () => {
  // Cada test arranca su propio worker (bootstrap): páralo entre tests para no
  // acumular pollers sobre la misma BD.
  if (boss !== undefined) {
    await stopBossAndWait(boss);
    boss = undefined;
  }
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

async function startWorker(demoShouldFail?: DemoFailDecider): Promise<void> {
  const result = await bootstrap({
    logger: silentLogger,
    databaseUrl: tdb.connectionString,
    demoShouldFail,
  });
  boss = result.boss;
  if (boss === undefined) throw new Error('pg-boss no arrancó pese a BD alcanzable');
}

/** withTransaction/TransitionDeps sobre la MISMA BD del test (para crear runs y
 *  disparar transiciones desde el test sin pasar por el worker). Usa un boss
 *  aparte SOLO para encolar (el worker es quien consume). `cleanup` cierra el boss
 *  y su pool ANTES del DROP de la BD (o sus conexiones vivas dan 57P01). */
async function makeDeps(): Promise<{
  deps: TransitionDeps;
  enqueueBoss: PgBoss;
  cleanup: () => Promise<void>;
}> {
  const enqueueBoss = new PgBoss(tdb.connectionString);
  enqueueBoss.on('error', () => {
    /* errores operativos del poller: irrelevantes para estos asserts */
  });
  await enqueueBoss.start();
  await ensureQueue(enqueueBoss, stepExecuteJob);
  const { db, pool } = createDbPool(tdb.connectionString);
  return {
    deps: { withTransaction: makeWithTransaction(db, enqueueBoss) },
    enqueueBoss,
    cleanup: async () => {
      await stopBossAndWait(enqueueBoss);
      await pool.end();
    },
  };
}

describe('createRun: estados iniciales + encolado atómico de roots', () => {
  it('N0(root)→N1→N2: root queda queued+job, dependientes awaiting_deps, sin worker', async () => {
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      const result = await createRun(deps, demoRunDefinition(projectId));

      const steps = await fetchSteps(result.runId);
      expect(steps).toHaveLength(3);
      // La Entrega exige AMBOS estados iniciales: 1 root encolado (`queued`) y 2
      // dependientes en `awaiting_deps`.
      const queued = steps.filter((s) => s.status === 'queued');
      const awaiting = steps.filter((s) => s.status === 'awaiting_deps');
      expect(queued).toHaveLength(1);
      expect(awaiting).toHaveLength(2);
      // El root es N0 (el único sin deps).
      expect(queued[0]!.nodeKey).toBe('demo.sleep.N0');

      // Encolado ATÓMICO: exactamente 1 job step.execute (el root), en la misma tx
      // del INSERT.
      const { rows } = await tdb.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1`,
        [stepExecuteJob.name],
      );
      expect(rows[0]!.n).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('DAG inválido (dep colgante) ⇒ InvalidRunDefinitionError, cero filas', async () => {
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      await expect(
        createRun(deps, {
          projectId,
          nodes: [{ key: 'A', nodeKey: 'demo.sleep', dependsOn: ['NOPE'] }],
        }),
      ).rejects.toThrow(/inexistente|inválida/);
      const { rows } = await tdb.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM step_run`,
      );
      expect(rows[0]!.n).toBe(0);
    } finally {
      await cleanup();
    }
  });
});

describe('consumer: camino feliz end-to-end', () => {
  it('los 3 steps encadenados llegan a succeeded EN ORDEN con timestamps coherentes', async () => {
    await startWorker();
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, demoRunDefinition(projectId, 20));

      await waitFor(
        async () => (await fetchSteps(runId)).every((s) => s.status === 'succeeded'),
        30_000,
        'los 3 steps en succeeded',
        100,
      );

      const steps = await fetchSteps(runId);
      expect(steps).toHaveLength(3);
      for (const s of steps) {
        expect(s.status).toBe('succeeded');
        // Timestamps coherentes: started ≤ finished, ambos presentes.
        expect(s.startedAt).not.toBeNull();
        expect(s.finishedAt).not.toBeNull();
        expect(s.startedAt!.getTime()).toBeLessThanOrEqual(s.finishedAt!.getTime());
      }

      // ORDEN de la cadena N0→N1→N2: cada dependiente ARRANCA después de que su dep
      // TERMINE (la dependencia lo garantiza). Se ordena por node_key (N0/N1/N2),
      // no por id: los ULIDs generados en el mismo ms no son necesariamente
      // monótonos, pero la cadena semántica sí lo es.
      const chain = orderByChain(steps);
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i - 1]!.finishedAt!.getTime()).toBeLessThanOrEqual(
          chain[i]!.startedAt!.getTime(),
        );
      }
    } finally {
      await cleanup();
    }
  });
});

describe('consumer: retry_count agotándose (no bucle infinito)', () => {
  it('un step demo.fail con fail_rate=1 agota max_retries y queda failed terminal', async () => {
    // fail_rate=1 (siempre falla) + decisor que SIEMPRE falla ⇒ el step agota sus
    // reintentos. max_retries por defecto = 3 ⇒ retry_count acaba en 3 y el step
    // queda `failed`, NO reintenta para siempre.
    await startWorker(alwaysFail);
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [{ key: 'F', nodeKey: 'demo.fail', dependsOn: [], config: { failRate: 1 } }],
      });

      await waitFor(
        async () => {
          const [s] = await fetchSteps(runId);
          return s?.status === 'failed' && s.retryCount >= 3;
        },
        30_000,
        'el step failed con retry_count agotado',
        100,
      );

      const [s] = await fetchSteps(runId);
      expect(s!.status).toBe('failed');
      expect(s!.retryCount).toBe(3); // max_retries default

      // No bucle infinito: dado un margen, el step NO vuelve a queued/running.
      await new Promise((r) => setTimeout(r, 1_000));
      const [again] = await fetchSteps(runId);
      expect(again!.status).toBe('failed');
      expect(again!.retryCount).toBe(3);
    } finally {
      await cleanup();
    }
  });

  it('un step demo.fail que falla K<max veces converge a succeeded con retry_count=K', async () => {
    await startWorker(failFirstKAttempts(2));
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [{ key: 'F', nodeKey: 'demo.fail', dependsOn: [], config: { failRate: 1 } }],
      });

      await waitFor(
        async () => (await fetchSteps(runId))[0]?.status === 'succeeded',
        30_000,
        'el step converge a succeeded',
        100,
      );
      const [s] = await fetchSteps(runId);
      expect(s!.status).toBe('succeeded');
      expect(s!.retryCount).toBe(2); // falló 2 veces, reintentó 2, triunfó a la 3ª
    } finally {
      await cleanup();
    }
  });
});

describe('consumer: idempotencia bajo at-least-once', () => {
  it('un job duplicado para un step ya no-queued es un NO-OP seguro (no throw, no corrupción)', async () => {
    // Simula la re-entrega: creamos un run, dejamos que el root llegue a succeeded,
    // y ENCOLAMOS a mano un job step.execute duplicado para ese step ya terminal.
    // El consumer debe no-opear (transition('start') lanza IllegalTransitionError,
    // tratado como no-op) — el step sigue succeeded, el job termina completed.
    await startWorker();
    const { deps, enqueueBoss, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [{ key: 'A', nodeKey: 'demo.sleep', dependsOn: [], config: {} }],
      });
      await waitFor(
        async () => (await fetchSteps(runId))[0]?.status === 'succeeded',
        30_000,
        'el step succeeded',
        100,
      );
      const [s] = await fetchSteps(runId);

      // Job DUPLICADO (redelivery) para el mismo step, ya succeeded (terminal).
      await enqueueBoss.send(stepExecuteJob.name, {
        runId,
        stepId: s!.id,
        nodeKey: s!.nodeKey,
      });

      // Dar tiempo a que el worker lo procese; el step NO debe cambiar de estado.
      await new Promise((r) => setTimeout(r, 1_500));
      const [after] = await fetchSteps(runId);
      expect(after!.status).toBe('succeeded'); // intacto: no-op idempotente
      expect(after!.retryCount).toBe(0);

      // El job duplicado terminó en `completed` (no `failed`): el no-op no es un
      // fallo del job.
      const { rows } = await tdb.pool.query<{ state: string; n: number }>(
        `SELECT state, count(*)::int AS n FROM pgboss.job WHERE name = $1 GROUP BY state`,
        [stepExecuteJob.name],
      );
      const failed = rows.find((r) => r.state === 'failed');
      expect(failed).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

describe('consumer: executor desconocido (error de config permanente)', () => {
  it('un node_key sin executor va a failed TERMINAL sin quemar retry_count', async () => {
    // Un node_key que el registro de bootstrap NO conoce es un bug de config
    // PERMANENTE: reintentar es inútil. El consumer debe llevar el step a `failed`
    // terminal con retry_count=0 (NO failStep, que gatearía retry hasta max_retries
    // = 3 vueltas inútiles + una entrada DLQ por vuelta).
    await startWorker();
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [{ key: 'X', nodeKey: 'no.such.executor', dependsOn: [] }],
      });

      await waitFor(
        async () => (await fetchSteps(runId))[0]?.status === 'failed',
        30_000,
        'el step con executor desconocido queda failed',
        100,
      );

      const [s] = await fetchSteps(runId);
      expect(s!.status).toBe('failed');
      expect(s!.retryCount).toBe(0); // TERMINAL: no se quemó ningún reintento

      // No reintenta: dado un margen, el step NO vuelve a queued/running ni sube
      // retry_count.
      await new Promise((r) => setTimeout(r, 1_000));
      const [again] = await fetchSteps(runId);
      expect(again!.status).toBe('failed');
      expect(again!.retryCount).toBe(0);
    } finally {
      await cleanup();
    }
  });
});

describe('estrés: 20 runs concurrentes (Verificación T0.7b)', () => {
  it('20 runs del DAG de demo completan sin interbloqueos ni estados corruptos', async () => {
    await startWorker();
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      // 20 runs del DAG de demo (3 steps encadenados) creados en paralelo.
      const runs = await Promise.all(
        Array.from({ length: 20 }, () => createRun(deps, demoRunDefinition(projectId, 5))),
      );

      await waitFor(
        async () => {
          const all = await Promise.all(runs.map((r) => fetchSteps(r.runId)));
          return all.every((steps) => steps.every((s) => s.status === 'succeeded'));
        },
        60_000,
        'los 20 runs (60 steps) en succeeded',
        200,
      );

      // Sin estados corruptos: los 60 steps succeeded con timestamps coherentes.
      const all = await Promise.all(runs.map((r) => fetchSteps(r.runId)));
      for (const steps of all) {
        expect(steps).toHaveLength(3);
        for (const s of steps) {
          expect(s.status).toBe('succeeded');
          expect(s.startedAt!.getTime()).toBeLessThanOrEqual(s.finishedAt!.getTime());
        }
        // Cadena N0→N1→N2 respetada dentro de cada run (orden por node_key).
        const chain = orderByChain(steps);
        for (let i = 1; i < chain.length; i++) {
          expect(chain[i - 1]!.finishedAt!.getTime()).toBeLessThanOrEqual(
            chain[i]!.startedAt!.getTime(),
          );
        }
      }
    } finally {
      await cleanup();
    }
  });
});

describe('consumer: éxito del executor + succeed que falla (FIX 1)', () => {
  it('un succeed que falla por INFRA NO re-ejecuta el executor ni dispara failStep', async () => {
    // Invariante FIX 1: éxito del trabajo del executor ⇒ JAMÁS failStep. Si
    // `transition('succeed')` lanza un error de INFRA (no IllegalTransition), el
    // step queda varado en `running` (con su trabajo hecho) y el job va a la DLQ,
    // pero el executor se invocó UNA sola vez y retry_count NO se consumió.
    const workerBoss = new PgBoss(tdb.connectionString);
    workerBoss.on('error', () => {
      /* irrelevante */
    });
    await workerBoss.start();
    await ensureQueue(workerBoss, stepExecuteJob);
    const { db, pool } = createDbPool(tdb.connectionString);

    // Deps reales, pero interceptamos el `succeed`: la primera vez que una
    // transición mueve un step a `succeeded`, lanzamos un error de INFRA simulado
    // (no IllegalTransitionError). El resto de transiciones (start) pasan normales.
    const realDeps: TransitionDeps = { withTransaction: makeWithTransaction(db, workerBoss) };
    const wrappedDeps: TransitionDeps = {
      withTransaction: (fn) =>
        realDeps.withTransaction(async (stores) => {
          const origUpdate = stores.steps.update.bind(stores.steps);
          stores.steps.update = async (id, patch) => {
            if (patch.status === 'succeeded') {
              throw new Error('infra: fallo simulado en el commit del succeed');
            }
            return origUpdate(id, patch);
          };
          return fn(stores);
        }),
    };

    // Executor espía: cuenta invocaciones. Debe llamarse EXACTAMENTE una vez.
    let executorCalls = 0;
    const spyExecutor: StepExecutor = async () => {
      executorCalls += 1;
      await Promise.resolve();
    };

    await registerStepConsumer({
      boss: workerBoss,
      db,
      transitionDeps: wrappedDeps,
      executors: { 'demo.spy': spyExecutor },
      logger: silentLogger,
    });

    // Encolamos el step vía createRun (root queued + job) con deps SIN interceptar
    // (el encolado del root no toca `succeed`).
    const enqueueDeps: TransitionDeps = { withTransaction: makeWithTransaction(db, workerBoss) };
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(enqueueDeps, {
        projectId,
        nodes: [{ key: 'S', nodeKey: 'demo.spy', dependsOn: [], config: {} }],
      });

      // El worker arranca el step (running), el executor triunfa, el succeed falla
      // por infra → el step queda en `running`. Esperamos a ese estado.
      await waitFor(
        async () => (await fetchSteps(runId))[0]?.status === 'running',
        30_000,
        'el step en running (succeed falló por infra)',
        100,
      );

      // Margen para descartar re-ejecución: con retryLimit 0 el job no se
      // re-entrega; el step NO debe volver a queued/failed ni el executor re-correr.
      await new Promise((r) => setTimeout(r, 1_500));
      const [s] = await fetchSteps(runId);
      expect(s!.status).toBe('running'); // varado con el trabajo hecho, no failed
      expect(s!.retryCount).toBe(0); // failStep NUNCA se llamó → retry_count intacto
      expect(executorCalls).toBe(1); // el trabajo se ejecutó UNA sola vez
    } finally {
      await stopBossAndWait(workerBoss);
      await pool.end();
    }
  });
});

async function stopBossAndWait(instance: PgBoss): Promise<void> {
  const stopped = new Promise<void>((resolve) => {
    instance.once('stopped', () => {
      resolve();
    });
  });
  const safety = new Promise<void>((resolve) => setTimeout(resolve, 15_000));
  await instance.stop({ graceful: true, timeout: 10_000 });
  await Promise.race([stopped, safety]);
}
