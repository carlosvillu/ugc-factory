import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeLogger } from '@ugc/core/observability';
import { noopJob } from '@ugc/core/jobs';
import { type TestDatabase, createTestDatabase } from '@ugc/test-utils';
import type { PgBoss } from 'pg-boss';
import { bootstrap } from '../../src/bootstrap';
import type { FailDecider } from '../../src/consumers/demo-noop';
import { makeJobQueue } from '../../src/job-queue';
import { waitFor } from '../helpers';

// Logger real y silencioso (el comportamiento observable es la tabla pgboss.job,
// no los logs). `level: 'silent'` descarta todo output sin construir un doble.
const silentLogger = makeLogger({ name: 'worker', level: 'silent' });

/**
 * Inyección de fallo DETERMINISTA (jobs.md §4, `fail_times`): cada job.id falla
 * sus primeros K intentos y luego triunfa. K < retryLimit (6) garantiza
 * convergencia — todos acaban `completed` — Y que los retries REALMENTE
 * dispararon (`retry_count == K > 0`). Per-INTENTO keyed por id: un contador en
 * memoria sortea la pregunta de si el handler recibe `retryCount`.
 */
function failFirstKAttempts(k: number): FailDecider {
  const attemptsById = new Map<string, number>();
  return (jobId: string): boolean => {
    const seen = attemptsById.get(jobId) ?? 0;
    attemptsById.set(jobId, seen + 1);
    return seen < k;
  };
}

interface JobStateRow {
  id: string;
  state: string;
  retry_count: number;
}

async function fetchNoopJobs(tdb: TestDatabase): Promise<JobStateRow[]> {
  // pgboss.job está particionada por `name`; se filtra por la cola demo.noop.
  const { rows } = await tdb.pool.query<{ id: string; state: string; retry_count: string }>(
    `SELECT id, state, retry_count FROM pgboss.job WHERE name = $1`,
    [noopJob.name],
  );
  return rows.map((r) => ({ id: r.id, state: r.state, retry_count: Number(r.retry_count) }));
}

let tdb: TestDatabase;
let boss: PgBoss | undefined;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:demo-noop' });
});

afterAll(async () => {
  // Parar pg-boss ANTES de cerrar la BD: si no, el poller sigue consultando una
  // BD que se está borrando y el run cuelga (db-integration.md §8).
  //
  // `await boss.stop()` resuelve cuando ARRANCA el drain, NO cuando pg-boss ha
  // cerrado FÍSICAMENTE su pool propio (verificado en context7: el cierre real se
  // señala con el evento `stopped`, después). pg-boss abrió su pool desde
  // `tdb.connectionString`, así que si `tdb.close()` (que hace DROP DATABASE WITH
  // FORCE) corre antes del cierre físico, FORCE mata esas conexiones vivas y el
  // cliente pg emite un `error` 57P01 sin listener → el run muere tras verde.
  // Esperamos el evento `stopped` para que, al llegar el DROP, pg-boss NO tenga
  // ninguna conexión viva contra la BD.
  if (boss !== undefined) await stopBossAndWait(boss);
  await tdb.close();
});

/**
 * Para pg-boss y espera a que cierre físicamente su pool (`stop()` resuelve en el
 * drain; el cierre real lo señala el evento `stopped`). Timeout de seguridad para
 * no colgar el teardown si `stopped` no llegara.
 */
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

describe('pg-boss operativo en el worker (T0.6)', () => {
  it('encola 10 jobs demo.noop con fallo per-intento y todos convergen a completed con retries', async () => {
    // K=2 fallos por job < retryLimit 6 → convergencia garantizada.
    const K = 2;
    const N = 10;

    const result = await bootstrap({
      logger: silentLogger,
      databaseUrl: tdb.connectionString,
      noopShouldFail: failFirstKAttempts(K),
    });
    boss = result.boss;

    // BD alcanzable ⇒ pg-boss DEBE haber arrancado.
    expect(result.health).toEqual({ ok: true, db: true });
    expect(boss).toBeDefined();
    if (boss === undefined) throw new Error('pg-boss no arrancó pese a BD alcanzable');

    // createBoss debe crear la cola `step.execute` del orquestador (T0.7a): sin
    // ella, un `pending→queued` legal de transition() haría `boss.send` sobre una
    // cola inexistente → LANZA. Guard contra regresión: si se borra la línea de
    // createBoss, este assert (y no solo la Verificación) se pone rojo.
    expect(await boss.getQueue('step.execute')).not.toBeNull();

    // Encolar por el puerto JobQueue REAL del worker (makeJobQueue → boss.send):
    // ejercita el `payload.parse` de la impl y el mismo camino que usará T0.7a,
    // no un `boss.send` crudo del test.
    // `standard`, payload vacío, sin singletonKey/startAfter → sin dependencia de
    // orden: encolado en paralelo.
    const queue = makeJobQueue(boss);
    await Promise.all(
      Array.from({ length: N }, () => queue.enqueue({ job: noopJob, payload: {} })),
    );

    // Esperar a que TODOS lleguen a `completed`. Backoff con retryDelayMax 4s y
    // localConcurrency drenan los 10 jobs en pocos segundos; timeout holgado.
    // pollIntervalMs 100: la BD tarda; no hace falta sondear cada 50ms.
    await waitFor(
      async () => {
        const jobs = await fetchNoopJobs(tdb);
        const completed = jobs.filter((j) => j.state === 'completed');
        return completed.length === N;
      },
      30_000,
      `los ${String(N)} jobs demo.noop en estado completed`,
      100,
    );

    const jobs = await fetchNoopJobs(tdb);
    // 1) TODOS completed: la convergencia (retries dentro del límite) ocurrió.
    expect(jobs).toHaveLength(N);
    expect(jobs.every((j) => j.state === 'completed')).toBe(true);
    // 2) Los retries REALMENTE dispararon: con K=2 fallos, retry_count == 2 en
    //    cada job. Sin esto probaríamos "10 jobs corrieron", no "los retries
    //    funcionan" (la trampa de la Verificación).
    expect(jobs.every((j) => j.retry_count === K)).toBe(true);
    expect(jobs.some((j) => j.retry_count > 0)).toBe(true);
  });
});
