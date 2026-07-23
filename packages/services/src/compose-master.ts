// CONCAT + MEZCLA DE AUDIO → MÁSTER INTERMEDIO (T5.3, §9.7). El worker de render, tras normalizar cada
// asset de una variante (T5.2), los ENSAMBLA según el `CompositionSpec` (contrato en @ugc/core):
//   1. CONCAT de vídeo con el concat DEMUXER + `-c copy` — los segmentos YA vienen normalizados por T5.2
//      (mismo codec/timebase/SAR/fps), que es JUSTAMENTE lo que hace válido el `-c copy` sin re-encode ni
//      glitches en los cortes. Assets crudos de fal darían glitches → la dependencia T5.2→T5.3 es
//      load-bearing, no incidental. Los normalizados van `-an` (T5.2), así que el concat de vídeo NO lleva
//      audio: el audio se construye aparte y se muxea al final.
//   2. MEZCLA DE AUDIO en 2 capas: la VOZ (los `voAudio` de los segmentos, concatenados en orden) + el BED
//      musical con `volume` (0,2–0,3), DUCKING (`sidechaincompress`: el bed se hunde cuando entra la voz),
//      `afade` out al final, y `loudnorm I=-14` sobre la mezcla. La voz manda la sidechain del ducking.
//   3. MUX final: `-map 0:v -c:v copy` (el vídeo concatenado sin re-encode) + la mezcla como pista de audio
//      (AAC 48k). Es un MÁSTER INTERMEDIO: NO lleva burn-in de subtítulos (T5.4) ni qa_report/C2PA (T5.5).
//
// MÓDULO REUTILIZABLE, NO EXECUTOR (patrón T5.2): `compose()` es file/bytes-in/bytes-out. Materializa los
// assets de storage a temp (resolviendo `assetId → storageKey` por INYECCIÓN — la BD la cablea T5.5), corre
// ffmpeg, devuelve los bytes del máster. NO crea la fila `asset` ni escribe en la BD. Limpia los temps
// SIEMPRE en `finally` (nunca basura en /tmp aunque ffmpeg falle).
//
// FILTERGRAPHS COMO BUILDERS PUROS (principio 9 de testing): `buildDuckingGraph` es PRODUCCIÓN exportada —
// el test de ducking lo IMPORTA y renderiza la rama del bed ducked, en vez de reimplementar el graph. El
// resto de la mezcla y los args del concat también son builders puros, testeables sin ffmpeg en el gate.
//
// CLASE DE ERROR PROPIA (`ComposeError`, anti-T1.8): «ffmpeg no pudo ensamblar el máster» es una capa
// DISTINTA de NormalizeError / AudioExtractionError / fal. No se colapsan.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CompositionSpec } from '@ugc/core/contracts';
import type { Logger, StorageAdapter } from '@ugc/core';

import {
  defaultFfmpegRunner,
  defaultFfprobeRunner,
  materializeToBytes,
  tailStderr,
  type FfmpegRunner,
  type FfprobeRunner,
} from './extract-audio-track';
import { NOOP_LOGGER } from './noop-logger';

/**
 * El ensamblado del máster con ffmpeg falló: ffmpeg salió con código ≠0, el binario no está, o los inputs
 * no son ensamblables. Clase PROPIA (anti-T1.8, hermana de `NormalizeError`/`AudioExtractionError`): «no se
 * pudo componer el máster» ≠ «storage falló» ≠ «fal devolvió mal». Lleva `exitCode`+`stderr` de ffmpeg.
 */
export class ComposeError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(message: string, opts: { exitCode: number | null; stderr: string }) {
    super(message);
    this.name = 'ComposeError';
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
  }
}

// ── PARÁMETROS DE MEZCLA (constantes de producción, la ÚNICA verdad; el test las hereda vía los builders) ──

/**
 * Los parámetros de `sidechaincompress` del ducking. El bed (main input) se comprime cuando la voz
 * (sidechain) supera el `threshold`. `ratio` alto + `makeup:1` → el bed cae con fuerza bajo la voz y se
 * recupera al soltar. `attack`/`release` en ms controlan lo abrupto del hundimiento/recuperación. Valores
 * elegidos para un ducking CLARAMENTE audible (≥6 dB de caída, el umbral del test) sin bombeo brusco.
 */
export const DUCKING_PARAMS = {
  threshold: 0.03,
  ratio: 12,
  attack: 20,
  release: 300,
  makeup: 1,
} as const;

/** El target de loudness integrado del máster (§9.7: `loudnorm I=-14`). LUFS. */
export const LOUDNORM_TARGET_I = -14;
/** El true peak y el rango de loudnorm (defaults sanos para -14 LUFS de contenido social). Internos: no
 *  cruzan la frontera del paquete (solo el target I lo importan los tests). */
const LOUDNORM_TARGET_TP = -1.5;
const LOUDNORM_TARGET_LRA = 11;

// ── BUILDERS PUROS DE FILTERGRAPH (testeables sin ffmpeg → gate) ──────────────────────────────────────

/**
 * El GRAFO DE DUCKING: comprime `bedLabel` (el bed) usando `voiceLabel` (la voz) como cadena lateral. Es la
 * pieza que el test de ducking renderiza AISLADA (solo la rama del bed ducked) — por eso es un builder
 * PURO exportado y no se reimplementa en el test (principio 9). Los LABELS son parámetros (el test usa
 * `0:a`/`1:a`; producción usa las labels de su graph), pero los PARÁMETROS de compresión son fijos: son
 * justamente lo que no debe divergir entre test y producción. El pre-volumen del bed NO cambia los dB de
 * reducción (sidechaincompress se dispara por el nivel de la SIDECHAIN vs threshold), así que la caída
 * ≥6 dB que el test mide sobre el bed a nivel pleno se transfiere al bed a 0,2 de producción.
 *
 * ESTAMPADO DE CHANNEL_LAYOUT (T5.8a): `sidechaincompress` exige que su main input tenga `channel_layout`
 * DEFINIDO — no negocia formatos si le llega `unknown`. El bed de ace-step es WAV `channel_layout=unknown`
 * (los WAV no persisten el tag de layout), así que se antepone `aformat=channel_layouts=stereo` al bed
 * INMEDIATAMENTE antes del `sidechaincompress`. Va aquí, adyacente al filtro, y NO río arriba (p. ej. antes
 * del `volume` del caller) a propósito: `volume` re-propaga el layout `unknown` de su entrada, así que
 * cualquier estampa previa a él se pierde y el sidechain vuelve a fallar («could not choose their formats»).
 * Al vivir en el builder, CUALQUIER caller del grafo de ducking queda blindado, no solo el executor N8.
 */
export function buildDuckingGraph(labels: {
  bedLabel: string;
  voiceLabel: string;
  outLabel: string;
}): string {
  const { bedLabel, voiceLabel, outLabel } = labels;
  const { threshold, ratio, attack, release, makeup } = DUCKING_PARAMS;
  return (
    // Estampa el layout del bed adyacente al sidechain (ver nota de arriba: NO antes del `volume`).
    `[${bedLabel}]aformat=channel_layouts=stereo[bedfmt];` +
    `[bedfmt][${voiceLabel}]sidechaincompress=` +
    `threshold=${String(threshold)}:ratio=${String(ratio)}:` +
    `attack=${String(attack)}:release=${String(release)}:makeup=${String(makeup)}` +
    `[${outLabel}]`
  );
}

/**
 * El `-filter_complex` COMPLETO de la mezcla de audio. Los ÍNDICES de input son parámetros porque el mux
 * antepone el vídeo concatenado como input 0 → la voz y el bed no son `0:a`/`1:a` sino `1:a`/`2:a`.
 * `voiceInput`/`bedInput` son los stream specifiers (`1:a`, `2:a`) que el caller pasa según el orden de sus
 * `-i`. La cadena:
 *   voz  → `[voiceInput]` (ya concatenada aparte)
 *   bed  → `volume` → (si ducking) `buildDuckingGraph` con la voz de sidechain → `afade` out → `[bed]`
 *   mix  → `amix` de voz + bed → `loudnorm I=-14` → `[mix]`
 * Cuando NO hay bed, la mezcla es la voz sola → `loudnorm` → `[mix]`. Builder PURO: el test de loudness lo
 * ejerce indirectamente vía el máster completo; su forma la fija su unit test co-locado.
 */
export function buildAudioMixGraph(opts: {
  hasBed: boolean;
  voiceInput: string;
  bedInput: string;
  volume: number;
  ducking: boolean;
  fadeOutS: number;
  fadeStartS: number;
}): string {
  const { hasBed, voiceInput, bedInput, volume, ducking, fadeOutS, fadeStartS } = opts;
  const loudnorm =
    `loudnorm=I=${String(LOUDNORM_TARGET_I)}:` +
    `TP=${String(LOUDNORM_TARGET_TP)}:LRA=${String(LOUDNORM_TARGET_LRA)}`;

  if (!hasBed) {
    // Solo voz: normaliza el loudness de la voz directamente.
    return `[${voiceInput}]${loudnorm}[mix]`;
  }

  // Bed: volumen → (ducking) → fade-out → amix con la voz → loudnorm.
  const parts: string[] = [];
  parts.push(`[${bedInput}]volume=${String(volume)}[bedvol]`);
  let bedLabel = 'bedvol';
  if (ducking) {
    // La voz es la sidechain que hunde el bed. `buildDuckingGraph` es la MISMA pieza que el test renderiza
    // aislada — aquí opera sobre el bed ya escalado por `volume`.
    parts.push(
      buildDuckingGraph({ bedLabel: 'bedvol', voiceLabel: voiceInput, outLabel: 'ducked' }),
    );
    bedLabel = 'ducked';
  }
  if (fadeOutS > 0) {
    parts.push(`[${bedLabel}]afade=t=out:st=${String(fadeStartS)}:d=${String(fadeOutS)}[bedfaded]`);
    bedLabel = 'bedfaded';
  }
  // `amix` sumaría potencias y bajaría el volumen (normalize=1 por defecto); usamos normalize=0 para que
  // la voz conserve su nivel y el bed entre a su volumen escalado — `loudnorm` clava el integrado a -14.
  parts.push(`[${voiceInput}][${bedLabel}]amix=inputs=2:normalize=0[amixed]`);
  parts.push(`[amixed]${loudnorm}[mix]`);
  return parts.join(';');
}

/**
 * Los ARGS del CONCAT DEMUXER de vídeo con `-c copy`. `-f concat -safe 0 -i <list>` lee un fichero de
 * texto con `file '<path>'` por línea; `-map 0:v -c:v copy -an` copia el stream de vídeo SIN re-encode
 * (los segmentos ya son uniformes por T5.2) y descarta cualquier audio (los normalizados van `-an`
 * igualmente). Es el `-c copy` que preserva los cortes sin glitches. Builder PURO: su unit test co-locado
 * (gate) verifica que contiene `-c copy` — la cláusula determinista de la Verificación como test permanente.
 */
export function buildConcatArgs(listPath: string, outPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-map',
    '0:v',
    '-c:v',
    'copy',
    '-an',
    '-y',
    outPath,
  ];
}

/** El contenido del fichero de lista del concat demuxer: una línea `file '<path>'` por segmento, en orden.
 *  Las comillas simples se escapan según la sintaxis del demuxer (`'\''`). Builder PURO. */
export function buildConcatListFile(segmentPaths: readonly string[]): string {
  return segmentPaths.map((p) => `file '${p.replaceAll("'", String.raw`'\''`)}'`).join('\n') + '\n';
}

/** Los ARGS del CONCAT DEMUXER de audio (la voz): mismo demuxer, pero copiando el stream de AUDIO. Se usa
 *  para concatenar los `voAudio` de los segmentos en una única pista de voz antes de la mezcla. */
export function buildAudioConcatArgs(listPath: string, outPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-map',
    '0:a',
    '-c:a',
    'copy',
    '-vn',
    '-y',
    outPath,
  ];
}

/**
 * Los ARGS del MUX final del máster: el vídeo concatenado (`0:v`, copiado sin re-encode) + la pista de
 * audio mezclada. Cuando hay bed, ffmpeg recibe DOS inputs de audio (voz=input 1, bed=input 2) y el
 * `-filter_complex` los mezcla a `[mix]`; cuando no, solo la voz. El resultado se encoda a AAC 48k (el
 * audio SÍ se re-encoda — es una mezcla nueva; el vídeo NO).
 *
 * `-t durationS` fija la longitud del máster a la del VÍDEO concatenado (medida con ffprobe). El VÍDEO es
 * autoritativo: NO `-shortest` (que recortaría el máster si la voz o el bed fueran más cortos que el vídeo
 * — un voiceover suele ser más corto que su clip, y `-shortest` cortaría el final del vídeo). Con `-t` el
 * vídeo se preserva entero y el audio, si acaba antes, deja una cola de silencio (correcto para un máster).
 */
export function buildMuxArgs(opts: {
  videoPath: string;
  voicePath: string;
  bedPath: string | null;
  filterComplex: string;
  durationS: number;
  outPath: string;
}): string[] {
  const { videoPath, voicePath, bedPath, filterComplex, durationS, outPath } = opts;
  const args = ['-hide_banner', '-loglevel', 'error', '-i', videoPath, '-i', voicePath];
  if (bedPath !== null) {
    args.push('-i', bedPath);
  }
  args.push(
    '-filter_complex',
    filterComplex,
    '-map',
    '0:v',
    '-map',
    '[mix]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-t',
    durationS.toFixed(3),
    '-y',
    outPath,
  );
  return args;
}

// ── LA CAPA DE ORQUESTACIÓN (materializa + ffmpeg + bytes-out) ────────────────────────────────────────

/** Resuelve un `assetId` (del `CompositionSpec`) a su `storageKey`. Producción (T5.5): consulta `asset`
 *  por id en la BD. Inyectable → el test media usa un Map, sin Postgres. */
export type ResolveAssetKey = (assetId: string) => Promise<string> | string;

export interface ComposeMasterDeps {
  storage: StorageAdapter;
  /** `assetId → storageKey` (la resolución de la BD la cablea T5.5; el test inyecta un Map). */
  resolveAssetKey: ResolveAssetKey;
  /** Runner de ffmpeg INYECTABLE (default: subproceso real). */
  runner?: FfmpegRunner;
  /** Runner de ffprobe INYECTABLE (default: subproceso real). Se usa para medir la duración REAL del vídeo
   *  concatenado y anclar el fade-out del bed a ese final (no al `maxDurationS`, que es un TECHO). */
  ffprobe?: FfprobeRunner;
  logger?: Logger;
}

export interface ComposeMasterResult {
  /** Los bytes del máster intermedio (H.264 vídeo copiado + AAC 48k mezcla). */
  bytes: Uint8Array;
  /** El mime del máster (`video/mp4`). */
  mime: string;
}

/**
 * ENSAMBLA el máster intermedio de una variante desde su `CompositionSpec`. Materializa los assets de
 * storage a temp, concatena el vídeo (`-c copy`), concatena+mezcla el audio (voz + bed con ducking/fade/
 * loudnorm), muxea y devuelve los bytes. LANZA `ComposeError` si algún paso de ffmpeg falla. Limpia los
 * temps SIEMPRE en `finally`.
 *
 * NO crea la fila `asset` ni escribe en la BD (eso es del caller de T5.5): módulo reutilizable, no executor.
 */
export async function composeMaster(
  deps: ComposeMasterDeps,
  spec: CompositionSpec,
): Promise<ComposeMasterResult> {
  const log = deps.logger ?? NOOP_LOGGER;
  const runner = deps.runner ?? defaultFfmpegRunner;
  const ffprobe = deps.ffprobe ?? defaultFfprobeRunner;

  const dir = await mkdtemp(join(tmpdir(), 'ugc-compose-'));
  try {
    // 1. Materializar los clips de vídeo y las voces de cada segmento a temp files.
    const videoPaths: string[] = [];
    const voicePaths: string[] = [];
    for (const [i, segment] of spec.segments.entries()) {
      const videoKey = await deps.resolveAssetKey(segment.videoAsset);
      const voiceKey = await deps.resolveAssetKey(segment.voAudio);
      const videoPath = join(dir, `seg-${String(i)}.mp4`);
      const voicePath = join(dir, `seg-${String(i)}.m4a`);
      await writeFile(videoPath, await materializeToBytes(deps.storage, videoKey));
      await writeFile(voicePath, await materializeToBytes(deps.storage, voiceKey));
      videoPaths.push(videoPath);
      voicePaths.push(voicePath);
    }

    // 2. Concat del VÍDEO (`-c copy`, sin glitches: segmentos ya normalizados por T5.2).
    const videoListPath = join(dir, 'video-list.txt');
    await writeFile(videoListPath, buildConcatListFile(videoPaths));
    const concatVideoPath = join(dir, 'concat-video.mp4');
    await runFfmpeg(runner, 'concat de vídeo', buildConcatArgs(videoListPath, concatVideoPath));

    // 3. Concat de la VOZ (los `voAudio` en orden → una pista de voz).
    const voiceListPath = join(dir, 'voice-list.txt');
    await writeFile(voiceListPath, buildConcatListFile(voicePaths));
    const concatVoicePath = join(dir, 'concat-voice.m4a');
    await runFfmpeg(runner, 'concat de voz', buildAudioConcatArgs(voiceListPath, concatVoicePath));

    // 4. Materializar el BED musical (si lo hay) y medir la duración del vídeo para el fade-out.
    // `bedAsset` se extrae UNA vez con el narrowing (nullable) preservado: un `hasBed: boolean` plano no
    // estrecharía `spec.music.asset` dentro del if y el typecheck del gate lanzaría «possibly null».
    const bedAsset = spec.music?.asset ?? null;
    const hasBed = bedAsset !== null;
    let bedPath: string | null = null;
    if (bedAsset !== null) {
      const bedKey = await deps.resolveAssetKey(bedAsset);
      bedPath = join(dir, 'bed.m4a');
      await writeFile(bedPath, await materializeToBytes(deps.storage, bedKey));
    }

    // El fade-out del bed arranca `fadeOutS` antes del FINAL REAL del máster. El final = duración del vídeo
    // concatenado, a la que `buildMuxArgs` fija el máster con `-t <duración>` (NO `-shortest`, que recortaría
    // el vídeo si el audio fuese más corto). Se MIDE con ffprobe sobre el concat, NO se usa `maxDurationS`
    // (que es un TECHO, no la duración: un máster de 9 s con cap 30 tendría el fade anclado en el segundo 28
    // → nunca dispararía). `fadeStart = max(0, duración - fadeOutS)`.
    const fadeOutS = spec.music?.fadeOutS ?? 0;
    const masterDurationS = await probeDurationSeconds(ffprobe, concatVideoPath);
    const fadeStartS = Math.max(0, masterDurationS - fadeOutS);

    // 5. Construir el filtergraph de mezcla y muxear el máster. En el mux el vídeo es el input 0, así que la
    // voz es el input 1 (`1:a`) y el bed el input 2 (`2:a`) — los índices de audio NO empiezan en 0.
    const filterComplex = buildAudioMixGraph({
      hasBed,
      voiceInput: '1:a',
      bedInput: '2:a',
      volume: spec.music?.volume ?? 0,
      ducking: spec.music?.ducking ?? false,
      fadeOutS,
      fadeStartS,
    });
    const masterPath = join(dir, 'master.mp4');
    await runFfmpeg(
      runner,
      'mux del máster',
      buildMuxArgs({
        videoPath: concatVideoPath,
        voicePath: concatVoicePath,
        bedPath,
        filterComplex,
        durationS: masterDurationS,
        outPath: masterPath,
      }),
    );

    const bytes = new Uint8Array(await readFile(masterPath));
    if (bytes.byteLength === 0) {
      throw new ComposeError('composeMaster: el ensamblado produjo un máster de 0 bytes', {
        exitCode: 0,
        stderr: '',
      });
    }

    log.info(
      { event: 'master_composed', segments: spec.segments.length, hasBed, bytes: bytes.byteLength },
      'máster intermedio ensamblado (concat + mezcla de audio)',
    );
    return { bytes, mime: 'video/mp4' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // Best-effort: un fallo de limpieza no debe enmascarar el error real del ensamblado.
    });
  }
}

/** Corre el runner de ffmpeg sobre `args` y LANZA `ComposeError` si el exit ≠ 0 (el runner nunca rechaza
 *  por exit≠0: es un resultado). `label` nombra el paso para el mensaje de error. */
async function runFfmpeg(runner: FfmpegRunner, label: string, args: string[]): Promise<void> {
  const result = await runner(args);
  if (result.code !== 0) {
    throw new ComposeError(
      `composeMaster: ffmpeg falló en «${label}» (código ${String(result.code)})`,
      {
        exitCode: result.code,
        stderr: tailStderr(result.stderr),
      },
    );
  }
}

/** Mide la duración (segundos) de un fichero LOCAL con ffprobe (para anclar el fade-out del bed al final
 *  REAL del máster). LANZA `ComposeError` si ffprobe falla o su salida no es un número finito positivo. */
async function probeDurationSeconds(ffprobe: FfprobeRunner, path: string): Promise<number> {
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
    throw new ComposeError(
      `composeMaster: ffprobe falló midiendo la duración de ${path} (código ${String(result.code)})`,
      { exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }
  const seconds = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ComposeError(
      `composeMaster: ffprobe no devolvió una duración válida para ${path} (stdout: ${JSON.stringify(result.stdout.trim())})`,
      { exitCode: 0, stderr: tailStderr(result.stderr) },
    );
  }
  return seconds;
}
