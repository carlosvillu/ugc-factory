// Integración del handler del webhook + el tail compartido (T4.2, §9.6) contra Postgres real
// (Testcontainers) — CERO red real, cero gasto. Cubre las cláusulas deterministas que el live no
// puede ejercer barato:
//  · `handleFalWebhookEvent`: releela por fal_request_id → persiste in_progress + ENCOLA download.
//  · idempotencia: replay/completed → no-op, no re-encola.
//  · status ERROR → failed, sin encolar.
//  · `finalizeGeneration`: output → asset (con generation_id) + cost_entry fal + completed en UNA tx.
//  · finalize IDEMPOTENTE: re-entrada sobre una generación ya completed NO doble-cobra (barrera del
//    consumer output.download bajo re-entrega de fal/pg-boss).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createGeneration,
  getGeneration,
  getModelProfileByEndpoint,
  getSpendSummary,
  makeLocalStorageAdapter,
  seedGallery,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import type { FalWebhookPayload } from '@ugc/core/generation';
import type { EnqueueRequest } from '@ugc/core/jobs';
import type { JobQueue } from '@ugc/core/orchestrator';
import {
  createTestDatabase,
  makeGeneration,
  makeTestLogger,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { finalizeGeneration, type OutputDownloader } from '../../src/finalize-generation';
import { handleFalWebhookEvent } from '../../src/handle-fal-webhook';

const ENDPOINT = 'fal-ai/flux-2';
const OUTPUT_URL = 'https://fal.media/files/out-webhook.png';
// 1x1 PNG real (bytes válidos): el StorageAdapter calcula bytes+checksum sobre esto.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let fluxProfile: ModelProfile;

/** Un JobQueue de test que CAPTURA lo encolado (en vez de tocar pg-boss real): así el test asserta
 *  exactamente qué jobs pidió el handler, sin arrancar un boss. */
function captureQueue(): { queue: JobQueue; enqueued: EnqueueRequest[] } {
  const enqueued: EnqueueRequest[] = [];
  return {
    enqueued,
    queue: {
      enqueue(req: EnqueueRequest): Promise<void> {
        enqueued.push(req);
        return Promise.resolve();
      },
    },
  };
}

function pngResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(PNG_BYTES);
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

/** Un downloader de test que devuelve los bytes del PNG (sin red): el tail lo streamea a storage. */
function fakeDownloader(): OutputDownloader {
  return {
    download(): Promise<Response> {
      return Promise.resolve(pngResponse());
    },
  };
}

/**
 * Downloader con BARRERA de N partes: cada `download` se resuelve SOLO cuando N descargas están en
 * vuelo a la vez. Fuerza que las N liquidaciones concurrentes salgan de la descarga y entren en su
 * transacción CASI A LA VEZ — que es lo que hace REAL la carrera del `FOR UPDATE`. Sin esto, un
 * downloader instantáneo dejaría que el 1er finalize complete su tx entera antes de que el 2º empiece
 * (microtask ordering), y el test no ejercería el solape → el control negativo no se pondría rojo.
 */
function barrierDownloader(parties: number): OutputDownloader {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async download(): Promise<Response> {
      arrived += 1;
      if (arrived >= parties) release();
      await gate; // ambas partes esperan aquí hasta que la última llega → salen juntas
      return pngResponse();
    },
  };
}

/** Body de webhook OK (mismo shape que fal manda). */
function okEvent(requestId: string): FalWebhookPayload {
  return {
    request_id: requestId,
    status: 'OK',
    payload: {
      images: [{ url: OUTPUT_URL, width: 1024, height: 1024, content_type: 'image/png' }],
      seed: 7,
    },
  };
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'services:webhook' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-webhook-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const profile = await getModelProfileByEndpoint(tdb.db, ENDPOINT);
  if (profile === undefined) throw new Error(`model_profile ${ENDPOINT} no sembrado`);
  fluxProfile = profile;
});

afterAll(async () => {
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE generation, cost_entry, asset CASCADE');
});

async function seedGen(falRequestId: string, status: 'submitted' | 'in_progress' | 'completed') {
  return createGeneration(
    tdb.db,
    makeGeneration({ modelProfileId: fluxProfile.id, falRequestId, status }),
  );
}

describe('handleFalWebhookEvent (T4.2)', () => {
  const logger = makeTestLogger();

  it('OK: persiste in_progress + fal_status_payload y ENCOLA output.download con el generationId', async () => {
    const gen = await seedGen('req-1', 'submitted');
    const { queue, enqueued } = captureQueue();

    const result = await handleFalWebhookEvent(
      { db: tdb.db, jobQueue: queue, logger },
      okEvent('req-1'),
    );

    expect(result).toEqual({ outcome: 'enqueued_download', generationId: gen.id });
    const updated = await getGeneration(tdb.db, gen.id);
    expect(updated?.status).toBe('in_progress');
    expect((updated?.falStatusPayload as { status?: string } | null)?.status).toBe('OK');
    // Exactamente UN job de descarga, con el generationId correcto.
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.job.name).toBe('output.download');
    expect(enqueued[0]?.payload).toEqual({ generationId: gen.id });
  });

  it('idempotencia: generación YA completed → no-op, no re-encola', async () => {
    const gen = await seedGen('req-done', 'completed');
    const { queue, enqueued } = captureQueue();
    const result = await handleFalWebhookEvent(
      { db: tdb.db, jobQueue: queue, logger },
      okEvent('req-done'),
    );
    expect(result).toEqual({ outcome: 'already_completed', generationId: gen.id });
    expect(enqueued).toHaveLength(0);
  });

  it('request_id desconocido → no-op, no encola, no crea filas', async () => {
    const { queue, enqueued } = captureQueue();
    const result = await handleFalWebhookEvent(
      { db: tdb.db, jobQueue: queue, logger },
      okEvent('req-nope'),
    );
    expect(result).toEqual({ outcome: 'unknown_request' });
    expect(enqueued).toHaveLength(0);
  });

  it('status ERROR → generación failed, NO encola descarga', async () => {
    const gen = await seedGen('req-err', 'submitted');
    const { queue, enqueued } = captureQueue();
    const event: FalWebhookPayload = {
      request_id: 'req-err',
      status: 'ERROR',
      error: 'Invalid status code: 422',
    };
    const result = await handleFalWebhookEvent({ db: tdb.db, jobQueue: queue, logger }, event);
    expect(result).toEqual({ outcome: 'failed', generationId: gen.id });
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('failed');
    expect(enqueued).toHaveLength(0);
  });
});

describe('finalizeGeneration (T4.2) — tail compartido', () => {
  const logger = makeTestLogger();

  it('output → asset (con generation_id) + cost_entry fal + completed', async () => {
    const gen = await seedGen('req-fin', 'in_progress');
    const event = okEvent('req-fin');

    const res = await finalizeGeneration(
      { db: tdb.db, storage, downloader: fakeDownloader(), logger },
      { generation: gen, output: event.payload, statusPayload: event },
    );

    // La generación quedó completed con el coste y la duración.
    const updated = await getGeneration(tdb.db, gen.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.costActual).toBe(res.costCents);
    expect(updated?.completedAt).not.toBeNull();
    expect(updated?.durationS).not.toBeNull();

    // El PNG está en NUESTRO storage como asset con generation_id.
    const { rows } = await tdb.pool.query<{ generation_id: string | null; kind: string }>(
      `SELECT generation_id, kind FROM asset WHERE id = $1`,
      [res.assetId],
    );
    expect(rows[0]?.generation_id).toBe(gen.id);
    expect(rows[0]?.kind).toBe('keyframe');

    // cost_entry provider='fal' visible en /spend.
    const spend = await getSpendSummary(tdb.db);
    const fal = spend.byProvider.find((p) => p.provider === 'fal');
    expect(fal?.amountCents).toBe(res.costCents);
    expect(fal?.unit).toBe('images');
  });

  it('CONCURRENCIA (barrera anti doble-cobro): dos finalizes solapados de la MISMA generación → UN cost_entry', async () => {
    // EL DISCRIMINADOR. La re-entrega SECUENCIAL (el worker test) pasa incluso con el bug: el 2º job
    // ve `completed` y no-opea. Esta es la carrera REAL que el bug tenía: con `localConcurrency>1` +
    // redelivery por visibility-timeout a media descarga, DOS finalizes de la misma fila SOLAPAN,
    // ambos leen `!= completed` y ambos insertan un `cost_entry` → DOBLE-COBRO. El `SELECT … FOR
    // UPDATE` en la tx de finalize los SERIALIZA: el ganador escribe, el perdedor bloquea, adquiere el
    // lock, ve `completed` y sale sin re-cobrar.
    //
    // CONTROL NEGATIVO (verificado a mano): revertir el `getGenerationForUpdate` a un `getGeneration`
    // sin `.for('update')` pone ESTE test ROJO (2 cost_entries). Si sigue verde sin el FOR UPDATE, no
    // está ejerciendo la carrera.
    const gen = await seedGen('req-concurrent', 'in_progress');
    const event = okEvent('req-concurrent');
    // Barrera de 2: ambas liquidaciones entran en su transacción CASI A LA VEZ (si no, la 1ª
    // terminaría entera antes de que la 2ª empiece y no habría solape que serializar).
    const downloader = barrierDownloader(2);
    const run = () =>
      finalizeGeneration(
        { db: tdb.db, storage, downloader, logger },
        { generation: gen, output: event.payload, statusPayload: event },
      );

    // Dos liquidaciones EN PARALELO (Promise.all): la carrera real, no secuencial.
    const [a, b] = await Promise.all([run(), run()]);

    // Exactamente UNO finalizó de verdad (assetId no-null); el otro encontró la fila ya `completed`
    // bajo el lock y devolvió `assetId: null` (la señal de "perdí la carrera").
    const finalizers = [a, b].filter((r) => r.assetId !== null);
    const losers = [a, b].filter((r) => r.assetId === null);
    expect(finalizers).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.assetId).toBeNull();

    // La generación quedó `completed` UNA vez.
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('completed');

    // EL ASSERT QUE IMPORTA: UN solo cost_entry (no dos). El perdedor NO re-cobró.
    const { rows } = await tdb.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM cost_entry WHERE generation_id = $1`,
      [gen.id],
    );
    expect(rows[0]?.n).toBe(1);
    // Y UN solo asset (el ganador lo creó; el perdedor descargó un blob huérfano — deuda menor).
    const assets = await tdb.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM asset WHERE generation_id = $1`,
      [gen.id],
    );
    expect(assets.rows[0]?.n).toBe(1);
  });

  // NOTA: la barrera anti doble-cobro bajo RE-ENTREGA SECUENCIAL (el consumer no-opea sobre
  // `completed`) se prueba end-to-end con pg-boss real en
  // `apps/worker/test/integration/output-download.test.ts`. Aquí arriba se prueba la carrera
  // CONCURRENTE (el caso que el bug tenía), que el worker test secuencial no cubre.

  it('output sin images[] → lanza FalResponseError, generación NO queda completed', async () => {
    const gen = await seedGen('req-bad', 'in_progress');
    await expect(
      finalizeGeneration(
        { db: tdb.db, storage, downloader: fakeDownloader(), logger },
        { generation: gen, output: { not: 'images' }, statusPayload: {} },
      ),
    ).rejects.toThrow();
    // finalize LANZA sin auto-marcar failed: la fila sigue in_progress (el caller decide el fallo).
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('in_progress');
    // Y NO se registró coste.
    const { rows } = await tdb.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM cost_entry WHERE generation_id = $1`,
      [gen.id],
    );
    expect(rows[0]?.n).toBe(0);
  });
});
