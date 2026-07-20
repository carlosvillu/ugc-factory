// Normalización CANÓNICA por asset con CACHÉ normalize-once (T5.2, §9.7). El worker de render, antes de
// concatenar+mezclar (T5.3), lleva cada asset de una variante a un perfil de salida EXACTO (Apéndice C
// del PRD): TikTok/Meta rechazan desviaciones. Un normalizado es su PROPIA fila `asset` (checksum de sus
// bytes, `normalized_cache_key` = derivación pura de `checksum-del-origen + perfil`, `parent_asset_ids =
// [origen]`) — NUNCA una columna estampada sobre el origen. La caché es la base económica de la
// regeneración parcial (CU4, T5.8): un miss encoda una vez; los N re-renders siguientes son cache hits.
//
// TRES COMPORTAMIENTOS (§9.7):
//   1. VÍDEO → 1080×1920 scale-to-fill + crop (SIN letterbox), 30 fps, H.264 CRF 23, yuv420p, setsar=1, -an.
//   2. AUDIO canónico → AAC 48 kHz estéreo.
//   3. VOZ EMBEBIDA (VEED/voz nativa) → extrae la pista con `extractAudioTrack` (T4.7b, REUSA — no
//      duplica) y la normaliza al audio canónico.
//
// DOS CAPAS, a propósito (seams testeables por separado):
//   · CAPA DE ENCODE (`normalizeVideoFile`/`normalizeAudioFile`): file-in/file-out, spawn de ffmpeg
//     INYECTABLE. Los tests de perfil/crop la ejercen con ffmpeg REAL y sondean el fichero con ffprobe —
//     sin storage ni caché de por medio. Es donde vive el filtergraph.
//   · CAPA DE ORQUESTACIÓN (`createNormalizer`): materializa storage→temp, consulta la CACHÉ por
//     inyección (`findByCacheKey`), y solo si hay miss encoda→`put`→`createNormalizedAsset`. Los puertos
//     de caché/creación se INYECTAN: producción los cablea a `getAssetByNormalizedCacheKey`/`createAsset`
//     de @ugc/db; el test media inyecta un runner que CUENTA invocaciones + Maps en memoria (la suite
//     `worker:media` no tiene Postgres — la corrección del repo SQL vive en su db-integration test, en el
//     gate). Así la 2ª pasada = 0 ffmpeg se prueba sin base de datos.
//
// CLASE DE ERROR PROPIA (`NormalizeError`, anti-T1.8): «ffmpeg rechazó la normalización» es una capa
// DISTINTA de «storage falla», «probe falla» y «fal falla». No se colapsan (hermana de
// `AudioExtractionError`/`VideoProbeError`).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger, StorageAdapter } from '@ugc/core';
import type { Asset } from '@ugc/db';

import {
  defaultFfmpegRunner,
  extractAudioTrack,
  materializeToBytes,
  tailStderr,
  type FfmpegRunner,
} from './extract-audio-track';
import { NOOP_LOGGER } from './noop-logger';
import {
  CANONICAL_AUDIO_PROFILE,
  CANONICAL_VIDEO_PROFILE,
  computeNormalizedCacheKey,
  type NormalizeProfile,
} from './normalized-cache-key';

/**
 * La normalización con ffmpeg falló: ffmpeg salió con código ≠0, el binario no está, o el input no es
 * decodificable/encodable al perfil. Clase PROPIA (anti-T1.8): «ffmpeg no pudo normalizar» ≠ «storage
 * falló» ≠ «el probe falló» ≠ «fal devolvió mal». Lleva `exitCode`+`stderr` de ffmpeg para diagnóstico.
 */
export class NormalizeError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(message: string, opts: { exitCode: number | null; stderr: string }) {
    super(message);
    this.name = 'NormalizeError';
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
  }
}

// ── CAPA DE ENCODE (file-in/file-out, ffmpeg real en los tests de perfil/crop) ──────────────────────

/**
 * Los ARGS de ffmpeg del encode de VÍDEO canónico. Extraídos como función pura para poder testear el
 * filtergraph aparte y para que el filtro sea la ÚNICA fuente de verdad del crop-to-fill.
 *
 * `scale=w:h:force_original_aspect_ratio=increase` escala el vídeo para CUBRIR el marco (el lado corto
 * llega al target, el largo lo desborda) → luego `crop=w:h` recorta el desbordamiento centrado. Es
 * SCALE-TO-FILL + CROP: sin bandas negras (a diferencia de `decrease`+`pad`, que sería letterbox).
 * `setsar=1` fuerza SAR 1:1 (píxeles cuadrados). `-an` descarta el audio (el vídeo normalizado no lleva
 * pista; el audio se normaliza aparte y se mezcla en T5.3). `-r` fija el fps; CRF/pix_fmt/preset fijan el
 * perfil H.264 canónico.
 */
export function buildVideoNormalizeArgs(
  inPath: string,
  outPath: string,
  profile: NormalizeProfile,
): string[] {
  const { width, height, fps, crf } = profile;
  const w = String(width);
  const h = String(height);
  const filter = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    ...(profile.autorotate ? [] : ['-noautorotate']),
    '-i',
    inPath,
    '-vf',
    filter,
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-crf',
    String(crf),
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-an', // el vídeo normalizado NO lleva audio: se normaliza y mezcla aparte (T5.3)
    '-y',
    outPath,
  ];
}

/**
 * Los ARGS de ffmpeg del encode de AUDIO canónico: AAC 48 kHz estéreo. `-vn` descarta cualquier vídeo
 * (por si el input trae uno). `-ac 2` fuerza estéreo (un mono se up-mixea; un 5.1 se down-mixea). `-ar
 * 48000` fija el sample rate canónico.
 */
export function buildAudioNormalizeArgs(
  inPath: string,
  outPath: string,
  profile: NormalizeProfile,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inPath,
    '-vn',
    '-c:a',
    profile.audioCodec,
    '-ar',
    String(profile.audioSampleRate),
    '-ac',
    String(profile.audioChannels),
    '-y',
    outPath,
  ];
}

/** Corre el runner de ffmpeg sobre `args` y LANZA `NormalizeError` si el exit ≠ 0 (el runner nunca
 *  rechaza por exit≠0: es un resultado). Cuerpo común de `normalizeVideoFile`/`normalizeAudioFile`;
 *  `label` nombra cuál para el mensaje de error. */
async function runFfmpegNormalize(
  label: string,
  inPath: string,
  outPath: string,
  args: string[],
  runner: FfmpegRunner,
): Promise<string> {
  const result = await runner(args);
  if (result.code !== 0) {
    throw new NormalizeError(
      `${label}: ffmpeg salió con código ${String(result.code)} normalizando ${inPath}`,
      { exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }
  return outPath;
}

/**
 * Encoda un fichero de VÍDEO al perfil canónico (1080×1920 crop-to-fill, 30 fps, H.264 CRF 23, yuv420p,
 * setsar=1, -an). File-in/file-out; `runner` inyectable. LANZA `NormalizeError` si ffmpeg falla. Es la
 * capa que los tests de perfil/crop ejercen con ffmpeg real y sondean con ffprobe.
 */
export function normalizeVideoFile(
  inPath: string,
  outPath: string,
  opts: { runner?: FfmpegRunner; profile?: NormalizeProfile } = {},
): Promise<string> {
  const runner = opts.runner ?? defaultFfmpegRunner;
  const profile = opts.profile ?? CANONICAL_VIDEO_PROFILE;
  return runFfmpegNormalize(
    'normalizeVideoFile',
    inPath,
    outPath,
    buildVideoNormalizeArgs(inPath, outPath, profile),
    runner,
  );
}

/**
 * Encoda un fichero de AUDIO al perfil canónico (AAC 48 kHz estéreo). File-in/file-out; `runner`
 * inyectable. LANZA `NormalizeError` si ffmpeg falla.
 */
export function normalizeAudioFile(
  inPath: string,
  outPath: string,
  opts: { runner?: FfmpegRunner; profile?: NormalizeProfile } = {},
): Promise<string> {
  const runner = opts.runner ?? defaultFfmpegRunner;
  const profile = opts.profile ?? CANONICAL_AUDIO_PROFILE;
  return runFfmpegNormalize(
    'normalizeAudioFile',
    inPath,
    outPath,
    buildAudioNormalizeArgs(inPath, outPath, profile),
    runner,
  );
}

// ── CAPA DE ORQUESTACIÓN (materializa + caché por inyección + persiste) ─────────────────────────────

/** La descripción MÍNIMA de un asset origen que el normalizador consume: su storage key + checksum
 *  (para la cache key) + qué normalización aplica. Es un subconjunto de `Asset` (el orquestador de F5
 *  pasa la fila entera; aquí solo se declara lo que se usa). */
export interface NormalizeSourceAsset {
  /** El id del asset origen (va a `parent_asset_ids` del normalizado: linaje §12). */
  readonly id: string;
  /** La clave del asset origen en NUESTRO storage (se materializa a temp para ffmpeg). */
  readonly storageKey: string;
  /** El sha256 del asset ORIGEN: primer insumo de la cache key. */
  readonly checksum: string;
  /**
   * Qué normalización aplicar:
   *   · `video` → encode 1080×1920 `-an`; el asset normalizado conserva el kind del origen.
   *   · `audio` → normaliza la pista a AAC 48k estéreo (el origen YA es audio).
   *   · `embedded-voice` → extrae la voz del clip (ffmpeg `-vn`, `extractAudioTrack`) y la normaliza a
   *     audio canónico. El normalizado es `tts_audio`.
   */
  readonly normalizeAs: 'video' | 'audio' | 'embedded-voice';
  /** El `kind` del asset NORMALIZADO. Vídeo → conserva el del origen (avatar_clip/broll_clip);
   *  audio/embedded-voice → `tts_audio`. Lo decide el caller (executor de T5.3/T5.5). Tipo estrecho
   *  `Asset['kind']` (no `string`): que el error de kind inválido salte en el caller, no en el INSERT. */
  readonly normalizedKind: Asset['kind'];
}

/** El registro que el normalizador pide crear al persistir un normalizado. El adaptador de producción lo
 *  mapea a `createAsset` de @ugc/db; el test media lo captura en un Map. */
export interface CreateNormalizedAssetInput {
  readonly kind: Asset['kind'];
  readonly storageKey: string;
  readonly mime: string;
  readonly bytes: number;
  readonly checksum: string;
  readonly normalizedCacheKey: string;
  readonly parentAssetIds: string[];
}

/** El asset (mínimo) que la caché devuelve / que se crea: lo que el normalizador necesita del resultado. */
export interface NormalizedAsset {
  readonly id: string;
  readonly storageKey: string;
  readonly checksum: string;
  readonly normalizedCacheKey: string | null;
}

export interface NormalizerDeps {
  storage: StorageAdapter;
  /** LOOKUP de la caché: dado la key, devuelve el normalizado existente o `undefined` (miss). Producción:
   *  `(key) => getAssetByNormalizedCacheKey(db, key)`. Inyectable → el test media usa un Map, sin BD. */
  findByCacheKey: (normalizedCacheKey: string) => Promise<NormalizedAsset | undefined>;
  /** CREA la fila del normalizado (miss). Producción: `(v) => createAsset(db, v)`. Inyectable. */
  createNormalizedAsset: (input: CreateNormalizedAssetInput) => Promise<NormalizedAsset>;
  /** Runner de ffmpeg INYECTABLE (default: subproceso real). El test media inyecta el que CUENTA. */
  runner?: FfmpegRunner;
  /** Runner de ffmpeg para la extracción de voz embebida (default: el mismo `runner` / subproceso). */
  ffmpeg?: FfmpegRunner;
  /** El perfil de salida. Default: el canónico (Apéndice C). F8 pasará otros perfiles → otras keys. */
  profile?: NormalizeProfile;
  logger?: Logger;
}

export interface Normalizer {
  /** Normaliza UN asset (con caché): miss → encoda+persiste; hit → devuelve el existente sin ffmpeg. */
  normalize(source: NormalizeSourceAsset): Promise<NormalizedAsset>;
  /** Normaliza TODOS los assets de una variante en orden. La 2ª pasada con los mismos inputs = 0 ffmpeg. */
  normalizeAll(sources: readonly NormalizeSourceAsset[]): Promise<NormalizedAsset[]>;
}

/**
 * Construye un normalizador con la caché cableada por inyección. Cada `normalize`:
 *   1. computa la `normalized_cache_key` = `computeNormalizedCacheKey(origen.checksum + perfil)`;
 *   2. `findByCacheKey(key)` → si HIT, devuelve el existente SIN lanzar ffmpeg (base económica de CU4);
 *   3. si MISS, materializa el origen a temp, ENCODA (ffmpeg), sube el resultado (`storage.put` calcula
 *      bytes+checksum de SUS bytes) y `createNormalizedAsset` con la key + `parent_asset_ids=[origen]`.
 *   4. limpia los temps SIEMPRE en `finally` (nunca basura en /tmp aunque ffmpeg falle).
 */
export function createNormalizer(deps: NormalizerDeps): Normalizer {
  const log = deps.logger ?? NOOP_LOGGER;
  const runner = deps.runner ?? defaultFfmpegRunner;
  const profileFor = (source: NormalizeSourceAsset): NormalizeProfile => {
    const base = deps.profile ?? CANONICAL_VIDEO_PROFILE;
    // El mediaKind del perfil se alinea con lo que se normaliza (separa los espacios de key vídeo/audio).
    return source.normalizeAs === 'video'
      ? { ...base, mediaKind: 'video' }
      : { ...base, mediaKind: 'audio' };
  };

  async function normalize(source: NormalizeSourceAsset): Promise<NormalizedAsset> {
    const profile = profileFor(source);
    const cacheKey = computeNormalizedCacheKey({ sourceChecksum: source.checksum, profile });

    // CACHE LOOKUP antes de cualquier encode. Un HIT NO lanza ffmpeg — es la propiedad que el test de
    // «2ª pasada = 0 ffmpeg» verifica contando invocaciones del runner.
    const cached = await deps.findByCacheKey(cacheKey);
    if (cached !== undefined) {
      log.info(
        { event: 'normalize_cache_hit', sourceAssetId: source.id, cacheKey },
        'normalizado reutilizado de la caché (0 ffmpeg)',
      );
      return cached;
    }

    // MISS: materializar el origen a temp, encodear, subir, crear la fila.
    const isVideo = source.normalizeAs === 'video';
    const dir = await mkdtemp(join(tmpdir(), 'ugc-normalize-'));
    const outPath = join(dir, isVideo ? 'out.mp4' : 'out.m4a');
    try {
      // La materialización origen→temp la necesitan SOLO las ramas video/audio (ffmpeg lee un fichero
      // local). La rama embedded-voice NO usa `inPath`: `extractAudioTrack` hace su propio `storage.get`,
      // así que materializar aquí leería el clip entero dos veces. Por eso vive dentro de cada rama.
      let mime: string;
      if (isVideo) {
        const inPath = join(dir, 'in');
        await writeFile(inPath, await materializeToBytes(deps.storage, source.storageKey));
        await normalizeVideoFile(inPath, outPath, { runner, profile });
        mime = 'video/mp4';
      } else if (source.normalizeAs === 'audio') {
        const inPath = join(dir, 'in');
        await writeFile(inPath, await materializeToBytes(deps.storage, source.storageKey));
        await normalizeAudioFile(inPath, outPath, { runner, profile });
        mime = 'audio/mp4';
      } else {
        // VOZ EMBEBIDA: reusa `extractAudioTrack` (T4.7b) para sacar la pista del clip a WAV, y luego la
        // normaliza al audio canónico. NO se re-duplica la extracción — se REUSA el módulo de T4.7b.
        // `extractAudioTrack` materializa el clip por su cuenta → aquí NO se materializa (evita leerlo 2 veces).
        const extracted = await extractAudioTrack(
          {
            storage: deps.storage,
            ...(deps.ffmpeg !== undefined ? { ffmpeg: deps.ffmpeg } : { ffmpeg: runner }),
            logger: log,
          },
          { storageKey: source.storageKey },
        );
        const wavPath = join(dir, 'voice.wav');
        await writeFile(wavPath, extracted.bytes);
        await normalizeAudioFile(wavPath, outPath, { runner, profile });
        mime = 'audio/mp4';
      }

      const encoded = new Uint8Array(await readFile(outPath));
      if (encoded.byteLength === 0) {
        throw new NormalizeError(
          `createNormalizer: la normalización de ${source.storageKey} produjo 0 bytes`,
          { exitCode: 0, stderr: '' },
        );
      }

      // Subir el normalizado a NUESTRO storage bajo una key propia. `put` calcula bytes+checksum de SUS
      // bytes (el checksum del NORMALIZADO, distinto del origen).
      const normalizedStorageKey = `normalized/${cacheKey}${isVideo ? '.mp4' : '.m4a'}`;
      const put = await deps.storage.put(normalizedStorageKey, encoded, { mime });

      const created = await deps.createNormalizedAsset({
        kind: source.normalizedKind,
        storageKey: normalizedStorageKey,
        mime,
        bytes: put.bytes,
        checksum: put.checksum,
        normalizedCacheKey: cacheKey,
        parentAssetIds: [source.id],
      });
      log.info(
        {
          event: 'normalize_cache_miss',
          sourceAssetId: source.id,
          normalizedAssetId: created.id,
          cacheKey,
        },
        'asset normalizado y persistido (cache miss)',
      );
      return created;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        // best-effort: un fallo de limpieza no debe enmascarar el error real.
      });
    }
  }

  async function normalizeAll(
    sources: readonly NormalizeSourceAsset[],
  ): Promise<NormalizedAsset[]> {
    const out: NormalizedAsset[] = [];
    // Secuencial a propósito: encodes concurrentes saturan CPU/IO y el orden es determinista para la
    // caché (dos assets idénticos en el mismo lote comparten la key; el 2º ya es hit).
    for (const source of sources) {
      out.push(await normalize(source));
    }
    return out;
  }

  return { normalize, normalizeAll };
}
