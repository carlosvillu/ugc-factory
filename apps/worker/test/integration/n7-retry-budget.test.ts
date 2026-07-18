// PRESUPUESTO DE RETRY DE LA CARRERA-PERDEDORA DE DEDUP a nivel de STEP (T4.11, MONEY POINT deuda B de
// pass 2a). Es el camino que NI el E2E live de una variante NI el test de SERVICIO
// (`generate-concurrent-dedup.test.ts`) ejercitan:
//   · El E2E live de UNA variante nunca crea dos generaciones idénticas concurrentes → nunca hay loser.
//   · El test de servicio prueba que `runGenerate` LANZA `LoserRaceError` y que un RETRY MANUAL deduplica
//     — pero llama a `runGenerate` a mano, NO recorre el ciclo del consumer.
//
// ESTE test recorre el ciclo COMPLETO del consumer: executor lanza `LoserRaceError` → `failStep` gatea
// `retry_count < max_retries` → re-encola con `startAfter = now + backoff` → el worker re-ejecuta el step.
// Con fal FAKE (el executor es un stub — CERO red, CERO gasto): simula un loser que pierde la carrera K
// veces (el ganador Veo sigue generando) y a la K+1 DEDUPLICA (el ganador ya completó → el executor
// retorna con éxito).
//
// LO QUE FIJA (y el CONTROL NEGATIVO que reintroduce el fallo):
//   · Con `maxRetries = N7_MAX_RETRIES` (80): el presupuesto SOBREVIVE las K derrotas → el step llega a
//     `succeeded` (deduplica). Es la garantía money: «nº de generations = hooks+body+CTA+shots».
//   · CONTROL NEGATIVO — con `maxRetries = 3` (el DEFAULT de BD, el que correría un N7 SIN cablear su
//     `maxRetries`): el mismo loser AGOTA el presupuesto y va a `failed` ESPURIO en vez de deduplicar. Si
//     alguien quitara el `maxRetries: N7_MAX_RETRIES` de la definición del DAG de generación, el N7 real
//     caería EXACTAMENTE en este `failed` — que es lo que este control demuestra.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRun, N7_MAX_RETRIES } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { LoserRaceError } from '@ugc/core/generation';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';

import { seedProject, startWorkerWith, stopBossAndWait, waitFor } from '../helpers';

// Backoff DIMINUTO para el test (producción = 30 s): recorre el MISMO camino (`startAfter` de pg-boss),
// pero sin esperar minutos. El test verifica el PRESUPUESTO (maxRetries), no el valor del backoff.
const TEST_BACKOFF_MS = 50;
// El loser pierde la carrera K veces y deduplica a la K+1 (K < 80, K > 3): así el presupuesto de 80
// sobrevive y el de 3 se agota. Deja margen sobre 3 para que el control negativo falle sin ambigüedad.
const LOSES_BEFORE_WIN = 5;

let tdb: TestDatabase;

async function fetchStep(
  runId: string,
): Promise<{ status: string; retryCount: number } | undefined> {
  const { rows } = await tdb.pool.query<{ status: string; retry_count: string }>(
    'SELECT status, retry_count FROM step_run WHERE run_id = $1 ORDER BY id LIMIT 1',
    [runId],
  );
  const r = rows[0];
  return r ? { status: r.status, retryCount: Number(r.retry_count) } : undefined;
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:n7-retry-budget' });
  // Materializa el schema de pg-boss para que el DELETE del beforeEach no falle. `max:2` (pool acotado):
  // BD compartida entre ficheros paralelos (ver `startWorkerWith`), no saturar `max_connections`.
  const seedBoss = new PgBoss({ connectionString: tdb.connectionString, max: 2 });
  seedBoss.on('error', () => undefined);
  await seedBoss.start();
  await stopBossAndWait(seedBoss);
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project CASCADE');
  await tdb.pool.query('DELETE FROM pgboss.job WHERE name = $1', [stepExecuteJob.name]);
});

let harnessCleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  if (harnessCleanup !== undefined) {
    await harnessCleanup();
    harnessCleanup = undefined;
  }
});

/** Un executor "loser de dedup": lanza `LoserRaceError` (retryable) sus primeras `losesBeforeWin`
 *  ejecuciones (el ganador aún genera) y a la siguiente DEDUPLICA (retorna con éxito). Cuenta las
 *  ejecuciones para el assert del presupuesto. */
function loserExecutor(losesBeforeWin: number): { executor: StepExecutor; calls: () => number } {
  let calls = 0;
  const executor: StepExecutor = async ({ collectOutput }) => {
    calls += 1;
    if (calls <= losesBeforeWin) {
      // El ganador AÚN NO completó → el loser pierde el índice único de dedup y debe REINTENTAR (NO es
      // permanente: envolverlo en PermanentStepError lo mandaría a `failed` y rompería la economía).
      throw new LoserRaceError(`loser de dedup: el ganador aún genera (intento ${String(calls)})`);
    }
    // El ganador completó → deduplica a su asset (aquí: éxito del executor, sin re-submit).
    collectOutput?.({ deduped: true, afterLosses: calls - 1 });
    await Promise.resolve();
  };
  return { executor, calls: () => calls };
}

describe('presupuesto de retry de la carrera-perdedora de dedup a nivel de step (T4.11)', () => {
  it('con maxRetries=N7_MAX_RETRIES el loser SOBREVIVE las derrotas y DEDUPLICA (succeeded)', async () => {
    const { executor, calls } = loserExecutor(LOSES_BEFORE_WIN);
    const { deps, cleanup } = await startWorkerWith(
      tdb,
      { N7d: executor },
      { retryBackoffMs: TEST_BACKOFF_MS },
    );
    harnessCleanup = cleanup;

    const projectId = await seedProject(tdb);
    const { runId } = await createRun(deps, {
      projectId,
      nodes: [
        {
          key: 'N7d',
          nodeKey: 'N7d',
          variantId: 'v1',
          dependsOn: [],
          config: {},
          // EL CABLEADO QUE IMPORTA: el presupuesto holgado de la carrera-perdedora de dedup.
          maxRetries: N7_MAX_RETRIES,
        },
      ],
    });

    // El step pierde LOSES_BEFORE_WIN veces, reintenta bajo backoff y a la siguiente deduplica → succeeded.
    await waitFor(
      async () => (await fetchStep(runId))?.status === 'succeeded',
      30_000,
      'N7d succeeded tras deduplicar',
      50,
    );

    const step = await fetchStep(runId);
    expect(step?.status).toBe('succeeded');
    // Ejecutó LOSES_BEFORE_WIN derrotas + 1 acierto; su retry_count = las derrotas.
    expect(calls()).toBe(LOSES_BEFORE_WIN + 1);
    expect(step?.retryCount).toBe(LOSES_BEFORE_WIN);
  }, 60_000);

  it('CONTROL NEGATIVO: con maxRetries=3 (default de BD) el mismo loser AGOTA y va a failed', async () => {
    const { executor, calls } = loserExecutor(LOSES_BEFORE_WIN);
    const { deps, cleanup } = await startWorkerWith(
      tdb,
      { N7d: executor },
      { retryBackoffMs: TEST_BACKOFF_MS },
    );
    harnessCleanup = cleanup;

    const projectId = await seedProject(tdb);
    const { runId } = await createRun(deps, {
      projectId,
      nodes: [
        {
          key: 'N7d',
          nodeKey: 'N7d',
          variantId: 'v1',
          dependsOn: [],
          config: {},
          // SIN el cableado de N7 (maxRetries omitido ⇒ default de BD = 3): el presupuesto NO alcanza.
        },
      ],
    });

    // El presupuesto de 3 se agota ANTES de la K+1 victoria → failed terminal ESPURIO (el bug que el
    // cableado de N7_MAX_RETRIES evita).
    await waitFor(
      async () => (await fetchStep(runId))?.status === 'failed',
      30_000,
      'N7d failed por agotar el presupuesto de 3',
      50,
    );

    const step = await fetchStep(runId);
    expect(step?.status).toBe('failed');
    // Ejecutó 4 veces (intento inicial + 3 retries) y NUNCA llegó a deduplicar (LOSES_BEFORE_WIN=5 > 4).
    expect(calls()).toBe(4);
    expect(step?.retryCount).toBe(3);
  }, 60_000);
});
