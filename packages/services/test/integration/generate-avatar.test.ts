// Cadena de la Verificación de T4.7 (regla de trabajo 8): el servicio de CLIP DE AVATAR sube imagen +
// audio a fal storage (caché §9.6), invoca el avatar (HTTP mockeado con msw — CERO red real, cero
// gasto) y persiste:
//  · `generation` submitting→submitted→completed, con las URLs TAL CUAL fal las devuelve;
//  · el .mp4 del output descargado a NUESTRO storage como `asset` kind='avatar_clip' con `duration_s`;
//  · UN `cost_entry` provider='fal' unit='seconds' (una llamada = un cargo, por SEGUNDO del clip).
//
// El output del avatar se DERIVA del schema confirmado (WebFetch 2026-07-17): `{video:{url}, duration}`
// con `duration` a nivel raíz. Los modelos de avatar están prohibidos en la suite live (external-apis
// §8): el smoke del verifier confirma la forma en vivo. Molde: `generate-audio.test.ts` de T4.5.
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
  updateGeneration,
  type Asset,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runGenerateAvatar } from '../../src/generate-avatar';

const KLING_ENDPOINT = 'fal-ai/kling-video/ai-avatar/v2/standard';
const OMNIHUMAN_ENDPOINT = 'fal-ai/bytedance/omnihuman/v1.5';

// El output de avatar REAL sería un .mp4; para el fake bastan bytes válidos que el StorageAdapter
// pueda hashear. La URL pública que el avatar "emitiría".
const VIDEO_URL = 'https://v3.fal.media/files/avatar/clip.mp4';
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // ftyp box mínimo
// Bytes de los inputs (imagen de Persona + audio del hook) que se suben a fal storage.
const IMG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF magic

/** Handlers del upload a fal storage (flujo initiate + PUT, §9.6). El FalClient sube los bytes de cada
 *  input y fal devuelve una `file_url` pública. Se registran por test (resetHandlers los limpia). Cada
 *  initiate devuelve la MISMA `upload_url`/`file_url`: basta para que ambos inputs (imagen+audio) suban;
 *  el cache-hit del 2º clip ni siquiera llama al initiate. */
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

/** Registra el camino feliz: uploadInput de imagen+audio, submit+poll del avatar, descarga del .mp4.
 *  `duration` en el output = 4 s (a nivel raíz, hermano de `video`). El request_id es canario. */
function happyAvatar(endpoint: string, reqSuffix: string, opts: { duration?: number } = {}): void {
  const req = `AVA-${reqSuffix}`;
  const status = `https://queue.fal.run/${endpoint}/requests/${req}/status`;
  const response = `https://queue.fal.run/${endpoint}/requests/${req}`;
  const output: Record<string, unknown> = {
    video: { url: VIDEO_URL, content_type: 'video/mp4' },
  };
  if (opts.duration !== undefined) output.duration = opts.duration;
  server.use(
    ...uploadHandlers(),
    http.post(`https://queue.fal.run/${endpoint}`, () =>
      HttpResponse.json({
        request_id: req,
        status_url: status,
        response_url: response,
        cancel_url: `${response}/cancel`,
        status: 'IN_QUEUE',
      }),
    ),
    http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
    http.get(response, () => HttpResponse.json(output)),
    http.get(VIDEO_URL, () =>
      HttpResponse.arrayBuffer(MP4_BYTES.buffer, { headers: { 'content-type': 'video/mp4' } }),
    ),
  );
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let klingProfile: ModelProfile;
let omnihumanProfile: ModelProfile;

/** Crea un asset de INPUT (imagen o audio) en storage + BD, con `fal_url=null` (fuerza el upload). */
async function makeInputAsset(
  kind: Asset['kind'],
  bytes: Uint8Array,
  mime: string,
  durationS?: number,
): Promise<Asset> {
  const key = `inputs/${kind}/${Math.random().toString(36).slice(2)}`;
  const put = await storage.put(key, bytes, { mime });
  return createAsset(tdb.db, {
    kind,
    storageKey: key,
    mime,
    bytes: put.bytes,
    checksum: put.checksum,
    ...(durationS !== undefined ? { durationS } : {}),
  });
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-avatar' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-avatar-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const kling = await getModelProfileByEndpoint(tdb.db, KLING_ENDPOINT);
  const omni = await getModelProfileByEndpoint(tdb.db, OMNIHUMAN_ENDPOINT);
  if (kling === undefined || omni === undefined) throw new Error('perfiles de avatar no sembrados');
  klingProfile = kling;
  omnihumanProfile = omni;
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

describe('runGenerateAvatar — clip de avatar image+audio (Verificación T4.7)', () => {
  it('KLING Std: sube imagen+audio, genera clip avatar_clip con duration_s + 1 cost_entry por segundo', async () => {
    happyAvatar(KLING_ENDPOINT, 'kling', { duration: 4 });
    const image = await makeInputAsset('reference_image', IMG_BYTES, 'image/png');
    const audio = await makeInputAsset('tts_audio', WAV_BYTES, 'audio/wav', 4);

    const res = await runGenerateAvatar(deps(), {
      avatarModelProfileId: klingProfile.id,
      imageAssetId: image.id,
      audioAssetId: audio.id,
      prompt: 'La persona sonríe y habla a cámara',
    });

    const gen = await getGeneration(tdb.db, res.generation.id);
    expect(gen?.status).toBe('completed');
    expect(gen?.durationS).toBeCloseTo(4, 3);

    // El asset es VÍDEO (kind='avatar_clip'), NO 'keyframe' — la barrera contra el finalizer de imagen.
    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('avatar_clip');
    expect(asset?.mime).toBe('video/mp4');
    expect(asset?.durationS).toBeCloseTo(4, 3);
    expect(asset?.generationId).toBe(res.generation.id);
    const bytes = await new Response(await storage.get(asset!.storageKey)).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(MP4_BYTES);

    // UN cost_entry (una llamada = un cargo), unit='seconds'. Kling 5,62¢/s × 4 s = 22,48 → 22¢.
    expect(res.costCents).toBe(22);
    const costs = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.generationId, res.generation.id),
    });
    expect(costs).toHaveLength(1);
    expect(costs[0]?.unit).toBe('seconds');
    expect(costs[0]?.amountCents).toBe(22);
    expect(costs[0]?.provider).toBe('fal');
    expect(costs[0]?.quantity).toBe(4);
  });

  it('OMNIHUMAN Premium: 16¢/s; añade `resolution` al payload; duración del output', async () => {
    let submitBody: Record<string, unknown> | undefined;
    const req = 'AVA-omni';
    const status = `https://queue.fal.run/${OMNIHUMAN_ENDPOINT}/requests/${req}/status`;
    const response = `https://queue.fal.run/${OMNIHUMAN_ENDPOINT}/requests/${req}`;
    server.use(
      ...uploadHandlers(),
      http.post(`https://queue.fal.run/${OMNIHUMAN_ENDPOINT}`, async ({ request }) => {
        submitBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          request_id: req,
          status_url: status,
          response_url: response,
          status: 'IN_QUEUE',
        });
      }),
      http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
      http.get(response, () =>
        HttpResponse.json({ video: { url: VIDEO_URL, content_type: 'video/mp4' }, duration: 5 }),
      ),
      http.get(VIDEO_URL, () =>
        HttpResponse.arrayBuffer(MP4_BYTES.buffer, { headers: { 'content-type': 'video/mp4' } }),
      ),
    );
    const image = await makeInputAsset('reference_image', IMG_BYTES, 'image/png');
    const audio = await makeInputAsset('tts_audio', WAV_BYTES, 'audio/wav', 5);

    const res = await runGenerateAvatar(deps(), {
      avatarModelProfileId: omnihumanProfile.id,
      imageAssetId: image.id,
      audioAssetId: audio.id,
      resolution: '1080p',
    });

    // El payload lleva image_url/audio_url/prompt + resolution (bypass del adapter: campos DIRECTOS del
    // modelo, sin aspect_ratio/duration_seconds/enable_audio que el adapter emite y el modelo rechaza).
    expect(submitBody?.image_url).toBeDefined();
    expect(submitBody?.audio_url).toBeDefined();
    expect(submitBody?.prompt).toBe('.'); // default cuando no se pasa prompt
    expect(submitBody?.resolution).toBe('1080p');
    expect(submitBody).not.toHaveProperty('aspect_ratio');
    expect(submitBody).not.toHaveProperty('duration_seconds');
    expect(submitBody).not.toHaveProperty('enable_audio');

    // Coste: 16¢/s × 5 s = 80¢.
    expect(res.costCents).toBe(80);
    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('avatar_clip');
    expect(asset?.durationS).toBeCloseTo(5, 3);
  });

  it('FALLBACK de duración: si el output no trae `duration`, cae a la duración del AUDIO de entrada', async () => {
    // Kling puede no emitir `duration`; el clip dura lo que el audio (`duración = audio automáticamente`).
    happyAvatar(KLING_ENDPOINT, 'nodur'); // sin duration en el output
    const image = await makeInputAsset('reference_image', IMG_BYTES, 'image/png');
    const audio = await makeInputAsset('tts_audio', WAV_BYTES, 'audio/wav', 3);

    const res = await runGenerateAvatar(deps(), {
      avatarModelProfileId: klingProfile.id,
      imageAssetId: image.id,
      audioAssetId: audio.id,
    });
    // Duración = la del audio (3 s). Coste 5,62¢/s × 3 = 16,86 → 17¢.
    expect(res.durationSeconds).toBeCloseTo(3, 3);
    expect(res.costCents).toBe(17);
  });

  it('la 2ª generación de la MISMA Persona/hook REUTILIZA las fal-URLs (cache-hit, no re-sube)', async () => {
    // La caché §9.6 de `uploadInputCached`: el asset ya tiene `fal_url` poblada → cache-hit, `fal_uploaded_at`
    // no cambia. Se comprueba que ambos assets quedan con fal_url y que el 2º clip no falla.
    happyAvatar(KLING_ENDPOINT, 'cache1', { duration: 4 });
    const image = await makeInputAsset('reference_image', IMG_BYTES, 'image/png');
    const audio = await makeInputAsset('tts_audio', WAV_BYTES, 'audio/wav', 4);
    await runGenerateAvatar(deps(), {
      avatarModelProfileId: klingProfile.id,
      imageAssetId: image.id,
      audioAssetId: audio.id,
    });
    const imgAfter1 = await getAsset(tdb.db, image.id);
    const uploadedAt1 = imgAfter1?.falUploadedAt;
    expect(imgAfter1?.falUrl).not.toBeNull();

    happyAvatar(KLING_ENDPOINT, 'cache2', { duration: 4 });
    await runGenerateAvatar(deps(), {
      avatarModelProfileId: klingProfile.id,
      imageAssetId: image.id,
      audioAssetId: audio.id,
    });
    const imgAfter2 = await getAsset(tdb.db, image.id);
    // fal_uploaded_at NO cambió → cache-hit (no se re-subió).
    expect(imgAfter2?.falUploadedAt?.getTime()).toBe(uploadedAt1?.getTime());
  });

  it('CONTROL NEGATIVO: output SIN video ({audio:{url}} por error) → falla, generation `failed`, sin asset', async () => {
    // Si el avatar devolviera un output de audio/imagen (contrato equivocado), el servicio DEBE lanzar en
    // la validación de vídeo — NO seguir a la descarga. Barrera contra reusar el finalizer de imagen.
    const req = 'AVA-novideo';
    const status = `https://queue.fal.run/${KLING_ENDPOINT}/requests/${req}/status`;
    const response = `https://queue.fal.run/${KLING_ENDPOINT}/requests/${req}`;
    server.use(
      ...uploadHandlers(),
      http.post(`https://queue.fal.run/${KLING_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: req,
          status_url: status,
          response_url: response,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
      http.get(response, () => HttpResponse.json({ audio: { url: 'https://x/y.wav' } })),
    );
    const image = await makeInputAsset('reference_image', IMG_BYTES, 'image/png');
    const audio = await makeInputAsset('tts_audio', WAV_BYTES, 'audio/wav', 4);

    const res = await runGenerateAvatar(deps(), {
      avatarModelProfileId: klingProfile.id,
      imageAssetId: image.id,
      audioAssetId: audio.id,
    }).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(Error);

    // La generación quedó `failed` (nunca completed), sin asset de vídeo.
    const gens = await tdb.db.query.generation.findMany({
      where: (g, { eq }) => eq(g.modelProfileId, klingProfile.id),
    });
    const failed = gens.find((g) => g.status === 'failed');
    expect(failed).toBeDefined();
    const assets = await tdb.db.query.asset.findMany({
      where: (a, { eq }) => eq(a.generationId, failed!.id),
    });
    expect(assets).toHaveLength(0);
  });

  it('BUG: si otra ruta ya llevó la fila a `completed`, la liquidación NO la voltea a `failed` (no-op gracioso)', async () => {
    // Mundo concurrente de T4.11 (webhook+poll+sweeper): mientras esta llamada descarga el vídeo, OTRA
    // ruta finaliza la MISMA generación. La liquidación de ESTA llamada re-chequea `completed` bajo el
    // lock → no-op gracioso (devuelve el asset ajeno), NUNCA lanza (un throw voltearía a `failed` una
    // fila legítimamente `completed`).
    const req = 'AVA-concurrent';
    const status = `https://queue.fal.run/${KLING_ENDPOINT}/requests/${req}/status`;
    const response = `https://queue.fal.run/${KLING_ENDPOINT}/requests/${req}`;
    const image = await makeInputAsset('reference_image', IMG_BYTES, 'image/png');
    const audio = await makeInputAsset('tts_audio', WAV_BYTES, 'audio/wav', 4);
    server.use(
      ...uploadHandlers(),
      http.post(`https://queue.fal.run/${KLING_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: req,
          status_url: status,
          response_url: response,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
      http.get(response, () =>
        HttpResponse.json({ video: { url: VIDEO_URL, content_type: 'video/mp4' }, duration: 4 }),
      ),
      // Al DESCARGAR el vídeo (justo antes de la liquidación), otra ruta finaliza la fila: crea su asset
      // avatar_clip y la marca `completed`.
      http.get(VIDEO_URL, async () => {
        const [gen] = await tdb.db.query.generation.findMany({
          where: (g, { eq }) => eq(g.falRequestId, req),
        });
        if (gen) {
          const put = await storage.put(`generations/${gen.id}/concurrent.mp4`, MP4_BYTES, {
            mime: 'video/mp4',
          });
          await createAsset(tdb.db, {
            kind: 'avatar_clip',
            storageKey: `generations/${gen.id}/concurrent.mp4`,
            mime: 'video/mp4',
            bytes: put.bytes,
            checksum: put.checksum,
            durationS: 4,
            generationId: gen.id,
          });
          await updateGeneration(tdb.db, gen.id, { status: 'completed', completedAt: new Date() });
        }
        return HttpResponse.arrayBuffer(MP4_BYTES.buffer, {
          headers: { 'content-type': 'video/mp4' },
        });
      }),
    );

    const res = await runGenerateAvatar(deps(), {
      avatarModelProfileId: klingProfile.id,
      imageAssetId: image.id,
      audioAssetId: audio.id,
    });
    // La fila sigue `completed` (NO volteada a failed): el no-op gracioso respetó el estado ajeno.
    expect(res.generation.status).toBe('completed');
    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('avatar_clip');
  });
});
