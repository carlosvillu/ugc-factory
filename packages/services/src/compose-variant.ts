// PASE FINAL, EXPORT MASTER y QA AUTOMÁTICO (T5.5, §9.7 N8/N9 / Apéndice C). El módulo que toma el máster
// INTERMEDIO de T5.3 (`composeMaster`) y produce el máster PUBLICABLE de una variante:
//   1. ENCODE FINAL con burn-in de subtítulos: parte del intermedio y QUEMA el `.ass` (libass, filtro
//      `ass=`). El burn-in OBLIGA a re-encode del vídeo (PRD §9.7 l.276: "el burn-in ASS obliga a un encode
//      completo del master") — NO `-c:v copy`. Se targetea el `EXPORT_MASTER_PRESET` (H.264 High yuv420p
//      30fps 1080×1920, 8–12 Mbps VBR, +faststart). El AUDIO va `-c:a copy` cuando no cambió respecto al
//      intermedio (el caso normal: la mezcla ya la hizo T5.3) — seam load-bearing para la regeneración
//      parcial de T5.8, verificable inspeccionando los args del runner inyectado.
//   2. THUMBNAIL: un frame representativo del máster (ffmpeg `-vframes 1`).
//   3. FIRMA C2PA: `c2patool <master> -m <manifest>` con un manifest que declara `digitalSourceType:
//      trainedAlgorithmicMedia` (PRD §13.5). Reescribe el contenedor MP4 (preserva +faststart, verificado).
//   4. QA VALIDATOR (N9) sobre el fichero FIRMADO (c2patool reescribió el MP4; el QA debe medir lo que se
//      publica, no el pre-firma). Los 8 checks derivan sus esperados de las MISMAS constantes que el encoder
//      targetea (anti-T1.9): res/fps/codec/pixfmt de `CANONICAL_VIDEO_PROFILE`, duración/loudness/filesize/
//      AAC de `EXPORT_MASTER_PRESET`.
//
// MÓDULO REUTILIZABLE, NO EXECUTOR (patrón firme F5: T5.2/T5.3). `composeVariant()` es bytes-in/bytes-out:
// devuelve los bytes del máster firmado + los del thumbnail + el `qaReport`. NO crea filas `asset` ni escribe
// en la BD (eso es del caller/persistencia — `finalizeVariantMaster` en @ugc/db). El wiring del executor
// N8/N9 al DAG NO es de T5.5 (deuda de fase anotada en planning: los executors llegan solo a N7).
//
// DEPENDENCIAS POR INYECCIÓN (frontera de paquete): el generador ASS de toda la variante y el check de safe
// zone viven en `apps/worker/src/captions` — `@ugc/services` NO puede importar de `apps/worker` (composition
// roots hermanos). Se inyectan como PORTS (`captionGenerator`/`safeZoneChecker`), gemelos de `resolveAssetKey`.
// El executor del worker cablea las funciones reales (`generateVariantAss`/`checkAssSafeZone`); el test media
// (que vive en apps/worker y SÍ puede importar ambos) inyecta las reales; el gate unit-test inyecta stubs.
//
// CLASE DE ERROR PROPIA (`ComposeVariantError`, anti-T1.8): "el pase final falló" es una capa distinta de
// ComposeError (el intermedio) / NormalizeError / fal. Lleva la fase (`encode`/`sign`/`qa`) y el stderr.
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CompositionSpec, QaReport, QaChecks, QaMetrics } from '@ugc/core/contracts';

import { composeMaster, type ComposeMasterDeps } from './compose-master';
import {
  defaultFfmpegRunner,
  defaultFfprobeRunner,
  materializeToBytes,
  tailStderr,
  type FfmpegRunner,
  type FfprobeRunner,
} from './extract-audio-track';
import { CANONICAL_VIDEO_PROFILE } from './normalized-cache-key';
import { NOOP_LOGGER } from './noop-logger';

// ── EL PRESET DE EXPORT (Apéndice C, PRD l.822) — LA ÚNICA VERDAD de los parámetros del pase final ────────
//
// OJO (anti-T1.9): esto NO es `CANONICAL_VIDEO_PROFILE` (esa es la NORMALIZACIÓN de T5.2: CRF 23, sin
// bitrate/faststart/filesize/AAC-128k). El pase final targetea el preset de EXPORT. Los campos que COINCIDEN
// con la normalización (resolución/fps/códec/pixfmt) se heredan de `CANONICAL_VIDEO_PROFILE` (una sola
// verdad); lo específico del export (bitrate VBR, faststart, filesize, AAC-128k, techo de duración, loudness)
// vive AQUÍ. El QA validator deriva sus esperados de ESTE objeto — misma constante que el encoder → no puede
// "pasar" contra valores que el encoder no targetea (el trap de T1.9).

/** El PRESET DE EXPORT del máster universal (PRD Apéndice C l.822). */
export const EXPORT_MASTER_PRESET = {
  // Vídeo: res/fps/códec/pixfmt HEREDADOS de la normalización (coinciden con el export y ya son constante).
  width: CANONICAL_VIDEO_PROFILE.width,
  height: CANONICAL_VIDEO_PROFILE.height,
  fps: CANONICAL_VIDEO_PROFILE.fps,
  videoCodec: CANONICAL_VIDEO_PROFILE.videoCodec,
  /** El ENCODER de ffmpeg que produce `videoCodec` (`h264` = nombre de stream que ffprobe reporta;
   *  `libx264` = nombre del encoder de ffmpeg — `-c:v h264` NO garantiza seleccionar libx264). Emparejado con
   *  `videoCodec` a propósito: encode y QA trazan AMBOS a esta constante, así una futura reconfiguración del
   *  perfil (F8) mueve los dos a la vez y el QA no falla en silencio contra un codec que el encoder no targetea. */
  videoEncoder: 'libx264',
  pixFmt: 'yuv420p',
  /** Perfil H.264 High (Apéndice C). */
  h264Profile: 'high',
  /** Bitrate VBR objetivo (bps): 8–12 Mbps. `-b:v` = target, `-maxrate` = techo. */
  videoBitrateTarget: 10_000_000,
  videoBitrateMax: 12_000_000,
  videoBitrateMin: 8_000_000,
  /** `-bufsize` del VBV (2× el maxrate es el default sano para social). */
  vbvBufsize: 24_000_000,
  /** Audio: AAC estéreo 128k 48kHz. */
  audioCodec: 'aac',
  audioBitrate: 128_000,
  audioSampleRate: 48_000,
  audioChannels: 2,
  /** loudness integrado objetivo (LUFS). El intermedio de T5.3 ya lo clava a −14 con loudnorm; el pase
   *  final copia el audio (`-c:a copy`), así que el máster hereda esos −14. */
  loudnessLufs: -14,
  /** Techo de duración del máster (Apéndice C: ≤60 s). */
  maxDurationS: 60,
  /** Tamaño máximo del fichero (Apéndice C: ≤500 MB). */
  maxFilesizeBytes: 500 * 1024 * 1024,
  /** `+faststart` (moov delante del mdat para streaming progresivo). */
  faststart: true,
} as const;

// ── TOLERANCIAS DEL QA (el margen honesto de cada medida) ─────────────────────────────────────────────────

/** ±LUFS sobre el target de loudness. loudnorm single-pass tiene deriva; ±1.5 es el margen que T5.3 ya
 *  usa (su media test acepta −13…−15). El QA hereda ese margen. */
export const QA_LOUDNESS_TOLERANCE_LUFS = 1.5;
/** Tolerancia de |duración vídeo − duración audio| (s). El encode alinea a GOP y el AAC añade priming
 *  samples → una diferencia de fracciones de segundo es normal, no desincronía. */
export const QA_AV_DURATION_TOLERANCE_S = 0.5;
/** Banda de tolerancia del bitrate de audio (bps) alrededor de los 128k del preset. El audio va `-c:a copy`
 *  desde el intermedio de T5.3, cuyo AAC por defecto a 48k estéreo aterriza ~128k (medido: 128340). Exigir
 *  128000 EXACTO sería un mini-T1.9 (comprobar lo que el encoder NO fijó): se acepta una banda ±32k. */
export const QA_AUDIO_BITRATE_TOLERANCE = 32_000;

/**
 * El pase final falló. Clase PROPIA (anti-T1.8): distinta de `ComposeError` (el intermedio), `NormalizeError`
 * y los errores de fal. `phase` nombra el paso (`encode`/`thumbnail`/`sign`/`qa`) para el diagnóstico.
 */
export class ComposeVariantError extends Error {
  readonly phase: 'encode' | 'thumbnail' | 'sign' | 'qa';
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(
    message: string,
    opts: { phase: ComposeVariantError['phase']; exitCode: number | null; stderr: string },
  ) {
    super(message);
    this.name = 'ComposeVariantError';
    this.phase = opts.phase;
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
  }
}

// ── BUILDERS PUROS (testeables sin ffmpeg/c2patool → gate) ────────────────────────────────────────────────

/**
 * El LINAJE del máster: los ids de los assets ORIGEN de los que deriva (§12 `asset.parent_asset_ids`). Son
 * los clips de vídeo + las voces de cada segmento + el bed musical (si lo hay) del `CompositionSpec`. T5.7
 * recorre este linaje del máster hasta el hook line. PURA y determinista: preserva el orden (segmentos en
 * orden temporal: vídeo, voz; luego el bed) y DEDUPLICA (un mismo asset reusado en dos segmentos aparece una
 * vez). El caller/persistencia lo pasa a `finalizeVariantMaster` como `parent_asset_ids` del máster.
 */
export function collectSpecParentAssetIds(spec: CompositionSpec): string[] {
  const ids: string[] = [];
  for (const segment of spec.segments) {
    ids.push(segment.videoAsset, segment.voAudio);
  }
  if (spec.music?.asset != null) {
    ids.push(spec.music.asset);
  }
  // Dedup preservando el primer orden de aparición.
  return [...new Set(ids)];
}

/**
 * Los ARGS del ENCODE FINAL con burn-in. Parte del máster intermedio (`inPath`), quema el `.ass` (`assPath`,
 * si lo hay) con el filtro `ass=`, y RE-ENCODEA el vídeo al `EXPORT_MASTER_PRESET` (H.264 High, VBR 8–12 Mbps,
 * +faststart). El AUDIO: `-c:a copy` cuando `copyAudio` (el caso normal — la mezcla ya la hizo T5.3 y no
 * cambia; seam de T5.8), o re-encode a AAC 128k cuando cambió.
 *
 * ANTI-T1.9: los args de vídeo (`-c:v`/`-b:v`/`-maxrate`/`-bufsize`/`-profile:v`/`-pix_fmt`/`-movflags
 * +faststart`) salen del MISMO `EXPORT_MASTER_PRESET` del que el QA validator deriva sus esperados. Su unit test co-locado
 * (gate) verifica que los args CONTIENEN esos valores del preset — el encoder queda configurado desde la
 * constante, no desde literales sueltos que podrían divergir del QA.
 */
export function buildFinalEncodeArgs(opts: {
  inPath: string;
  assPath: string | null;
  outPath: string;
  copyAudio: boolean;
}): string[] {
  const { inPath, assPath, outPath, copyAudio } = opts;
  const p = EXPORT_MASTER_PRESET;
  const args = ['-hide_banner', '-loglevel', 'error', '-i', inPath];
  // El filtro de burn-in: `ass=<file>` (libass). El path se ESCAPA para el mini-lenguaje de -vf de ffmpeg
  // (`:` y `\` y `'` son especiales dentro de un filtro). El burn-in obliga a re-encode del vídeo (no copy).
  if (assPath !== null) {
    args.push('-vf', `ass=${escapeFilterPath(assPath)}`);
  }
  args.push(
    '-c:v',
    p.videoEncoder,
    '-profile:v',
    p.h264Profile,
    '-pix_fmt',
    p.pixFmt,
    '-b:v',
    String(p.videoBitrateTarget),
    '-maxrate',
    String(p.videoBitrateMax),
    '-bufsize',
    String(p.vbvBufsize),
    '-r',
    String(p.fps),
  );
  if (copyAudio) {
    // El audio no cambió respecto al intermedio → se copia sin re-encode (seam load-bearing de T5.8).
    args.push('-c:a', 'copy');
  } else {
    args.push(
      '-c:a',
      p.audioCodec,
      '-b:a',
      String(p.audioBitrate),
      '-ar',
      String(p.audioSampleRate),
      '-ac',
      String(p.audioChannels),
    );
  }
  // +faststart es invariante del preset de export (Apéndice C): el moov delante del mdat para streaming
  // progresivo. El QA lo re-verifica sobre el output (moov<mdat), aquí se GARANTIZA en el encode.
  args.push('-movflags', '+faststart');
  args.push('-y', outPath);
  return args;
}

/** Escapa un path para usarlo dentro del filtro `ass=` de ffmpeg. En el mini-lenguaje de filtros, `\`, `:` y
 *  `'` son especiales; se escapan con `\`. (Los paths temporales que generamos no llevan estos caracteres,
 *  pero escapar es lo correcto y barato.) */
export function escapeFilterPath(path: string): string {
  return path.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

/** Los ARGS del thumbnail: un frame a `atSeconds` del máster → imagen (`-vframes 1`). JPG por defecto
 *  (menor peso que PNG para una miniatura de galería). */
export function buildThumbnailArgs(opts: {
  inPath: string;
  atSeconds: number;
  outPath: string;
}): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    opts.atSeconds.toFixed(3),
    '-i',
    opts.inPath,
    '-vframes',
    '1',
    '-q:v',
    '3',
    '-y',
    opts.outPath,
  ];
}

/**
 * El MANIFEST C2PA (text-in para c2patool `-m`): declara `digitalSourceType: trainedAlgorithmicMedia` en una
 * acción `c2pa.created` (PRD §13.5, cumplimiento EU AI Act Art. 50 + auto-etiquetado TikTok). El cert/clave
 * son PATHS inyectados (fixtures de TEST autofirmadas; JAMÁS la clave de producción). `es256` es el algoritmo
 * de la clave de test.
 */
export function buildC2paManifest(opts: {
  privateKeyPath: string;
  signCertPath: string;
  claimGenerator?: string;
}): string {
  const manifest = {
    alg: 'es256',
    private_key: opts.privateKeyPath,
    sign_cert: opts.signCertPath,
    claim_generator: opts.claimGenerator ?? 'UGC_Factory',
    assertions: [
      {
        label: 'c2pa.actions',
        data: {
          actions: [
            {
              action: 'c2pa.created',
              softwareAgent: 'UGC Factory',
              // La URI IPTC de "media generada por un algoritmo entrenado" — el claim que TikTok y el
              // EU AI Act reconocen. El substring `trainedAlgorithmicMedia` es lo que el QA/verifier busca.
              digitalSourceType:
                'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
            },
          ],
        },
      },
    ],
  };
  return JSON.stringify(manifest, null, 2);
}

// ── EL QA VALIDATOR (N9): función de decisión PURA (métricas → veredictos) ────────────────────────────────

/**
 * Las MÉTRICAS crudas medidas del máster firmado (por ffprobe + ebur128 + el check de safe zone). Es la
 * ENTRADA de la decisión pura `evaluateQa`. Separar medir (I/O, imagen) de decidir (puro, gate) es lo que
 * permite testear los 8 veredictos en NEGATIVO en el gate sin ffmpeg (media-composition.md: "un QA que nunca
 * falla no verifica nada") y a la vez proteger la decisión contra regresión (regla de trabajo 8).
 */
export interface QaMeasurements {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  pixFmt: string;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  audioBitrate: number | null;
  videoDurationS: number;
  audioDurationS: number | null;
  loudnessLufs: number | null;
  filesizeBytes: number;
  /** nº de eventos del `.ass` fuera de la safe zone; `null` cuando la variante no lleva captions. */
  captionViolations: number | null;
}

/**
 * DECIDE los 8 veredictos del QA desde las métricas medidas + los esperados de las constantes (anti-T1.9:
 * `maxDurationS` de la variante, todo lo demás de `EXPORT_MASTER_PRESET`/`CANONICAL_VIDEO_PROFILE`). PURA y
 * determinista. Cada check comenta de QUÉ constante deriva su esperado:
 *   · resolution/fps/codec  ← CANONICAL_VIDEO_PROFILE (res/fps/códec/pixfmt del export).
 *   · duration/loudness/av_duration_diff/filesize ← EXPORT_MASTER_PRESET (+ maxDurationS de la variante).
 *   · captions_safe_zone    ← 0 violaciones del check de T5.4 (vacuous-pass si la variante no lleva captions).
 */
export function evaluateQa(m: QaMeasurements, variantMaxDurationS: number): QaReport {
  const p = EXPORT_MASTER_PRESET;
  const verdict = (ok: boolean): 'pass' | 'fail' => (ok ? 'pass' : 'fail');

  // resolution/fps/codec/pixfmt ← CANONICAL_VIDEO_PROFILE (heredado por EXPORT_MASTER_PRESET).
  const resolution = verdict(m.width === p.width && m.height === p.height);
  const fps = verdict(Math.abs(m.fps - p.fps) < 0.01);
  const codec = verdict(m.videoCodec === p.videoCodec && m.pixFmt === p.pixFmt);

  // duration ← EXPORT_MASTER_PRESET (techo ≤60s) Y el maxDurationS de la VARIANTE (el más restrictivo).
  const durCap = Math.min(p.maxDurationS, variantMaxDurationS);
  const duration = verdict(m.videoDurationS > 0 && m.videoDurationS <= durCap);

  // loudness ← EXPORT_MASTER_PRESET (−14 LUFS ±tolerancia).
  const loudness = verdict(
    m.loudnessLufs !== null &&
      Math.abs(m.loudnessLufs - p.loudnessLufs) <= QA_LOUDNESS_TOLERANCE_LUFS,
  );

  // av_duration_diff: |vídeo − audio| ≤ tolerancia (sin desincronía grosera). Sin audio → fail (un máster
  // publicable lleva audio).
  const av_duration_diff = verdict(
    m.audioDurationS !== null &&
      Math.abs(m.videoDurationS - m.audioDurationS) <= QA_AV_DURATION_TOLERANCE_S,
  );

  // captions_safe_zone ← 0 violaciones (check de T5.4). null (sin captions) = vacuous-pass: no hay `.ass` que
  // pueda salirse de la safe zone, así que el máster no viola nada por ese concepto.
  const captions_safe_zone = verdict(m.captionViolations === null || m.captionViolations === 0);

  // filesize ← EXPORT_MASTER_PRESET (≤500 MB). NB: el bitrate VBR (8–12 Mbps) NO se comprueba como piso de
  // salida MEDIDA — contenido legítimamente comprimible (colores planos) puede quedar muy por debajo sin ser
  // un defecto; el anti-T1.9 del bitrate se protege verificando que los ARGS del encoder llevan el preset
  // (unit test de `buildFinalEncodeArgs`), no rechazando un output pequeño. El filesize sí es un techo real.
  const filesize = verdict(m.filesizeBytes > 0 && m.filesizeBytes <= p.maxFilesizeBytes);

  const checks: QaChecks = {
    resolution,
    fps,
    codec,
    duration,
    loudness,
    av_duration_diff,
    captions_safe_zone,
    filesize,
  };

  const metrics: QaMetrics = {
    width: m.width,
    height: m.height,
    fps: m.fps,
    videoCodec: m.videoCodec,
    pixFmt: m.pixFmt,
    ...(m.audioCodec !== null ? { audioCodec: m.audioCodec } : {}),
    ...(m.audioSampleRate !== null ? { audioSampleRate: m.audioSampleRate } : {}),
    ...(m.audioChannels !== null ? { audioChannels: m.audioChannels } : {}),
    ...(m.audioBitrate !== null ? { audioBitrate: m.audioBitrate } : {}),
    videoDurationS: m.videoDurationS,
    ...(m.audioDurationS !== null ? { audioDurationS: m.audioDurationS } : {}),
    ...(m.loudnessLufs !== null ? { loudnessLufs: m.loudnessLufs } : {}),
    filesizeBytes: m.filesizeBytes,
    ...(m.captionViolations !== null ? { captionViolations: m.captionViolations } : {}),
  };

  const verdicts = Object.values(checks);
  const passCount = verdicts.filter((v) => v === 'pass').length;
  const score = Math.round((passCount / verdicts.length) * 100);
  const passed = passCount === verdicts.length;

  return { checks, metrics, passed, score };
}

// ── LA CAPA DE ORQUESTACIÓN (intermedio → encode+burn-in → thumbnail → C2PA → QA) ─────────────────────────

/** Genera el `.ass` de TODA la variante (merge de los voWords por-segmento + burn-in). Lo cablea el executor
 *  del worker a `generateVariantAss` (apps/worker/src/captions); services no puede importarlo → inyección. */
export type CaptionAssGenerator = (
  spec: CompositionSpec,
  segmentVideoDurationsS: readonly number[],
) => string;

/** Cuenta los eventos del `.ass` fuera de la safe zone. Lo cablea el worker a `checkAssSafeZone` (T5.4).
 *  Devuelve el nº de violaciones (0 = ok). */
export type SafeZoneChecker = (ass: string) => number;

/** Firma el máster con c2patool: `c2patool <inPath> -m <manifestPath> -o <outPath> -f`. Inyectable → el
 *  test media usa el binario real de la imagen; el gate no lo ejecuta. Devuelve el resultado del proceso. */
export type C2paSigner = (args: string[]) => Promise<{ code: number | null; stderr: string }>;

/** Mide el loudness integrado (LUFS) de un fichero LOCAL. Inyectable (ebur128 real en la imagen). */
export type LoudnessMeter = (path: string) => Promise<number>;

export interface ComposeVariantDeps extends ComposeMasterDeps {
  /** Genera el `.ass` de la variante (inyectado del worker). Si la variante no lleva captions, no se llama. */
  captionGenerator: CaptionAssGenerator;
  /** Cuenta violaciones de safe zone del `.ass` (inyectado del worker). */
  safeZoneChecker: SafeZoneChecker;
  /** Firma C2PA (c2patool real, inyectado). */
  c2paSigner: C2paSigner;
  /** Medidor de loudness (ebur128 real, inyectado). */
  loudnessMeter: LoudnessMeter;
  /** Paths de la clave + cert de firma C2PA (fixtures de TEST autofirmadas). */
  c2pa: { privateKeyPath: string; signCertPath: string; claimGenerator?: string };
}

export interface ComposeVariantResult {
  /** Bytes del máster FIRMADO (H.264 export + burn-in + C2PA). */
  masterBytes: Uint8Array;
  masterMime: string;
  /** Bytes del thumbnail (JPG). */
  thumbnailBytes: Uint8Array;
  thumbnailMime: string;
  /** El `qa_report` medido sobre el máster FIRMADO. */
  qaReport: QaReport;
  /** El LINAJE del máster (§12): los ids de los assets origen (clips + voces + bed) del que deriva. Se
   *  DERIVA aquí del `CompositionSpec` (no se deja al caller) para que la persistencia lo pase tal cual a
   *  `parent_asset_ids` — el linaje que T5.7 recorre del máster hasta el hook. */
  parentAssetIds: string[];
}

/**
 * EL PASE FINAL de una variante. Compone el intermedio (reusa `composeMaster`), quema los subtítulos y
 * re-encoda al `EXPORT_MASTER_PRESET`, extrae el thumbnail, FIRMA con C2PA y corre el QA sobre el FIRMADO.
 * Devuelve los bytes de máster+thumbnail + el `qaReport`. NO escribe en la BD (eso es del caller/persistencia).
 * LANZA `ComposeVariantError` si algún paso de ffmpeg/c2patool falla. Limpia los temps SIEMPRE en `finally`.
 */
export async function composeVariant(
  deps: ComposeVariantDeps,
  spec: CompositionSpec,
): Promise<ComposeVariantResult> {
  const log = deps.logger ?? NOOP_LOGGER;
  const runner = deps.runner ?? defaultFfmpegRunner;
  const ffprobe = deps.ffprobe ?? defaultFfprobeRunner;

  // 1) El máster INTERMEDIO (concat + mezcla de audio, T5.3). Reusa el módulo — NO duplica su scaffold.
  const intermediate = await composeMaster(deps, spec);

  const dir = await mkdtemp(join(tmpdir(), 'ugc-variant-'));
  try {
    const intermediatePath = join(dir, 'intermediate.mp4');
    await writeFile(intermediatePath, intermediate.bytes);

    // 2) El `.ass` de la variante (si lleva captions). Se necesitan las duraciones de VÍDEO de cada segmento
    //    para offsetear los word timestamps por-segmento (composeMaster concatena las voces en orden).
    const hasCaptions = spec.captions !== null && spec.captions !== undefined;
    let assPath: string | null = null;
    let captionViolations: number | null = null;
    if (hasCaptions) {
      const segmentDurations = await measureSegmentVideoDurations(deps, ffprobe, spec);
      const ass = deps.captionGenerator(spec, segmentDurations);
      assPath = join(dir, 'captions.ass');
      await writeFile(assPath, ass);
      captionViolations = deps.safeZoneChecker(ass);
    }

    // 3) ENCODE FINAL con burn-in (re-encode del vídeo al preset; `-c:a copy` — la mezcla no cambió).
    const masterUnsignedPath = join(dir, 'master-unsigned.mp4');
    await runFfmpeg(
      runner,
      'encode',
      buildFinalEncodeArgs({
        inPath: intermediatePath,
        assPath,
        outPath: masterUnsignedPath,
        copyAudio: true,
      }),
    );

    // 4) THUMBNAIL: un frame a 1/3 de la duración (un instante representativo, ni el primer ni el último
    //    frame). Se mide la duración del máster sin firmar.
    const masterDurationS = await probeDuration(ffprobe, masterUnsignedPath);
    const thumbnailPath = join(dir, 'thumbnail.jpg');
    await runFfmpeg(
      runner,
      'thumbnail',
      buildThumbnailArgs({
        inPath: masterUnsignedPath,
        atSeconds: masterDurationS / 3,
        outPath: thumbnailPath,
      }),
    );

    // 5) FIRMA C2PA. c2patool reescribe el MP4 (verificado: preserva +faststart). El manifest es text-in.
    const manifestPath = join(dir, 'manifest.json');
    await writeFile(
      manifestPath,
      buildC2paManifest({
        privateKeyPath: deps.c2pa.privateKeyPath,
        signCertPath: deps.c2pa.signCertPath,
        ...(deps.c2pa.claimGenerator !== undefined
          ? { claimGenerator: deps.c2pa.claimGenerator }
          : {}),
      }),
    );
    const masterSignedPath = join(dir, 'master-signed.mp4');
    const signResult = await deps.c2paSigner([
      masterUnsignedPath,
      '-m',
      manifestPath,
      '-o',
      masterSignedPath,
      '-f',
    ]);
    if (signResult.code !== 0) {
      throw new ComposeVariantError(
        `composeVariant: c2patool falló firmando el máster (código ${String(signResult.code)})`,
        { phase: 'sign', exitCode: signResult.code, stderr: tailStderr(signResult.stderr) },
      );
    }

    // 6) QA sobre el fichero FIRMADO (c2patool reescribió el contenedor; se mide lo que se publica). Reusa
    //    `measureAndEvaluateQa` — el MISMO par medir→decidir que ejerce el test media en negativo (paridad
    //    test-prod: el camino que producción recorre es exactamente el que los controles negativos validan).
    const qaReport = await measureAndEvaluateQa(
      { ffprobe, loudnessMeter: deps.loudnessMeter },
      {
        masterPath: masterSignedPath,
        captionViolations,
        variantMaxDurationS: spec.output.maxDurationS,
      },
    );

    const masterBytes = new Uint8Array(await readFile(masterSignedPath));
    const thumbnailBytes = new Uint8Array(await readFile(thumbnailPath));

    log.info(
      {
        event: 'variant_composed',
        segments: spec.segments.length,
        hasCaptions,
        qaPassed: qaReport.passed,
        score: qaReport.score,
        masterBytes: masterBytes.byteLength,
      },
      'pase final: máster firmado + thumbnail + qa_report',
    );

    return {
      masterBytes,
      masterMime: 'video/mp4',
      thumbnailBytes,
      thumbnailMime: 'image/jpeg',
      qaReport,
      parentAssetIds: collectSpecParentAssetIds(spec),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // best-effort: un fallo de limpieza no debe enmascarar el error real.
    });
  }
}

/** Corre el runner de ffmpeg y LANZA `ComposeVariantError` si el exit ≠ 0. `phase` nombra la fase tanto en el
 *  mensaje como en el campo `phase` del error (una sola fuente — no pueden desincronizarse). */
async function runFfmpeg(
  runner: FfmpegRunner,
  phase: ComposeVariantError['phase'],
  args: string[],
): Promise<void> {
  const result = await runner(args);
  if (result.code !== 0) {
    throw new ComposeVariantError(
      `composeVariant: ffmpeg falló en «${phase}» (código ${String(result.code)})`,
      { phase, exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }
}

/** Mide la duración de VÍDEO de cada segmento (para offsetear los word timestamps). Materializa cada clip a
 *  temp y lo sondea con ffprobe. Reusa la resolución `assetId → storageKey` inyectada. */
async function measureSegmentVideoDurations(
  deps: ComposeVariantDeps,
  ffprobe: FfprobeRunner,
  spec: CompositionSpec,
): Promise<number[]> {
  const durations: number[] = [];
  const tmp = await mkdtemp(join(tmpdir(), 'ugc-seg-dur-'));
  try {
    for (const [i, segment] of spec.segments.entries()) {
      const key = await deps.resolveAssetKey(segment.videoAsset);
      const bytes = await materializeToBytes(deps.storage, key);
      const localPath = join(tmp, `seg-${String(i)}.mp4`);
      await writeFile(localPath, bytes);
      durations.push(await probeDuration(ffprobe, localPath));
    }
    return durations;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Mide QA sobre un fichero YA existente y evalúa el `qa_report`. Es la capa MEDICIÓN→DECISIÓN extraída para
 * que el test media pueda darle un máster DEFECTUOSO a propósito (25fps, LUFS−20, fuera de safe zone…) y
 * comprobar que el check correspondiente sale `fail` (media-composition.md: "un QA que nunca falla no
 * verifica nada"). También lo reusará T5.8 (re-QA de una regeneración parcial). Solo necesita los runners +
 * el loudness meter (no la storage/resolveAssetKey), así que toma un subconjunto de deps.
 */
export async function measureAndEvaluateQa(
  deps: {
    ffprobe?: FfprobeRunner;
    loudnessMeter: LoudnessMeter;
  },
  args: { masterPath: string; captionViolations: number | null; variantMaxDurationS: number },
): Promise<QaReport> {
  const ffprobe = deps.ffprobe ?? defaultFfprobeRunner;
  const measurements = await measureQa({ loudnessMeter: deps.loudnessMeter }, ffprobe, {
    masterPath: args.masterPath,
    captionViolations: args.captionViolations,
  });
  return evaluateQa(measurements, args.variantMaxDurationS);
}

/** Mide QA sobre el máster firmado: ffprobe (streams + format) + loudness + las violaciones ya contadas. */
async function measureQa(
  deps: { loudnessMeter: LoudnessMeter },
  ffprobe: FfprobeRunner,
  args: { masterPath: string; captionViolations: number | null },
): Promise<QaMeasurements> {
  const probe = await probeStreamsAndFormat(ffprobe, args.masterPath);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  if (v === undefined) {
    throw new ComposeVariantError('composeVariant: el máster firmado no tiene stream de vídeo', {
      phase: 'qa',
      exitCode: 0,
      stderr: '',
    });
  }
  const loudnessLufs =
    a !== undefined ? await deps.loudnessMeter(args.masterPath).catch(() => null) : null;
  const filesizeBytes = (await stat(args.masterPath)).size;

  return {
    width: numberOf(v.width) ?? 0,
    height: numberOf(v.height) ?? 0,
    fps: parseFrameRate(v.r_frame_rate),
    videoCodec: stringOf(v.codec_name) ?? '',
    pixFmt: stringOf(v.pix_fmt) ?? '',
    audioCodec: a !== undefined ? (stringOf(a.codec_name) ?? null) : null,
    audioSampleRate: a !== undefined ? numberOf(a.sample_rate) : null,
    audioChannels: a !== undefined ? numberOf(a.channels) : null,
    audioBitrate: a !== undefined ? numberOf(a.bit_rate) : null,
    videoDurationS: numberOf(probe.format.duration) ?? 0,
    // La duración del stream de AUDIO, NO la del contenedor. Si el audio existe pero su stream no reporta
    // `duration`, cae a `null` (→ `av_duration_diff` da `fail`, un fallo OBSERVABLE), NO a `format.duration`:
    // caer al contenedor compararía vídeo contra ≈vídeo y el check de desincronía pasaría "gratis" — colapsaría
    // "no pude medir el audio" con "audio sincronizado", que es justo lo que este check existe para distinguir.
    audioDurationS: a !== undefined ? numberOf(a.duration) : null,
    loudnessLufs,
    filesizeBytes,
    captionViolations: args.captionViolations,
  };
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  sample_rate?: string | number;
  channels?: number;
  bit_rate?: string | number;
  duration?: string | number;
}
interface ProbeResult {
  streams: ProbeStream[];
  format: { duration?: string | number };
}

async function probeStreamsAndFormat(ffprobe: FfprobeRunner, path: string): Promise<ProbeResult> {
  const result = await ffprobe([
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    path,
  ]);
  if (result.code !== 0) {
    throw new ComposeVariantError(
      `composeVariant: ffprobe falló midiendo el máster (código ${String(result.code)})`,
      { phase: 'qa', exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }
  return JSON.parse(result.stdout) as ProbeResult;
}

/** Duración (s) de un fichero local con ffprobe (format=duration). Reusa el patrón de compose-master. */
async function probeDuration(ffprobe: FfprobeRunner, path: string): Promise<number> {
  const result = await ffprobe([
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  if (result.code !== 0) {
    throw new ComposeVariantError(
      `composeVariant: ffprobe falló midiendo la duración de ${path} (código ${String(result.code)})`,
      { phase: 'qa', exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }
  const seconds = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ComposeVariantError(
      `composeVariant: duración inválida para ${path} (${JSON.stringify(result.stdout.trim())})`,
      { phase: 'qa', exitCode: 0, stderr: '' },
    );
  }
  return seconds;
}

/** `num/den` → fps. `30/1` → 30. Devuelve 0 si no parsea. */
function parseFrameRate(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const [num, den] = raw.split('/');
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}

function numberOf(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function stringOf(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
