// Suite MEDIA de la normalización canónica con caché (T5.2, §9.7; testing/references/media-composition.md
// §"Normalización canónica y caché"). Corre ffmpeg de VERDAD — es la única forma honesta de verificar el
// filtergraph, el perfil de encode y la caché. Vive en `apps/worker/test/media/` → proyecto vitest
// `worker:media`, gated por RUN_MEDIA, con ffmpeg/ffprobe de la imagen del worker. NO forma parte de
// `pnpm test` (la suite estándar debe ser rápida y correr en cualquier máquina).
//
// Sin base de datos: la suite `worker:media` no tiene testcontainer. La corrección del repo SQL
// (`getAssetByNormalizedCacheKey`) vive en su db-integration test (en el gate). Aquí la caché se INYECTA
// con Maps en memoria + un runner que CUENTA invocaciones de ffmpeg → así «2ª pasada = 0 ffmpeg» se
// prueba sin Postgres, ejercitando exactamente la lógica de consulta-antes-de-encodear del normalizador.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { StorageAdapter } from '@ugc/core';
import { newUlid } from '@ugc/core/contracts';
import {
  createNormalizer,
  computeNormalizedCacheKey,
  CANONICAL_VIDEO_PROFILE,
  type CreateNormalizedAssetInput,
  type FfmpegRunner,
  type NormalizedAsset,
  type NormalizeSourceAsset,
} from '@ugc/services';
import {
  assertAudioProfile,
  assertVideoProfile,
  makeMediaTestStorage,
  makeTestAudio,
  makeTestVideo,
  makeTestVideoWithVoice,
} from '@ugc/test-utils/media';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { mediaToolsAvailable } from './setup';

const run = promisify(execFile);

// ── Fakes (sin BD): storage local de producción + caché en Maps ──────────────────────────────────────

/** Materializa un asset de storage a un fichero local para sondearlo con ffprobe (el patrón repetido en
 *  cada test de perfil: leer el normalizado del storage y escribirlo a disco). */
async function materializeToFile(
  storage: StorageAdapter,
  key: string,
  outPath: string,
): Promise<string> {
  await writeFile(
    outPath,
    new Uint8Array(await new Response(await storage.get(key)).arrayBuffer()),
  );
  return outPath;
}

/** Runner de ffmpeg REAL que CUENTA invocaciones — el instrumento del test de caché. Devuelve
 *  `{calls}` por referencia para poder leer el contador. */
function makeCountingRunner(): { runner: FfmpegRunner; getCalls: () => number } {
  let calls = 0;
  const runner: FfmpegRunner = (args) => {
    calls++;
    return new Promise((resolve) => {
      execFile('ffmpeg', args, (err, _stdout, stderr) => {
        // execFile llama a cb con err si exit≠0; el runner NUNCA rechaza por exit≠0 (es un resultado).
        let code: number | null;
        if (err && typeof (err as { code?: unknown }).code === 'number') {
          code = (err as { code: number }).code;
        } else if (err) {
          code = null;
        } else {
          code = 0;
        }
        resolve({ code, stderr: stderr });
      });
    });
  };
  return { runner, getCalls: () => calls };
}

/** Caché + creación en memoria (los puertos inyectables del normalizador). Un Map por `normalized_cache_key`. */
function makeInMemoryStore() {
  const byCacheKey = new Map<string, NormalizedAsset>();
  const created: CreateNormalizedAssetInput[] = [];
  return {
    byCacheKey,
    created,
    findByCacheKey: (key: string): Promise<NormalizedAsset | undefined> =>
      Promise.resolve(byCacheKey.get(key)),
    createNormalizedAsset: (input: CreateNormalizedAssetInput): Promise<NormalizedAsset> => {
      const asset: NormalizedAsset = {
        id: newUlid(),
        storageKey: input.storageKey,
        checksum: input.checksum,
        normalizedCacheKey: input.normalizedCacheKey,
      };
      byCacheKey.set(input.normalizedCacheKey, asset);
      created.push(input);
      return Promise.resolve(asset);
    },
  };
}

/** Sube un fichero local a un storage bajo una key y devuelve `{storageKey, checksum}` (el origen que el
 *  normalizador consume: necesita checksum para la cache key). */
async function seedSource(
  storage: StorageAdapter,
  localPath: string,
  key: string,
): Promise<{ storageKey: string; checksum: string }> {
  const bytes = new Uint8Array(await readFile(localPath));
  const { checksum } = await storage.put(key, bytes, {});
  return { storageKey: key, checksum };
}

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ugc-normalize-media-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const p = (name: string): string => join(workDir, name);

describe.skipIf(!mediaToolsAvailable)('normalización canónica y caché (T5.2)', () => {
  // ── 1. PERFIL CANÓNICO: inputs «malos» → cada salida cumple assertVideoProfile / assertAudioProfile ──

  test('un vídeo 720p/25fps/16:9 CON audio sale 1080×1920/30fps/H.264/yuv420p/SAR1:1/-an', async () => {
    const storage = makeMediaTestStorage(workDir);
    const store = makeInMemoryStore();
    // INPUT CON pista de audio (el caso real del clip de avatar): así el assert de «sin stream de audio»
    // en la salida prueba que `-an` DE VERDAD la descartó. Con un input mudo el assert pasaría aunque
    // `-an` no existiera (test vacuo) — por eso se usa `makeTestVideoWithVoice`, no `makeTestVideo`.
    const src = await makeTestVideoWithVoice({
      out: p('bad-video.mp4'),
      width: 1280,
      height: 720,
      fps: 25,
      seconds: 2,
    });
    // Sanity: el INPUT sí trae audio (si no, el assert de salida sería vacuo).
    const { stdout: inAudio } = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      src,
    ]);
    expect(inAudio.trim()).toBe('audio');

    const source = await seedSource(storage, src, 'src/bad-video.mp4');
    const sourceId = newUlid();
    const normalizer = createNormalizer({ storage, ...store });
    const result = await normalizer.normalize({
      id: sourceId,
      storageKey: source.storageKey,
      checksum: source.checksum,
      normalizeAs: 'video',
      normalizedKind: 'avatar_clip',
    });
    // Materializar el normalizado de storage a un fichero para sondearlo con ffprobe.
    const outLocal = await materializeToFile(storage, result.storageKey, p('normalized-video.mp4'));
    await assertVideoProfile(outLocal);
    // -an: el normalizado de vídeo NO lleva audio (el input SÍ lo traía → `-an` lo descartó).
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      outLocal,
    ]);
    expect(stdout.trim()).toBe('');

    // LINAJE + KEY estampados (Entrega §12 l.531-533): el normalizado apunta a su origen y lleva la key
    // pura computada. Sin este assert, `parent_asset_ids=[source.id]` quedaría sin guardar.
    expect(store.created).toHaveLength(1);
    expect(store.created[0]?.parentAssetIds).toEqual([sourceId]);
    expect(store.created[0]?.normalizedCacheKey).toBe(
      computeNormalizedCacheKey({
        sourceChecksum: source.checksum,
        profile: { ...CANONICAL_VIDEO_PROFILE, mediaKind: 'video' },
      }),
    );
  });

  test('un audio arbitrario sale AAC 48 kHz estéreo (audio canónico)', async () => {
    const storage = makeMediaTestStorage(workDir);
    const store = makeInMemoryStore();
    // Un audio «malo»: mono a 44,1 kHz.
    const localAudio = p('bad-audio.m4a');
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-c:a',
      'aac',
      localAudio,
    ]);
    const source = await seedSource(storage, localAudio, 'src/bad-audio.m4a');
    const normalizer = createNormalizer({ storage, ...store });
    const result = await normalizer.normalize({
      id: newUlid(),
      storageKey: source.storageKey,
      checksum: source.checksum,
      normalizeAs: 'audio',
      normalizedKind: 'tts_audio',
    });
    const outLocal = await materializeToFile(storage, result.storageKey, p('normalized-audio.m4a'));
    await assertAudioProfile(outLocal, { codec: 'aac', sampleRate: 48_000, channels: 2 });
  });

  test('la voz EMBEBIDA de un clip (VEED/voz nativa) se extrae y normaliza a AAC 48 kHz estéreo', async () => {
    const storage = makeMediaTestStorage(workDir);
    const store = makeInMemoryStore();
    const clip = await makeTestVideoWithVoice({ out: p('voiced-clip.mp4'), seconds: 2 });
    const source = await seedSource(storage, clip, 'src/voiced-clip.mp4');
    const normalizer = createNormalizer({ storage, ...store });
    const result = await normalizer.normalize({
      id: newUlid(),
      storageKey: source.storageKey,
      checksum: source.checksum,
      normalizeAs: 'embedded-voice',
      normalizedKind: 'tts_audio',
    });
    const outLocal = await materializeToFile(storage, result.storageKey, p('normalized-voice.m4a'));
    await assertAudioProfile(outLocal, { codec: 'aac', sampleRate: 48_000, channels: 2 });
  });

  // ── 2. CACHÉ: 2ª pasada = 0 ffmpeg ──────────────────────────────────────────────────────────────

  test('la 2ª pasada sobre los mismos assets no lanza ningún ffmpeg (100% cache hits)', async () => {
    const storage = makeMediaTestStorage(workDir);
    const store = makeInMemoryStore();
    const { runner, getCalls } = makeCountingRunner();
    const normalizer = createNormalizer({ storage, ...store, runner, ffmpeg: runner });

    const v = await makeTestVideo({ out: p('cache-v.mp4'), width: 1280, height: 720, seconds: 1 });
    const a = await makeTestAudio({ out: p('cache-a.m4a'), seconds: 1 });
    const vSrc = await seedSource(storage, v, 'src/cache-v.mp4');
    const aSrc = await seedSource(storage, a, 'src/cache-a.m4a');
    const sources: NormalizeSourceAsset[] = [
      {
        id: newUlid(),
        storageKey: vSrc.storageKey,
        checksum: vSrc.checksum,
        normalizeAs: 'video',
        normalizedKind: 'avatar_clip',
      },
      {
        id: newUlid(),
        storageKey: aSrc.storageKey,
        checksum: aSrc.checksum,
        normalizeAs: 'audio',
        normalizedKind: 'tts_audio',
      },
    ];

    await normalizer.normalizeAll(sources);
    const firstPass = getCalls();
    expect(firstPass).toBeGreaterThan(0);

    await normalizer.normalizeAll(sources); // mismos checksums, mismos params → 100% cache hits
    expect(getCalls()).toBe(firstPass); // 0 trabajos ffmpeg nuevos

    // ─── CONTROL NEGATIVO (reproducible por el verifier) ──────────────────────────────────────────────
    // Este test MUERDE si la caché no funciona. Para reproducir el rojo, BYPASEA la caché forzando que
    // `findByCacheKey` de `makeInMemoryStore()` (arriba) devuelva siempre miss — cambia esta línea:
    //     findByCacheKey: (key: string) => Promise.resolve(byCacheKey.get(key)),
    // por:
    //     findByCacheKey: (_key: string) => Promise.resolve(undefined), // BYPASS caché
    // y corre `RUN_MEDIA=1 vitest run --project worker:media -t "2ª pasada"` en la imagen del worker.
    // RESULTADO OBSERVADO (implementer, imagen ugc-worker:t5.1): la 2ª pasada re-encoda los 2 assets →
    // `AssertionError: expected 4 to be 2`. REVERTIR la línea deja el test verde de nuevo (0 ffmpeg nuevos).
  });

  // ── 2b. La key CAMBIA si cambian los params (otra resolución / otra versión de receta) ──────────────

  test('la normalized_cache_key cambia con otra resolución y con otra versión de receta', () => {
    const base = { sourceChecksum: 'c'.repeat(64), profile: CANONICAL_VIDEO_PROFILE };
    const baseKey = computeNormalizedCacheKey(base);
    const otherRes = computeNormalizedCacheKey({
      ...base,
      profile: { ...CANONICAL_VIDEO_PROFILE, width: 1440, height: 2560 },
    });
    const otherRecipe = computeNormalizedCacheKey({ ...base, recipeVersion: 999 });
    expect(otherRes).not.toBe(baseKey);
    expect(otherRecipe).not.toBe(baseKey);
  });

  // ── 3. CROP-TO-FILL sin letterbox ──────────────────────────────────────────────────────────────

  test('un clip 16:9 de color sólido queda crop-to-fill, sin bandas negras', async () => {
    const storage = makeMediaTestStorage(workDir);
    const store = makeInMemoryStore();
    const src = await makeTestVideo({
      out: p('wide.mp4'),
      width: 1920,
      height: 1080,
      seconds: 1,
      color: 'red',
    });
    const source = await seedSource(storage, src, 'src/wide.mp4');
    const normalizer = createNormalizer({ storage, ...store });
    const result = await normalizer.normalize({
      id: newUlid(),
      storageKey: source.storageKey,
      checksum: source.checksum,
      normalizeAs: 'video',
      normalizedKind: 'broll_clip',
    });
    const out = await materializeToFile(storage, result.storageKey, p('cropped.mp4'));
    await assertVideoProfile(out);

    // Extraer un frame RGB y muestrear píxeles del borde superior, centro y borde inferior: si hubiera
    // letterbox, los bordes serían negros. Con crop-to-fill de un rojo sólido, todos deben ser rojos.
    const raw = p('frame.rgb');
    await run('ffmpeg', [
      '-y',
      '-i',
      out,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      raw,
    ]);
    const buf = await readFile(raw);
    const px = (x: number, y: number): Buffer =>
      buf.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3);
    for (const y of [4, 960, 1915]) {
      const [r, g, b] = px(540, y);
      expect(r).toBeGreaterThan(180); // rojo (con margen por yuv420p)
      expect(g).toBeLessThan(80);
      expect(b).toBeLessThan(80); // ni negro ni gris de banda
    }
  });
});
