// Cadena de la Verificación de T4.8 (regla de trabajo 8): el servicio de CLIP DE B-ROLL sube la(s)
// imagen(es) de entrada a fal storage (caché §9.6), invoca el b-roll de Veo (HTTP mockeado con msw —
// CERO red real, cero gasto) y persiste:
//  · `generation` submitting→submitted→completed, con las URLs TAL CUAL fal las devuelve;
//  · el .mp4 del output descargado a NUESTRO storage como `asset` kind='broll_clip' con `duration_s`;
//  · UN `cost_entry` provider='fal' unit='seconds' (una llamada = un cargo, por SEGUNDO del clip).
//
// CLAVE DE B-ROLL vs AVATAR: el output de Veo i2v/R2V NO trae `duration` (verificado 2026-07-17 vs fal
// openapi) → la duración del clip ES el enum que ENVIAMOS (input `durationSeconds`), no un campo del
// output. Y el b-roll es SILENCIOSO: `generate_audio:false` en el payload. Molde: `generate-avatar.test.ts`.
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
  makeLocalStorageAdapter,
  seedGallery,
  type Asset,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runGenerateBroll } from '../../src/generate-broll';

const I2V_ENDPOINT = 'fal-ai/veo3.1/image-to-video';
const R2V_ENDPOINT = 'fal-ai/veo3.1/reference-to-video';

const VIDEO_URL = 'https://v3.fal.media/files/broll/clip.mp4';
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // ftyp box mínimo
const IMG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic

function uploadHandlers(): Parameters<typeof server.use> {
  return [
    http.post('https://rest.fal.ai/storage/upload/initiate', () =>
      HttpResponse.json({
        upload_url: 'https://storage.fal.run/upload/input',
        file_url: 'https://fal.media/files/uploaded-input',
      }),
    ),
    http.put('https://storage.fal.run/upload/input', () => new HttpResponse(null, { status: 200 })),
  ];
}

/** Registra el camino feliz + captura el body del submit. El output NO trae `duration` (Veo i2v/R2V no
 *  la emite): la duración del clip = el enum enviado. */
function happyBroll(
  endpoint: string,
  reqSuffix: string,
): { getSubmitBody: () => Record<string, unknown> | undefined } {
  const req = `BRL-${reqSuffix}`;
  const status = `https://queue.fal.run/${endpoint}/requests/${req}/status`;
  const response = `https://queue.fal.run/${endpoint}/requests/${req}`;
  let submitBody: Record<string, unknown> | undefined;
  server.use(
    ...uploadHandlers(),
    http.post(`https://queue.fal.run/${endpoint}`, async ({ request }) => {
      submitBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        request_id: req,
        status_url: status,
        response_url: response,
        status: 'IN_QUEUE',
      });
    }),
    http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
    // Output SIN `duration` (a diferencia del avatar): solo `{video:{url}}`.
    http.get(response, () =>
      HttpResponse.json({ video: { url: VIDEO_URL, content_type: 'video/mp4' } }),
    ),
    http.get(VIDEO_URL, () =>
      HttpResponse.arrayBuffer(MP4_BYTES.buffer, { headers: { 'content-type': 'video/mp4' } }),
    ),
  );
  return { getSubmitBody: () => submitBody };
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let i2vProfile: ModelProfile;
let r2vProfile: ModelProfile;

async function makeImageAsset(kind: Asset['kind'] = 'keyframe'): Promise<Asset> {
  const key = `inputs/${kind}/${Math.random().toString(36).slice(2)}`;
  const put = await storage.put(key, IMG_BYTES, { mime: 'image/png' });
  return createAsset(tdb.db, {
    kind,
    storageKey: key,
    mime: 'image/png',
    bytes: put.bytes,
    checksum: put.checksum,
  });
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-broll' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-broll-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const i2v = await getModelProfileByEndpoint(tdb.db, I2V_ENDPOINT);
  const r2v = await getModelProfileByEndpoint(tdb.db, R2V_ENDPOINT);
  if (i2v === undefined || r2v === undefined) throw new Error('perfiles de b-roll no sembrados');
  i2vProfile = i2v;
  r2vProfile = r2v;
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

function deps() {
  return {
    db: tdb.db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    sleep: () => Promise.resolve(),
    falOptions: { pollIntervalMs: 0 },
  };
}

describe('runGenerateBroll — clip de b-roll (Verificación T4.8)', () => {
  it('i2v: sube el keyframe → image_url + duration enum + generate_audio:false; broll_clip + cost por segundo', async () => {
    const { getSubmitBody } = happyBroll(I2V_ENDPOINT, 'i2v');
    const keyframe = await makeImageAsset('keyframe');

    const res = await runGenerateBroll(deps(), {
      brollModelProfileId: i2vProfile.id,
      imageAssetIds: [keyframe.id],
      durationSeconds: 8,
      aspectRatio: '9:16',
      resolution: '720p',
      prompt: 'A creator applies the serum in a bright bathroom',
    });

    // PAYLOAD i2v (bypass del adapter): image_url (start frame) + duration ENUM ("8s") + aspect_ratio +
    // resolution + generate_audio FALSE (b-roll silencioso). NO duration_seconds/enable_audio (campos del
    // adapter que Veo rechaza), NO image_urls (eso es R2V).
    const body = getSubmitBody();
    expect(body?.image_url).toBeDefined();
    expect(body?.duration).toBe('8s');
    expect(body?.aspect_ratio).toBe('9:16');
    expect(body?.resolution).toBe('720p');
    expect(body?.generate_audio).toBe(false);
    expect(body).not.toHaveProperty('duration_seconds');
    expect(body).not.toHaveProperty('enable_audio');
    expect(body).not.toHaveProperty('image_urls');

    const gen = await getGeneration(tdb.db, res.generation.id);
    expect(gen?.status).toBe('completed');
    // Duración = el enum ENVIADO (el output no la trae), NO otro número.
    expect(gen?.durationS).toBeCloseTo(8, 3);

    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('broll_clip');
    expect(asset?.mime).toBe('video/mp4');
    expect(asset?.durationS).toBeCloseTo(8, 3);
    const bytes = await new Response(await storage.get(asset!.storageKey)).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(MP4_BYTES);

    // Coste 20¢/s × 8 s = 160¢. UN cost_entry, unit='seconds', quantity=8 (el enum entero).
    expect(res.costCents).toBe(160);
    const costs = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.generationId, res.generation.id),
    });
    expect(costs).toHaveLength(1);
    expect(costs[0]?.unit).toBe('seconds');
    expect(costs[0]?.amountCents).toBe(160);
    expect(costs[0]?.quantity).toBe(8);
  });

  it('R2V: sube las referencias del producto → image_urls[] (array), no image_url', async () => {
    const { getSubmitBody } = happyBroll(R2V_ENDPOINT, 'r2v');
    const ref1 = await makeImageAsset('product_image');
    const ref2 = await makeImageAsset('product_image');

    const res = await runGenerateBroll(deps(), {
      brollModelProfileId: r2vProfile.id,
      imageAssetIds: [ref1.id, ref2.id],
      durationSeconds: 8,
      aspectRatio: '9:16',
      resolution: '1080p',
    });

    const body = getSubmitBody();
    // R2V usa image_urls (ARRAY de referencias del producto), NO image_url.
    expect(Array.isArray(body?.image_urls)).toBe(true);
    expect((body?.image_urls as string[]).length).toBe(2);
    expect(body).not.toHaveProperty('image_url');
    expect(body?.generate_audio).toBe(false);
    expect(body?.duration).toBe('8s');

    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('broll_clip');
    expect(res.costCents).toBe(160); // 20¢/s × 8 s
  });

  it('la 2ª generación con el MISMO keyframe REUTILIZA la fal-URL (cache-hit, no re-sube)', async () => {
    happyBroll(I2V_ENDPOINT, 'cache1');
    const keyframe = await makeImageAsset('keyframe');
    await runGenerateBroll(deps(), {
      brollModelProfileId: i2vProfile.id,
      imageAssetIds: [keyframe.id],
      durationSeconds: 6,
      aspectRatio: '9:16',
    });
    const after1 = await getAsset(tdb.db, keyframe.id);
    expect(after1?.falUrl).not.toBeNull();
    const uploadedAt1 = after1?.falUploadedAt;

    happyBroll(I2V_ENDPOINT, 'cache2');
    await runGenerateBroll(deps(), {
      brollModelProfileId: i2vProfile.id,
      imageAssetIds: [keyframe.id],
      durationSeconds: 6,
      aspectRatio: '9:16',
    });
    const after2 = await getAsset(tdb.db, keyframe.id);
    expect(after2?.falUploadedAt?.getTime()).toBe(uploadedAt1?.getTime());
  });

  it('CONTROL NEGATIVO: output SIN video → falla, generation `failed`, sin asset broll_clip', async () => {
    const req = 'BRL-novideo';
    const status = `https://queue.fal.run/${I2V_ENDPOINT}/requests/${req}/status`;
    const response = `https://queue.fal.run/${I2V_ENDPOINT}/requests/${req}`;
    server.use(
      ...uploadHandlers(),
      http.post(`https://queue.fal.run/${I2V_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: req,
          status_url: status,
          response_url: response,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
      http.get(response, () => HttpResponse.json({ images: [{ url: 'https://x/y.png' }] })),
    );
    const keyframe = await makeImageAsset('keyframe');

    const res = await runGenerateBroll(deps(), {
      brollModelProfileId: i2vProfile.id,
      imageAssetIds: [keyframe.id],
      durationSeconds: 8,
      aspectRatio: '9:16',
    }).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(Error);

    const gens = await tdb.db.query.generation.findMany({
      where: (g, { eq }) => eq(g.modelProfileId, i2vProfile.id),
    });
    const failed = gens.find((g) => g.status === 'failed');
    expect(failed).toBeDefined();
    const assets = await tdb.db.query.asset.findMany({
      where: (a, { eq }) => eq(a.generationId, failed!.id),
    });
    expect(assets).toHaveLength(0);
  });

  it('el catch de degradación NO enmascara la causa raíz: si el UPDATE de failed falla, sale el error de FAL', async () => {
    // Lección T1.8: el catch marca `failed` en una tx; si ESA tx lanza (BD caída), su error NO debe
    // enterrar el `err` original de fal. Se fuerza AMBOS: (1) fal devuelve un output sin vídeo →
    // FalResponseError; (2) la tx de degradación del catch rechaza (db.transaction envuelto). El error que
    // SALE de runGenerateBroll debe ser el de fal (contiene "no trae vídeo"), no el de la tx ("degrade boom").
    const req = 'BRL-maskcause';
    const status = `https://queue.fal.run/${I2V_ENDPOINT}/requests/${req}/status`;
    const response = `https://queue.fal.run/${I2V_ENDPOINT}/requests/${req}`;
    server.use(
      ...uploadHandlers(),
      http.post(`https://queue.fal.run/${I2V_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: req,
          status_url: status,
          response_url: response,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
      // Output SIN vídeo → FalResponseError "no trae vídeo" (la causa raíz que debe sobrevivir).
      http.get(response, () => HttpResponse.json({ images: [{ url: 'https://x/y.png' }] })),
    );
    const keyframe = await makeImageAsset('keyframe');

    // db envuelto: delega todo al real EXCEPTO `transaction`, que rechaza (simula BD caída en el catch).
    // La tx de liquidación del happy path NUNCA se alcanza aquí (extractVideoOutput lanza antes), así que
    // el ÚNICO uso de `transaction` es la degradación del catch → este proxy solo afecta a esa ruta.
    const brokenTxDb = new Proxy(tdb.db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return () => Promise.reject(new Error('degrade boom (BD caída simulada)'));
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const err = await runGenerateBroll(
      { ...deps(), db: brokenTxDb },
      {
        brollModelProfileId: i2vProfile.id,
        imageAssetIds: [keyframe.id],
        durationSeconds: 8,
        aspectRatio: '9:16',
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    // La CAUSA RAÍZ (fal, "no trae vídeo") sobrevive; el error de la tx de degradación NO la enmascara.
    expect((err as Error).message).toContain('no trae vídeo');
    expect((err as Error).message).not.toContain('degrade boom');
  });

  it('R2V sin imágenes de referencia → falla ANTES de gastar (no submit)', async () => {
    // Sin referencias no hay fidelidad de producto: fallo honesto ANTES de llamar. NO se registra ningún
    // handler de fal: si intentara subir/llamar, msw reventaría con onUnhandledRequest:'error'.
    const res = await runGenerateBroll(deps(), {
      brollModelProfileId: r2vProfile.id,
      imageAssetIds: [],
      durationSeconds: 8,
      aspectRatio: '9:16',
    }).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(Error);
  });
});
