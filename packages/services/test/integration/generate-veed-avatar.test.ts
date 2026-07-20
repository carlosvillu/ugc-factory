// Cadena de la Verificación de T4.7b (regla de trabajo 8): la ruta VEED del clip de avatar. El servicio
// hace text-to-video (VEED), descarga el clip, EXTRAE su audio con ffmpeg (aquí un runner FAKE — el gate
// no corre ffmpeg; la extracción real la verifica el verifier en la imagen del worker), sube el audio a
// fal, lo pasa por el ASR y sella los word timestamps. Persiste:
//  · `generation` del clip completed (kind='avatar_clip');
//  · un asset `tts_audio` con `word_timestamps` (el kind que T5.4 lee);
//  · DOS cost_entry provider='fal': el clip VEED (por MINUTO) + el ASR — AMBOS no-cero (anti-fuga: el
//    bug de money-path de T4.7b era que VEED `unit:'minute'` se degradaba a 0¢).
//
// fal HTTP mockeado con msw (CERO red real). El output de VEED es `{video:{url, content_type}}` SIN
// `duration` (VEED no la emite — la duración la mide ffprobe, aquí un runner FAKE). El submit es
// `{text, avatar_id}` (contrato REAL de fal, aseverado en un test dedicado). Molde: `generate-avatar.test.ts`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getAsset,
  getGeneration,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
  seedGallery,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runGenerateVeedAvatar } from '../../src/generate-veed-avatar';
import {
  AudioExtractionError,
  VideoProbeError,
  type FfmpegRunner,
  type FfprobeRunner,
} from '../../src/extract-audio-track';

const VEED_ENDPOINT = 'veed/avatars/text-to-video';
const ASR_ENDPOINT = 'fal-ai/elevenlabs/speech-to-text';

const VIDEO_URL = 'https://v3.fal.media/files/veed/clip.mp4';
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // ftyp box
const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]); // RIFF + payload

// El output del ASR: 3 palabras con tiempos válidos (cobertura 100%). Shape real de elevenlabs STT. El
// último `end` (~24 s) fija la duración del audio → coste del ASR: 3¢/min × (24/60) = 1,2¢ → 1¢ (round),
// NO 0¢. Un audio muy corto (<10 s) redondearía el ASR a 0¢ — se usa una duración realista de hook.
const ASR_OUTPUT = {
  text: 'watch this now',
  words: [
    { text: 'watch', type: 'word', start: 0.0, end: 8.0 },
    { text: 'this', type: 'word', start: 8.0, end: 16.0 },
    { text: 'now', type: 'word', start: 16.0, end: 24.0 },
  ],
};

/** Handlers del upload a fal storage (el audio EXTRAÍDO se sube antes del ASR). */
function uploadHandlers(): Parameters<typeof server.use> {
  return [
    http.post('https://rest.fal.ai/storage/upload/initiate', () =>
      HttpResponse.json({
        upload_url: 'https://storage.fal.run/upload/input',
        file_url: 'https://fal.media/files/extracted-audio',
      }),
    ),
    http.put('https://storage.fal.run/upload/input', () => new HttpResponse(null, { status: 200 })),
  ];
}

/** Captura el body del ÚLTIMO submit a VEED (para asertar el CONTRATO `{text, avatar_id}` — el bug de
 *  T4.7b fue mandar `{prompt}`, que fal rechaza con 422; el mock aceptaba cualquier payload y no lo cazó). */
let lastVeedSubmitBody: Record<string, unknown> | null = null;

/** Camino feliz: submit+poll de VEED, descarga del .mp4, upload del audio, submit+poll del ASR. `suffix`
 *  hace únicos los `fal_request_id` por test (la columna es UNIQUE). El output de VEED refleja el REAL:
 *  `{video:{url, content_type}}` SIN `duration` (VEED no la emite — la duración la mide ffprobe) y con
 *  `content_type: 'application/octet-stream'` (lo que fal devuelve; el servicio fuerza `video/mp4`). */
function happyVeed(opts: { suffix?: string } = {}): void {
  const s = opts.suffix ?? '1';
  const veedReq = `VEED-${s}`;
  const veedStatus = `https://queue.fal.run/${VEED_ENDPOINT}/requests/${veedReq}/status`;
  const veedResponse = `https://queue.fal.run/${VEED_ENDPOINT}/requests/${veedReq}`;
  const veedOutput: Record<string, unknown> = {
    video: { url: VIDEO_URL, content_type: 'application/octet-stream' },
  };

  const asrReq = `ASR-${s}`;
  const asrStatus = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}/status`;
  const asrResponse = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}`;

  server.use(
    ...uploadHandlers(),
    // VEED text-to-video — captura el body para el aserto de contrato del submit.
    http.post(`https://queue.fal.run/${VEED_ENDPOINT}`, async ({ request }) => {
      lastVeedSubmitBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        request_id: veedReq,
        status_url: veedStatus,
        response_url: veedResponse,
        cancel_url: `${veedResponse}/cancel`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(veedStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: veedReq })),
    http.get(veedResponse, () => HttpResponse.json(veedOutput)),
    http.get(VIDEO_URL, () =>
      HttpResponse.arrayBuffer(MP4_BYTES.buffer, { headers: { 'content-type': 'video/mp4' } }),
    ),
    // ASR sobre el audio extraído
    http.post(`https://queue.fal.run/${ASR_ENDPOINT}`, () =>
      HttpResponse.json({
        request_id: asrReq,
        status_url: asrStatus,
        response_url: asrResponse,
        cancel_url: `${asrResponse}/cancel`,
        status: 'IN_QUEUE',
      }),
    ),
    http.get(asrStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: asrReq })),
    http.get(asrResponse, () => HttpResponse.json(ASR_OUTPUT)),
  );
}

/** ffmpeg FAKE: "extrae" el audio escribiendo un WAV de fixture en el outPath. Éxito (exit 0). */
const fakeFfmpegOk: FfmpegRunner = async (args: string[]) => {
  const { writeFile } = await import('node:fs/promises');
  const outPath = args.at(-1) ?? '';
  await writeFile(outPath, WAV_BYTES);
  return { code: 0, stderr: '' };
};

/** ffprobe FAKE: VEED no emite `duration`, así que el servicio la MIDE con ffprobe. Devuelve 8,2 s — la
 *  duración REALISTA de un hook UGC (NO 60 s: un clip de hook dura pocos segundos). Es deliberado: con la
 *  duración real < el mínimo de facturación de VEED (60 s), el test EJERCITA el floor de `minBilledSeconds`
 *  (8,2 s reales → se factura 1 min → 35¢). Un fake de 60 s ocultaría el gap mínimo-vs-real (arnés cómodo). */
const HOOK_DURATION_SECONDS = 8.2;
const fakeFfprobeOk: FfprobeRunner = () =>
  Promise.resolve({ code: 0, stdout: `${String(HOOK_DURATION_SECONDS)}\n`, stderr: '' });

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let veedProfile: ModelProfile;
let asrProfile: ModelProfile;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-veed-avatar' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-veed-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const veed = await getModelProfileByEndpoint(tdb.db, VEED_ENDPOINT);
  const asr = await getModelProfileByEndpoint(tdb.db, ASR_ENDPOINT);
  if (veed === undefined || asr === undefined) throw new Error('perfiles VEED/ASR no sembrados');
  veedProfile = veed;
  asrProfile = asr;
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

function deps(ffmpeg: FfmpegRunner = fakeFfmpegOk, ffprobe: FfprobeRunner = fakeFfprobeOk) {
  return {
    db: tdb.db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    ffmpeg,
    ffprobe,
    sleep: () => Promise.resolve(),
    falOptions: { pollIntervalMs: 0 },
  };
}

describe('runGenerateVeedAvatar — ruta VEED de N7c (Verificación T4.7b)', () => {
  it('genera clip VEED, extrae audio con ffmpeg, ASR → word timestamps + DOS cost_entry no-cero', async () => {
    happyVeed({ suffix: 'ok' });

    const res = await runGenerateVeedAvatar(deps(), {
      veedModelProfileId: veedProfile.id,
      asrModelProfileId: asrProfile.id,
      text: 'Watch this now — it changes everything.',
      asrLanguageCode: 'eng',
    });

    // CONTRATO DEL SUBMIT (el bug de T4.7b: se mandaba `{prompt}`, que fal rechaza con 422). VEED exige
    // `{text, avatar_id}`. El `avatar_id` sale del `capabilities.avatarId` del perfil sembrado (vertical).
    expect(lastVeedSubmitBody).toEqual({
      text: 'Watch this now — it changes everything.',
      avatar_id: 'emily_vertical_primary',
    });
    expect(lastVeedSubmitBody).not.toHaveProperty('prompt');

    // El clip: generation completed, asset avatar_clip (VÍDEO, no keyframe).
    const gen = await getGeneration(tdb.db, res.generation.id);
    expect(gen?.status).toBe('completed');
    const clipAsset = await getAsset(tdb.db, res.assetId);
    expect(clipAsset?.kind).toBe('avatar_clip');
    expect(clipAsset?.mime).toBe('video/mp4');

    // El audio EXTRAÍDO: asset tts_audio con word_timestamps sellados (el kind que T5.4 lee).
    const audioAsset = await getAsset(tdb.db, res.audioAssetId);
    expect(audioAsset?.kind).toBe('tts_audio');
    expect(audioAsset?.wordTimestamps).not.toBeNull();
    expect(res.wordCount).toBe(3);

    // ANTI-FUGA + FLOOR DE FACTURACIÓN (T4.7b): el clip dura 8,2 s reales, PERO VEED cobra un mínimo de
    // 1 min → 35¢/min × max(8,2, 60)/60 = 35¢, NO 8,2/60×35 ≈ 5¢ (under-count del money-path) ni 0¢ (la
    // fuga original de `unit:'minute'`). La duración REAL (8,2 s) sí va al ledger como quantity.
    expect(res.clipCostCents).toBe(35);
    expect(res.durationSeconds).toBeCloseTo(8.2, 1);
    expect(res.asrCostCents).toBeGreaterThan(0);

    // DOS cost_entry provider='fal' atados a la generación, AMBOS no-cero.
    const costs = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.generationId, res.generation.id),
    });
    expect(costs).toHaveLength(2);
    for (const c of costs) {
      expect(c.provider).toBe('fal');
      expect(c.amountCents).toBeGreaterThan(0);
    }
    // El cargo del clip es de 35¢ (por minuto); el otro es el ASR.
    expect(costs.some((c) => c.amountCents === 35)).toBe(true);
  });

  it('un fallo de ffmpeg NO se disfraza de fal: AudioExtractionError sobrevive, generation → failed', async () => {
    happyVeed({ suffix: 'ffmpegfail' });
    const failingFfmpeg: FfmpegRunner = () =>
      Promise.resolve({ code: 1, stderr: 'Invalid data found when processing input' });

    const err = await runGenerateVeedAvatar(deps(failingFfmpeg), {
      veedModelProfileId: veedProfile.id,
      asrModelProfileId: asrProfile.id,
      text: 'This clip will fail extraction.',
    }).catch((e: unknown) => e);

    // El tipo del error se PRESERVA (anti-T1.8): es de la capa ffmpeg, no de fal.
    expect(err).toBeInstanceOf(AudioExtractionError);
    expect((err as AudioExtractionError).exitCode).toBe(1);
  });

  it('un fallo de ffprobe (medir duración) NO se disfraza de fal: VideoProbeError, sin cost_entry del clip', async () => {
    happyVeed({ suffix: 'probefail' });
    const failingFfprobe: FfprobeRunner = () =>
      Promise.resolve({ code: 1, stdout: '', stderr: 'Invalid data found when processing input' });

    const err = await runGenerateVeedAvatar(deps(fakeFfmpegOk, failingFfprobe), {
      veedModelProfileId: veedProfile.id,
      asrModelProfileId: asrProfile.id,
      text: 'This clip will fail duration probing.',
    }).catch((e: unknown) => e);

    // El tipo del error se PRESERVA (anti-T1.8): es de la capa ffprobe (`VideoProbeError`), NO de fal ni
    // de la extracción de audio. El probe corre ANTES de facturar → la generación NO queda `completed` ni
    // se liquida el clip (sin `cost_entry` ni asset del clip por este intento).
    expect(err).toBeInstanceOf(VideoProbeError);
    expect((err as VideoProbeError).exitCode).toBe(1);
    // La generación de este texto degradó a `failed` (no `completed`) — nunca se facturó el clip.
    const gen = await tdb.db.query.generation.findFirst({
      where: (g, { eq }) => eq(g.resolvedPrompt, 'This clip will fail duration probing.'),
    });
    expect(gen?.status).toBe('failed');
    const clipAsset =
      gen === undefined
        ? undefined
        : await tdb.db.query.asset.findFirst({
            where: (a, { eq, and }) => and(eq(a.generationId, gen.id), eq(a.kind, 'avatar_clip')),
          });
    expect(clipAsset).toBeUndefined();
  });

  // DEDUP §9.6: dos generaciones con el MISMO `text` comparten `content_hash`. La 2ª REUTILIZA el clip
  // completed de la 1ª SIN llamar a fal (0 coste). El contrato crítico: la rama de reúso debe resolver el
  // asset `tts_audio` HERMANO (no el `avatar_clip`) y devolver sus timestamps sellados — un bug de T4.7b
  // devolvía el assetId del clip como `audioAssetId` y `wordCount:0`, un falso éxito en el money-path.
  it('dedup hit: 2ª corrida con el MISMO texto reutiliza el clip y devuelve el asset tts_audio con timestamps', async () => {
    const text = 'Same hook text, generated twice — the second run must dedup.';
    happyVeed({ suffix: 'dedupA' });
    const first = await runGenerateVeedAvatar(deps(), {
      veedModelProfileId: veedProfile.id,
      asrModelProfileId: asrProfile.id,
      text,
      asrLanguageCode: 'eng',
    });
    expect(first.reused).toBe(false);

    // 2ª corrida: CERO handlers de fal registrados (`server.resetHandlers` en afterEach no corre entre
    // llamadas del mismo test) — si el servicio submitease a fal, msw daría 'error' (onUnhandledRequest).
    // Solo el dedup (lookup en BD) puede resolverla. El ffmpeg fake NO debe invocarse (no se re-extrae).
    server.resetHandlers();
    const ffmpegSpy: FfmpegRunner = () => {
      throw new Error('el reúso NO debe re-extraer audio con ffmpeg');
    };
    const second = await runGenerateVeedAvatar(deps(ffmpegSpy), {
      veedModelProfileId: veedProfile.id,
      asrModelProfileId: asrProfile.id,
      text,
      asrLanguageCode: 'eng',
    });

    expect(second.reused).toBe(true);
    expect(second.clipCostCents).toBe(0);
    expect(second.asrCostCents).toBe(0);
    // Reutiliza la MISMA generation y el MISMO asset de clip que la 1ª.
    expect(second.generation.id).toBe(first.generation.id);
    expect(second.assetId).toBe(first.assetId);
    // CONTRATO CRÍTICO: `audioAssetId` es el asset tts_audio (con timestamps), NO el clip avatar_clip.
    expect(second.audioAssetId).toBe(first.audioAssetId);
    const audioAsset = await getAsset(tdb.db, second.audioAssetId);
    expect(audioAsset?.kind).toBe('tts_audio');
    expect(audioAsset?.wordTimestamps).not.toBeNull();
    expect(second.wordCount).toBe(3); // wordCount REAL de los timestamps sellados, no 0
    // El reúso NO añade cost_entry: siguen siendo los 2 de la 1ª corrida.
    const costs = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.generationId, first.generation.id),
    });
    expect(costs).toHaveLength(2);
  });

  // ANTI-PATRÓN "arnés más cómodo que la realidad": un clip VEED puede quedar `completed` (clip facturado,
  // guard de degradación) con su cadena de audio ROTA — el `tts_audio` se crea ANTES del ASR, así que un
  // fallo del ASR deja un `tts_audio` SIN timestamps. La rama de reúso NO debe tragarse eso como éxito: un
  // retry con el mismo texto debe LANZAR, no devolver `wordCount:0`.
  it('reúso de un clip completed cuyo tts_audio NO tiene timestamps → LANZA (no falso éxito)', async () => {
    const text = 'Hook whose ASR fails, leaving audio unsealed.';
    // 1ª corrida: VEED ok, pero el ASR devuelve un output que NO encaja WordTimestampsSchema → throw tras
    // liquidar el clip. El clip queda `completed`; el `tts_audio` se creó (paso 6) SIN timestamps sellados.
    happyVeed({ suffix: 'unsealed' });
    server.use(
      http.get(
        `https://queue.fal.run/${ASR_ENDPOINT}/requests/ASR-unsealed`,
        () => HttpResponse.json({ text: 'garbage', words: 'not-an-array' }), // no encaja el schema
      ),
    );
    const firstErr = await runGenerateVeedAvatar(deps(), {
      veedModelProfileId: veedProfile.id,
      asrModelProfileId: asrProfile.id,
      text,
      asrLanguageCode: 'eng',
    }).catch((e: unknown) => e);
    expect(firstErr).toBeInstanceOf(Error);
    // El clip quedó `completed` pese al fallo del ASR (guard de degradación sobre una fila ya completed):
    // localizamos ESA generación por su `content_hash` (el mismo `text` la re-encuentra por dedup abajo).
    const stuckGen = await tdb.db.query.generation.findFirst({
      where: (g, { eq, and }) => and(eq(g.resolvedPrompt, text), eq(g.status, 'completed')),
    });
    expect(stuckGen?.status).toBe('completed');

    // 2ª corrida (retry): el dedup encuentra el clip completed → resuelve el `tts_audio` hermano → sus
    // timestamps son null → LANZA. NO devuelve un `wordCount:0` disfrazado de éxito.
    server.resetHandlers();
    const secondErr = await runGenerateVeedAvatar(deps(), {
      veedModelProfileId: veedProfile.id,
      asrModelProfileId: asrProfile.id,
      text,
      asrLanguageCode: 'eng',
    }).catch((e: unknown) => e);
    expect(secondErr).toBeInstanceOf(Error);
    expect((secondErr as Error).message).toMatch(/word_timestamps|reutilizable/);
  });
});
