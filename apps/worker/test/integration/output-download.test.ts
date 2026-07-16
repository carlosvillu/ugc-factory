// EL CONSUMER output.download CUIDA DINERO (T4.2, §9.6) — este test blinda la barrera anti
// DOBLE-COBRO bajo re-entrega. fal reintenta el webhook 10×/2 h y pg-boss redelivera jobs: si el
// consumer descargara → cobrara → y una re-entrega lo repitiera, cada vuelta registraría OTRO
// cost_entry por una imagen que ya está en storage. La defensa: el consumer no-opea si la generación
// ya está `completed` (el output ya se descargó), y finalize escribe asset+cost+completed en UNA tx.
//
// CÓMO SE PRUEBA (el mecanismo REAL, no un mock del guard): un pg-boss REAL + el consumer REAL
// (`registerOutputDownloadConsumer`) + `finalizeGeneration` REAL contra Postgres real. Lo ÚNICO
// simulado es la DESCARGA (un downloader inyectado que devuelve un PNG sin red — el output de fal es
// una URL pública, no hay contrato que probar aquí; eso es la Verificación live). Se encola el MISMO
// job DOS VECES (que es exactamente lo que le pasa a un job redelivered) y se cuenta: debe quedar UN
// asset y UN cost_entry, no dos.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeLogger } from '@ugc/core/observability';
import { newUlid } from '@ugc/core/contracts';
import { outputDownloadJob } from '@ugc/core/jobs';
import type { OutputDownloader } from '@ugc/services';
import {
  createDbPool,
  createGeneration,
  ensureQueue,
  getGeneration,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
  seedGallery,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, makeGeneration, type TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';
import { registerOutputDownloadConsumer } from '../../src/consumers/output-download';
import { stopBossAndWait, waitFor } from '../helpers';

const ENDPOINT = 'fal-ai/flux-2';
const OUTPUT_URL = 'https://fal.media/files/out-worker.png';
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** Downloader de test: devuelve el PNG sin red y CUENTA las descargas (para ver el no-op). */
function countingDownloader(): { downloader: OutputDownloader; downloads: () => number } {
  let downloads = 0;
  return {
    downloads: () => downloads,
    downloader: {
      download(): Promise<Response> {
        downloads += 1;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(PNG_BYTES);
            controller.close();
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      },
    },
  };
}

let tdb: TestDatabase;
let boss: PgBoss;
let pool: ReturnType<typeof createDbPool>['pool'];
let storageDir: string;
let fluxProfile: ModelProfile;
let counting: ReturnType<typeof countingDownloader>;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:output-download' });
  storageDir = mkdtempSync(path.join(tmpdir(), 'ugc-worker-dl-'));
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const profile = await getModelProfileByEndpoint(tdb.db, ENDPOINT);
  if (profile === undefined) throw new Error(`model_profile ${ENDPOINT} no sembrado`);
  fluxProfile = profile;

  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* ruido del poller: irrelevante para estos asserts */
  });
  await boss.start();
  await ensureQueue(boss, outputDownloadJob);
  const dbPool = createDbPool(tdb.connectionString);
  pool = dbPool.pool;
  counting = countingDownloader();
  await registerOutputDownloadConsumer({
    boss,
    db: dbPool.db,
    storage: makeLocalStorageAdapter({ root: storageDir }),
    logger: makeLogger({ name: 'worker', level: 'silent' }),
    downloader: counting.downloader,
  });
});

afterAll(async () => {
  await stopBossAndWait(boss);
  await pool.end();
  await tdb.close();
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE generation, cost_entry, asset CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [outputDownloadJob.name]);
});

/** Cuenta filas de asset/cost_entry ligadas a una generación. */
async function countFor(table: 'asset' | 'cost_entry', generationId: string): Promise<number> {
  const { rows } = await tdb.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE generation_id = $1`,
    [generationId],
  );
  return rows[0]!.n;
}

/** Siembra una generación `in_progress` con el payload de webhook OK ya persistido (lo que el
 *  webhook handler dejó): el consumer lee el output de `fal_status_payload`. */
async function seedInProgress(falRequestId: string) {
  return createGeneration(
    tdb.db,
    makeGeneration({
      modelProfileId: fluxProfile.id,
      falRequestId,
      status: 'in_progress',
      falStatusPayload: {
        request_id: falRequestId,
        status: 'OK',
        payload: {
          images: [{ url: OUTPUT_URL, width: 1024, height: 1024, content_type: 'image/png' }],
          seed: 7,
        },
      },
    }),
  );
}

describe('consumer output.download (T4.2)', () => {
  it('descarga el output, crea el asset, registra el coste y marca completed', async () => {
    const gen = await seedInProgress(`req-${newUlid()}`);
    await boss.send(outputDownloadJob.name, { generationId: gen.id });

    await waitFor(
      async () => (await getGeneration(tdb.db, gen.id))?.status === 'completed',
      30_000,
      'la generación en completed',
      100,
    );

    expect(await countFor('asset', gen.id)).toBe(1);
    expect(await countFor('cost_entry', gen.id)).toBe(1);
    const updated = await getGeneration(tdb.db, gen.id);
    expect(updated?.costActual).not.toBeNull();
    expect(updated?.completedAt).not.toBeNull();
  });

  it('RE-ENTREGA del mismo job: NO doble-cobra (un asset, un cost_entry, una descarga)', async () => {
    const gen = await seedInProgress(`req-${newUlid()}`);
    const downloadsBefore = counting.downloads();

    // Primer job: descarga y liquida.
    await boss.send(outputDownloadJob.name, { generationId: gen.id });
    await waitFor(
      async () => (await getGeneration(tdb.db, gen.id))?.status === 'completed',
      30_000,
      'la generación en completed (1ª vez)',
      100,
    );
    expect(await countFor('cost_entry', gen.id)).toBe(1);
    expect(counting.downloads()).toBe(downloadsBefore + 1);

    // Re-entrega: fal reenvía el webhook → se re-encola el MISMO job. El consumer relee la
    // generación, la ve `completed` y NO-OPEA: ni re-descarga, ni re-cobra.
    await boss.send(outputDownloadJob.name, { generationId: gen.id });
    // Esperar a que el segundo job se procese (llegue a `completed` en pgboss.job) para que el
    // assert no corra ANTES de que el consumer lo haya tocado — si re-cobrara, ya se vería.
    await waitFor(
      async () => {
        const { rows } = await tdb.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state = 'completed'`,
          [outputDownloadJob.name],
        );
        return rows[0]!.n === 2;
      },
      30_000,
      'los DOS jobs output.download en completed',
      100,
    );

    // La barrera anti doble-cobro: sigue habiendo UN asset y UN cost_entry, y NO se re-descargó.
    expect(await countFor('asset', gen.id)).toBe(1);
    expect(await countFor('cost_entry', gen.id)).toBe(1);
    expect(counting.downloads()).toBe(downloadsBefore + 1); // ninguna descarga nueva
  });
});
