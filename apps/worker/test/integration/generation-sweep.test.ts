// EL SWEEPER RECONCILIA GENERACIONES COLGADAS (T4.3, §9.6) — este test blinda el flujo que la
// Verificación cláusula 2 ejerce en vivo ("matar el worker durante una generación y reiniciar retoma
// el seguimiento SIN re-submit"). Aquí, contra Postgres real + pg-boss real:
//   · Una generación `submitted` (submit ya durable en la fila, con `status_url` guardado) →
//     `makeGenerationSweep` (la pieza del tick del worker) la pollea y, si fal reporta COMPLETED,
//     PERSISTE el output en forma WEBHOOK-COMPATIBLE + marca `in_progress` + ENCOLA `output.download`.
//   · NUNCA re-submitea: el sweep no tiene camino de submit; solo pollea el `status_url` GUARDADO.
//   · Idempotencia del enqueue: un 2º tick DENTRO del deadline de descarga NO re-encola (backoff por
//     deadline vía `updatedAt`).
//   · Recuperación: una fila `in_progress` colgada PASADO el deadline (descarga perdida) SÍ se re-encola.
// Lo ÚNICO simulado es `checkStatus` (el poll a fal): un doble que emite lo que fal REAL emite
// (state 'completed' con el output). La descarga real y el billing de 1 solo job son la Verificación
// live (el verifier), no este test.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeLogger } from '@ugc/core/observability';
import { outputDownloadJob } from '@ugc/core/jobs';
import type { ReconcileCheckStatus } from '@ugc/core/generation';
import {
  createDbPool,
  createGeneration,
  ensureQueue,
  getGeneration,
  getModelProfileByEndpoint,
  recordCost,
  seedGallery,
  updateGeneration,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, makeGeneration, type TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';
import { makeGenerationSweep } from '../../src/sweeper';
import { stopBossAndWait } from '../helpers';

const ENDPOINT = 'fal-ai/flux-2';
const STATUS_URL = 'https://queue.fal.run/fal-ai/flux-2/requests/REQ-SWEEP/status';
const RESPONSE_URL = 'https://queue.fal.run/fal-ai/flux-2/requests/REQ-SWEEP';
const OUTPUT = { images: [{ url: 'https://fal.media/sweep-out.png', width: 1024, height: 1024 }] };

let tdb: TestDatabase;
let boss: PgBoss;
let pool: ReturnType<typeof createDbPool>['pool'];
let db: ReturnType<typeof createDbPool>['db'];
let fluxProfile: ModelProfile;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:generation-sweep' });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const profile = await getModelProfileByEndpoint(tdb.db, ENDPOINT);
  if (profile === undefined) throw new Error(`model_profile ${ENDPOINT} no sembrado`);
  fluxProfile = profile;

  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* ruido del poller */
  });
  await boss.start();
  await ensureQueue(boss, outputDownloadJob);
  const dbPool = createDbPool(tdb.connectionString);
  pool = dbPool.pool;
  db = dbPool.db;
});

afterAll(async () => {
  await stopBossAndWait(boss);
  await pool.end();
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE generation, cost_entry, asset CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [outputDownloadJob.name]);
});

/** Siembra una generación `submitted` con las URLs guardadas — como la deja `submitGenerationForWebhook`
 *  / `runGenerate` tras el submit: el submit YA es durable en la fila; el sweeper solo pollea. */
async function seedSubmitted(falRequestId: string) {
  return createGeneration(
    tdb.db,
    makeGeneration({
      modelProfileId: fluxProfile.id,
      falRequestId,
      status: 'submitted',
      statusUrl: STATUS_URL,
      responseUrl: RESPONSE_URL,
      startedAt: new Date(),
    }),
  );
}

/** Un `checkStatus` doble que emite lo que fal REAL emite (state 'completed' con el output). NO hay
 *  camino de submit: por construcción el sweep no puede re-submitear. */
const completedCheck: ReconcileCheckStatus = () =>
  Promise.resolve({ state: 'completed', output: OUTPUT, statusPayload: { status: 'COMPLETED' } });

/** Cuenta los jobs `output.download` encolados para una generación (pendientes en la cola). */
async function countDownloadJobs(generationId: string): Promise<number> {
  const { rows } = await tdb.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND data->>'generationId' = $2`,
    [outputDownloadJob.name, generationId],
  );
  return rows[0]!.n;
}

describe('makeGenerationSweep — reconcilia una generación submitted colgada (Verificación cláusula 2)', () => {
  it('pollea el status_url GUARDADO, persiste el output webhook-shaped, marca in_progress y encola la descarga', async () => {
    const gen = await seedSubmitted('REQ-SWEEP');
    const sweep = makeGenerationSweep({
      db,
      boss,
      falKey: 'fal-test-key-not-a-secret',
      logger: makeLogger({ name: 'worker', level: 'silent' }),
      checkStatus: completedCheck,
    });

    await sweep();

    const after = await getGeneration(db, gen.id);
    // La fila avanzó a in_progress (descarga encolada) SIN re-submit (mismo fal_request_id).
    expect(after?.status).toBe('in_progress');
    expect(after?.falRequestId).toBe('REQ-SWEEP');
    // El payload quedó en la forma que output.download lee (FalWebhookPayloadSchema): status OK + payload.
    expect(after?.falStatusPayload).toMatchObject({
      request_id: 'REQ-SWEEP',
      status: 'OK',
      payload: OUTPUT,
    });
    // La descarga se encoló exactamente una vez.
    expect(await countDownloadJobs(gen.id)).toBe(1);
  });

  it('IDEMPOTENCIA "matar y reiniciar": un 2º tick DENTRO del deadline de descarga NO re-encola', async () => {
    const gen = await seedSubmitted('REQ-SWEEP');
    const sweep = makeGenerationSweep({
      db,
      boss,
      falKey: 'fal-test-key-not-a-secret',
      logger: makeLogger({ name: 'worker', level: 'silent' }),
      checkStatus: completedCheck,
    });

    await sweep(); // tick 1: submitted → in_progress + encola
    // tick 2 (tras "reiniciar"): la fila está in_progress con updatedAt fresco → dentro del deadline
    // de descarga → no-op (el backoff por deadline evita el re-encolado, no la exclusión del listado).
    await sweep();

    expect(await countDownloadJobs(gen.id)).toBe(1); // UNA sola descarga, no dos
    expect((await getGeneration(db, gen.id))?.status).toBe('in_progress');
  });

  it('RECUPERACIÓN del agujero negro: una fila in_progress colgada PASADO el deadline de descarga se RE-ENCOLA', async () => {
    // Simula la puerta que el fix cierra: la descarga se perdió (enqueue fallido tras el claim, o job
    // agotado). La fila quedó en `in_progress` sin job. Envejecemos `updated_at` a 25 min atrás
    // (> inProgressMs 20 min, < maxAge 2 h) y confirmamos que el sweep RE-ENCOLA `output.download`.
    const gen = await createGeneration(
      db,
      makeGeneration({
        modelProfileId: fluxProfile.id,
        falRequestId: 'REQ-STUCK',
        status: 'in_progress',
        falStatusPayload: {
          request_id: 'REQ-STUCK',
          status: 'OK',
          payload: OUTPUT,
        },
      }),
    );
    // Envejecer updated_at directamente (el $onUpdateFn lo pondría a now; aquí forzamos el pasado).
    await tdb.pool.query(
      `UPDATE generation SET updated_at = now() - interval '25 minutes' WHERE id = $1`,
      [gen.id],
    );
    // Sin jobs de descarga encolados (la descarga se "perdió").
    expect(await countDownloadJobs(gen.id)).toBe(0);

    const sweep = makeGenerationSweep({
      db,
      boss,
      falKey: 'fal-test-key-not-a-secret',
      logger: makeLogger({ name: 'worker', level: 'silent' }),
      // checkStatus NO se llama para una fila in_progress (la sub-lógica es por deadline).
      checkStatus: () => Promise.reject(new Error('checkStatus no debe llamarse para in_progress')),
    });

    await sweep();

    // La descarga fue RE-ENCOLADA → la fila puede recuperarse.
    expect(await countDownloadJobs(gen.id)).toBe(1);
    // La fila sigue in_progress (no regresada, no expirada — aún dentro del maxAge).
    expect((await getGeneration(db, gen.id))?.status).toBe('in_progress');
  });

  it('CARRERA anti-doble-cobro: otro actor completa la fila entre listar y el claim → NO se re-encola NI se regresa el completed', async () => {
    const gen = await seedSubmitted('REQ-SWEEP');
    // `checkStatus` doble que simula la CARRERA: justo antes de devolver COMPLETED al sweep, OTRO actor
    // (el webhook + su descarga) ya liquidó la fila — la lleva a `completed` y escribe su cost_entry.
    // El claim condicional del sweep debe entonces NO tocar la fila (WHERE status IN reconcilables) y
    // NO encolar una 2ª descarga (que produciría un 2º cost_entry pese al FOR UPDATE de finalize).
    let raced = false;
    const racingCheck: ReconcileCheckStatus = async () => {
      if (!raced) {
        raced = true;
        await updateGeneration(db, gen.id, { status: 'completed', completedAt: new Date() });
        await recordCost(db, {
          provider: 'fal',
          amountCents: 1,
          quantity: 1,
          unit: 'images',
          generationId: gen.id,
        });
      }
      return { state: 'completed', output: OUTPUT, statusPayload: { status: 'COMPLETED' } };
    };
    const sweep = makeGenerationSweep({
      db,
      boss,
      falKey: 'fal-test-key-not-a-secret',
      logger: makeLogger({ name: 'worker', level: 'silent' }),
      checkStatus: racingCheck,
    });

    await sweep();

    // La fila NO fue regresada de completed (el claim condicional no tocó una fila ya-completada).
    expect((await getGeneration(db, gen.id))?.status).toBe('completed');
    // NINGUNA descarga encolada por el sweep (el otro actor ya la condujo) → sin 2º cost_entry.
    expect(await countDownloadJobs(gen.id)).toBe(0);
    // Exactamente UN cost_entry (el del actor concurrente), no dos.
    const { rows } = await tdb.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM cost_entry WHERE generation_id = $1`,
      [gen.id],
    );
    expect(rows[0]!.n).toBe(1);
  });
});
