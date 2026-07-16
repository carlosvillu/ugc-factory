// Cadena COMPLETA de la Verificación de T4.1 (regla de trabajo 8): el servicio de generación
// invoca fal (HTTP mockeado con msw — CERO red real, cero gasto) → persiste `generation`
// (submitting→submitted→completed), descarga el PNG del output a nuestro storage como `asset`, y
// registra el `cost_entry` (provider='fal'). Codifica las cláusulas DETERMINISTAS observables que
// el live NO puede ejercer barato ni de forma determinista:
//  · ORDEN §9.6: la fila existe en `submitting` ANTES del submit (500-on-submit lo prueba).
//  · Las URLs (request_id/status_url/response_url) se persisten TAL CUAL las devuelve fal.
//  · PNG del output en storage propio (asset.generation_id, checksum recuperable).
//  · cost_entry provider='fal', unit='megapixels', amount_cents = MP × precio del perfil.
//  · CACHÉ de upload a fal storage: 2º upload del mismo input NO re-sube (fal_uploaded_at no cambia).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createAsset,
  getAsset,
  getGeneration,
  getModelProfileByEndpoint,
  getSpendSummary,
  listGenerationsByStatus,
  makeLocalStorageAdapter,
  seedGallery,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { computeContentHash } from '@ugc/core/generation';
import { createTestDatabase, makeTestLogger, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runGenerate, uploadInputCached } from '../../src/generate';

const ENDPOINT = 'fal-ai/flux-2';
const SUBMIT_URL = `https://queue.fal.run/${ENDPOINT}`;
const CANARY = 'CANARY-req-42';
const STATUS_URL = `https://queue.fal.run/${ENDPOINT}/requests/${CANARY}/status`;
const RESPONSE_URL = `https://queue.fal.run/${ENDPOINT}/requests/${CANARY}`;
const OUTPUT_URL = 'https://fal.media/files/out-flux2.png';
// 1x1 PNG real (bytes válidos): el StorageAdapter calcula bytes+checksum sobre esto.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const SUBMIT_BODY = {
  request_id: CANARY,
  status_url: STATUS_URL,
  response_url: RESPONSE_URL,
  cancel_url: `${RESPONSE_URL}/cancel`,
  status: 'IN_QUEUE',
  queue_position: 0,
};
const STATUS_COMPLETED = { status: 'COMPLETED', request_id: CANARY };
// 1024×1024 = 1,048576 MP; a 1,2 céntimos/MP → round(1,258…) = 1 céntimo.
const RESPONSE_BODY = {
  images: [{ url: OUTPUT_URL, width: 1024, height: 1024, content_type: 'image/png' }],
  seed: 7,
};

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let fluxProfile: ModelProfile;

/** Registra los handlers del camino feliz (submit→status→response→output). */
function happyPath(): void {
  server.use(
    http.post(SUBMIT_URL, () => HttpResponse.json(SUBMIT_BODY)),
    http.get(STATUS_URL, () => HttpResponse.json(STATUS_COMPLETED)),
    http.get(RESPONSE_URL, () => HttpResponse.json(RESPONSE_BODY)),
    http.get(OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(PNG_BYTES.buffer, {
        headers: { 'content-type': 'image/png' },
      }),
    ),
  );
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-generate-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  // Siembra el catálogo REAL (incluye el model_profile FLUX.2 de T4.1). `generation.model_profile_id`
  // es NOT NULL → sin este seed el INSERT fallaría; se resuelve el id por su clave natural.
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const profile = await getModelProfileByEndpoint(tdb.db, ENDPOINT);
  if (profile === undefined) throw new Error(`model_profile ${ENDPOINT} no sembrado`);
  fluxProfile = profile;
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

/** Deps del servicio con espera inyectada (no espera de verdad) y polling inmediato. */
function deps() {
  return {
    db: tdb.db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    sleep: () => Promise.resolve(),
    falOptions: { pollIntervalMs: 0 },
  };
}

describe('runGenerate — cadena end-to-end (Verificación T4.1)', () => {
  it('genera una imagen: generation completed, PNG en storage, cost_entry fal', async () => {
    happyPath();
    const res = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: 'A serum bottle on a marble table, soft light',
      inputs: { image_size: 'square_hd', num_images: 1 },
    });

    // generation COMPLETED con las URLs persistidas TAL CUAL fal las devolvió.
    const gen = await getGeneration(tdb.db, res.generation.id);
    expect(gen?.status).toBe('completed');
    expect(gen?.falRequestId).toBe(CANARY);
    expect(gen?.statusUrl).toBe(STATUS_URL);
    expect(gen?.responseUrl).toBe(RESPONSE_URL);
    expect(gen?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(gen?.costActual).toBe(1);
    // duration_s (§12 l.527): medida desde started_at (create) hasta completed_at. > 0 y finita.
    expect(gen?.durationS).not.toBeNull();
    expect(gen?.durationS).toBeGreaterThanOrEqual(0);
    expect(gen?.startedAt).not.toBeNull();
    expect(gen?.completedAt).not.toBeNull();
    // synthetic_product (T4.4): default `false` cuando el caller NO lo marca (esta generación no es
    // un packshot IA). N7a la pondrá `true`; aquí probamos el DEFAULT.
    expect(gen?.syntheticProduct).toBe(false);

    // PNG en NUESTRO storage: asset con generation_id, bytes recuperables.
    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.generationId).toBe(res.generation.id);
    expect(asset?.kind).toBe('keyframe');
    expect(asset?.width).toBe(1024);
    const bytes = await new Response(await storage.get(asset!.storageKey)).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(PNG_BYTES);

    // cost_entry provider='fal' visible en /spend.
    const spend = await getSpendSummary(tdb.db);
    const fal = spend.byProvider.find((p) => p.provider === 'fal');
    expect(fal?.amountCents).toBe(1);
    expect(fal?.unit).toBe('images');
    expect(fal?.quantity).toBe(1);
  });

  it('T4.4: `syntheticProduct:true` se persiste en la fila `generation` (procedencia, no dedupe)', async () => {
    // request_id DISTINTO del CANARY del camino feliz: la tabla es compartida entre tests (sin
    // truncate) y `fal_request_id` es UNIQUE, así que esta generación necesita el suyo propio.
    const REQ = 'T44-req-synthetic';
    const statusUrl = `https://queue.fal.run/${ENDPOINT}/requests/${REQ}/status`;
    const responseUrl = `https://queue.fal.run/${ENDPOINT}/requests/${REQ}`;
    server.use(
      http.post(SUBMIT_URL, () =>
        HttpResponse.json({
          request_id: REQ,
          status_url: statusUrl,
          response_url: responseUrl,
          cancel_url: `${responseUrl}/cancel`,
          status: 'IN_QUEUE',
          queue_position: 0,
        }),
      ),
      http.get(statusUrl, () => HttpResponse.json({ status: 'COMPLETED', request_id: REQ })),
      http.get(responseUrl, () => HttpResponse.json(RESPONSE_BODY)),
      http.get(OUTPUT_URL, () =>
        HttpResponse.arrayBuffer(PNG_BYTES.buffer, { headers: { 'content-type': 'image/png' } }),
      ),
    );
    const res = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: 'AI packshot of a serum bottle, studio, 9:16',
      inputs: { image_size: 'portrait_16_9', num_images: 1, seed: 0 },
      syntheticProduct: true,
    });
    const gen = await getGeneration(tdb.db, res.generation.id);
    expect(gen?.syntheticProduct).toBe(true);
    // El flag NO contamina el content_hash: es procedencia, NO dimensión de dedupe. El hash solo
    // depende de (resolvedPrompt, modelProfileId, inputs) — `syntheticProduct` no entra. Se ancla
    // sobre la primitiva PURA `computeContentHash` (sin red): el hash de la generación persistida es
    // idéntico al que se computa SIN pasar por el flag. Si alguien colara `syntheticProduct` en el
    // hash, este assert caería (control negativo).
    const hashWithoutFlag = computeContentHash({
      resolvedPrompt: 'AI packshot of a serum bottle, studio, 9:16',
      modelProfileId: fluxProfile.id,
      inputs: { image_size: 'portrait_16_9', num_images: 1, seed: 0 },
    });
    expect(gen?.contentHash).toBe(hashWithoutFlag);
  });

  it('§9.6: la fila existe en `submitting` ANTES del submit (500-on-submit)', async () => {
    // El submit responde 500: si la intención NO se persistiera antes, no habría fila. La hay.
    server.use(http.post(SUBMIT_URL, () => new HttpResponse(null, { status: 500 })));

    const before = (await getSpendSummary(tdb.db)).totalCents;
    await expect(
      runGenerate(deps(), { modelProfileId: fluxProfile.id, resolvedPrompt: 'x' }),
    ).rejects.toThrow();

    // Hay al menos una generación en `submitting` sin request_id (la huérfana reconciliable).
    const orphans = await listGenerationsByStatus(tdb.db, 'submitting');
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    expect(orphans.every((g) => g.falRequestId === null)).toBe(true);
    // Y NO se registró coste (nunca se llegó a completar).
    expect((await getSpendSummary(tdb.db)).totalCents).toBe(before);
  });

  it('la descarga del output falla → generation `failed`, sin coste (nunca se cuelga)', async () => {
    // submit/poll OK, pero el CDN del output responde 503: `fal.download` lanza FalProviderError y
    // runGenerate deja la fila `failed` (nunca `completed`). El caso de TIMEOUT/cuelgue está cubierto
    // de forma determinista en el unit del FalClient (`download` con AbortController); aquí se prueba
    // que el servicio propaga el fallo de descarga a un estado honesto, sin registrar coste.
    // request_id DISTINTO del happy-path (fal_request_id es UNIQUE §9.6): un submit real siempre
    // devuelve un id nuevo, así que dos generaciones no colisionan.
    const canary2 = 'CANARY-req-503';
    const status2 = `https://queue.fal.run/${ENDPOINT}/requests/${canary2}/status`;
    const response2 = `https://queue.fal.run/${ENDPOINT}/requests/${canary2}`;
    server.use(
      http.post(SUBMIT_URL, () =>
        HttpResponse.json({
          ...SUBMIT_BODY,
          request_id: canary2,
          status_url: status2,
          response_url: response2,
        }),
      ),
      http.get(status2, () => HttpResponse.json(STATUS_COMPLETED)),
      http.get(response2, () => HttpResponse.json(RESPONSE_BODY)),
      http.get(OUTPUT_URL, () => new HttpResponse(null, { status: 503 })),
    );

    const before = (await getSpendSummary(tdb.db)).totalCents;
    const res = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: 'output que falla al descargar',
    }).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(Error);

    // La generación quedó `failed` (nunca `completed`), y NO se registró coste (no hubo output).
    const failed = await listGenerationsByStatus(tdb.db, 'failed');
    expect(failed.some((g) => g.resolvedPrompt === 'output que falla al descargar')).toBe(true);
    expect((await getSpendSummary(tdb.db)).totalCents).toBe(before);
  });
});

describe('uploadInputCached — caché de upload a fal storage (§9.6, Verificación #2)', () => {
  it('primer upload sube y estampa fal_url; segundo es cache-hit sin re-subir', async () => {
    // Un asset de INPUT en nuestro storage, sin fal_url todavía.
    const put = await storage.put('inputs/ref-1.png', PNG_BYTES, { mime: 'image/png' });
    const asset = await createAsset(tdb.db, {
      kind: 'reference_image',
      storageKey: 'inputs/ref-1.png',
      mime: 'image/png',
      bytes: put.bytes,
      checksum: put.checksum,
    });

    // El upload a fal storage es un flujo de 2 pasos (initiate + PUT). Se cuentan los initiate.
    let initiates = 0;
    server.use(
      http.post('https://rest.fal.ai/storage/upload/initiate', () => {
        initiates += 1;
        return HttpResponse.json({
          upload_url: 'https://storage.fal.run/upload/ref-1',
          file_url: 'https://fal.media/files/ref-1.png',
        });
      }),
      http.put(
        'https://storage.fal.run/upload/ref-1',
        () => new HttpResponse(null, { status: 200 }),
      ),
    );

    const logger = makeTestLogger();
    const uploadDeps = { db: tdb.db, storage, falKey: 'fal-test-key-not-a-secret', logger };

    // 1ª pasada: fal_url null → UPLOAD real.
    const first = await uploadInputCached(uploadDeps, {
      assetId: asset.id,
      storageKey: asset.storageKey,
      falUrl: null,
      mime: 'image/png',
    });
    expect(first.cacheHit).toBe(false);
    expect(first.falUrl).toBe('https://fal.media/files/ref-1.png');
    expect(initiates).toBe(1);

    // El asset quedó con fal_url y fal_uploaded_at estampados.
    const afterUpload = await getAsset(tdb.db, asset.id);
    expect(afterUpload?.falUrl).toBe('https://fal.media/files/ref-1.png');
    expect(afterUpload?.falUploadedAt).not.toBeNull();
    const uploadedAt = afterUpload!.falUploadedAt;

    // 2ª pasada: ahora fal_url está poblada → CACHE-HIT, sin nuevo initiate, sin tocar fal_uploaded_at.
    const second = await uploadInputCached(uploadDeps, {
      assetId: asset.id,
      storageKey: asset.storageKey,
      falUrl: afterUpload!.falUrl,
      mime: 'image/png',
    });
    expect(second.cacheHit).toBe(true);
    expect(initiates).toBe(1); // NO hubo segundo upload (la señal de la Verificación)

    const afterHit = await getAsset(tdb.db, asset.id);
    expect(afterHit?.falUploadedAt?.getTime()).toBe(uploadedAt?.getTime()); // NO cambió

    // Log observable: exactamente un 'upload' y un 'cache-hit'.
    const events = logger.entries.map((e) => (e.obj as { event?: string }).event);
    expect(events.filter((e) => e === 'fal_input_upload').length).toBe(1);
    expect(events.filter((e) => e === 'fal_input_cache_hit').length).toBe(1);
  });
});
