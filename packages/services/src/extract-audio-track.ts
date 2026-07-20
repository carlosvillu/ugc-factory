// Extracción de la PISTA DE AUDIO de un clip de vídeo con ffmpeg (T4.7b, N7c ruta VEED).
//
// POR QUÉ EXISTE. La ruta VEED de N7c (`veed/avatars/text-to-video`) produce un clip de vídeo con la
// voz EMBEBIDA en el contenedor. Para sacar los `word_timestamps` del hook hay que pasar ese audio por
// el ASR (`fal-ai/elevenlabs/speech-to-text`), pero se PROBÓ contra fal real que el ASR da **422 sobre
// un contenedor de VÍDEO** (solo acepta audio). Entre "un mp4 con la voz dentro" y "un audio que el ASR
// acepta" falta un paso: extraer la pista de audio a un WAV. Ese paso es ffmpeg, que la imagen del
// worker trae desde T5.1.
//
// STORAGE ES PURO STREAMS (ports.ts): `StorageAdapter` no expone rutas de fichero, y ffmpeg lee/escribe
// FICHEROS, no streams de storage. Así que el wrapper materializa el vídeo a un temp file, corre ffmpeg
// sobre él, lee el WAV de salida de vuelta a memoria, y limpia AMBOS temps en `finally` (nunca deja
// basura en /tmp aunque ffmpeg falle).
//
// EL SPAWN ES INYECTABLE. El runner del subproceso es un dep opcional (default `node:child_process`
// spawn). Los tests inyectan un fake que simula éxito (escribe un WAV de fixture) o fallo (exit≠0) — el
// gate NO corre ffmpeg real (igual que no construye la imagen Docker); la extracción REAL se verifica en
// la imagen del worker (lo hace el verifier vía el smoke). Un test que hiciera shell-out a ffmpeg real
// dependería de "el Mac tiene ffmpeg" y divergiría del gate.
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger, StorageAdapter } from '@ugc/core';
import { newUlid } from '@ugc/core/contracts';

import { NOOP_LOGGER } from './noop-logger';

/**
 * La extracción de audio con ffmpeg falló: ffmpeg salió con código ≠0, el binario no está, o el input
 * no es un vídeo decodificable. Clase PROPIA (no `FalResponseError`) para NO confundir "ffmpeg no pudo
 * extraer el audio" con "fal devolvió un output malformado" ni con "el ASR falló": son fallos de capas
 * distintas (subproceso local vs proveedor de red vs contrato de respuesta) y colapsarlos degradaría la
 * observabilidad (anti-patrón T1.8). Lleva el `exitCode` y el `stderr` de ffmpeg para diagnóstico.
 */
export class AudioExtractionError extends Error {
  /** El código de salida de ffmpeg (null si el proceso no llegó a arrancar: binario ausente, spawn error). */
  readonly exitCode: number | null;
  /** El stderr de ffmpeg (truncado), la causa raíz legible del fallo de extracción. */
  readonly stderr: string;
  constructor(message: string, opts: { exitCode: number | null; stderr: string }) {
    super(message);
    this.name = 'AudioExtractionError';
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
  }
}

/**
 * El sondeo de la DURACIÓN del clip con ffprobe falló: ffprobe salió con código ≠0, el binario no está,
 * o su stdout no es un número parseable. Clase PROPIA (anti-T1.8, hermana de `AudioExtractionError`): un
 * fallo del PROBE de duración (medir cuánto dura el clip) es una capa DISTINTA de "ffmpeg no pudo extraer
 * el audio" y de "fal devolvió un output malformado". El endpoint VEED (`veed/avatars/text-to-video`) NO
 * emite `duration` en su output (confirmado vs la doc de fal), así que la duración —que hace falta para
 * facturar por minuto— se MIDE con ffprobe sobre el clip ya descargado, antes de liquidar.
 */
export class VideoProbeError extends Error {
  /** El código de salida de ffprobe (null si el proceso no arrancó: binario ausente / spawn error). */
  readonly exitCode: number | null;
  /** El stderr de ffprobe (truncado), la causa raíz legible del fallo del sondeo. */
  readonly stderr: string;
  constructor(message: string, opts: { exitCode: number | null; stderr: string }) {
    super(message);
    this.name = 'VideoProbeError';
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
  }
}

/** El resultado de correr el subproceso ffmpeg: código de salida + stderr capturado. `code === null`
 *  cuando el proceso no pudo arrancar (binario ausente / error de spawn). */
interface FfmpegRunResult {
  code: number | null;
  stderr: string;
}

/** El resultado de correr el subproceso ffprobe: código de salida + stdout (donde ffprobe imprime la
 *  duración) + stderr. `code === null` cuando el proceso no pudo arrancar. A diferencia del runner de
 *  ffmpeg, ESTE captura stdout: es de ahí de donde se lee el número de segundos. */
interface FfprobeRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** El runner del subproceso ffmpeg, INYECTABLE (default: `node:child_process` spawn). Recibe los args de
 *  ffmpeg (sin el binario) y resuelve con su código de salida + stderr. NUNCA rechaza por un exit≠0 (eso
 *  es un resultado, no un error del runner); solo rechazaría por un fallo de infraestructura del runner
 *  mismo, que el caller trata igual que un exit fallido. */
export type FfmpegRunner = (args: string[]) => Promise<FfmpegRunResult>;

/** Runner por defecto: `spawn('ffmpeg', args)`, captura stderr, resuelve al cerrar. Un error de spawn
 *  (ENOENT: ffmpeg no está en PATH) resuelve con `code:null` y el mensaje del error como stderr — el
 *  caller lo mapea a `AudioExtractionError` con el resto. */
export function defaultFfmpegRunner(args: string[]): Promise<FfmpegRunResult> {
  return new Promise((resolve) => {
    const child = nodeSpawn('ffmpeg', args);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ code: null, stderr: err instanceof Error ? err.message : String(err) });
    });
    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
}

/** El runner del subproceso ffprobe, INYECTABLE (default: `node:child_process` spawn). Recibe los args de
 *  ffprobe (sin el binario) y resuelve con código de salida + stdout + stderr. NUNCA rechaza por exit≠0
 *  (es un resultado, no un error del runner). */
export type FfprobeRunner = (args: string[]) => Promise<FfprobeRunResult>;

/** Runner por defecto de ffprobe: `spawn('ffprobe', args)`, captura stdout Y stderr, resuelve al cerrar.
 *  Un error de spawn (ENOENT: ffprobe no está en PATH) resuelve con `code:null` y el mensaje como stderr.
 *  EXPORTADO para que `compose-master` (T5.3) mida la duración de un fichero LOCAL (no de storage, que es
 *  lo que hace `probeVideoDurationSeconds`) al anclar el fade-out. */
export function defaultFfprobeRunner(args: string[]): Promise<FfprobeRunResult> {
  return new Promise((resolve) => {
    const child = nodeSpawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ code: null, stdout: '', stderr: err instanceof Error ? err.message : String(err) });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export interface ExtractAudioTrackDeps {
  storage: StorageAdapter;
  /** El runner de ffmpeg, inyectable para los tests (default: subproceso real). */
  ffmpeg?: FfmpegRunner;
  logger?: Logger;
}

export interface ProbeVideoDurationDeps {
  storage: StorageAdapter;
  /** El runner de ffprobe, inyectable para los tests (default: subproceso real). */
  ffprobe?: FfprobeRunner;
  logger?: Logger;
}

export interface ExtractAudioTrackResult {
  /** Los bytes del WAV extraído (PCM s16le), listos para crear un asset y subir al ASR. */
  bytes: Uint8Array;
  /** El mime del audio extraído (`audio/wav`). */
  mime: string;
}

/** Los últimos ~2 KB del stderr de ffmpeg: suficiente para el diagnóstico sin volcar megabytes de log. */
export function tailStderr(stderr: string): string {
  const MAX = 2048;
  return stderr.length > MAX ? stderr.slice(-MAX) : stderr;
}

/** Materializa un asset de storage (stream web) a bytes en memoria — ffmpeg lee ficheros/bytes, no
 *  `ReadableStream`s de storage. Helper COMPARTIDO por los módulos de media (extracción T4.7b,
 *  normalización T5.2, composición T5.3): todos hacen `storage.get → Response → arrayBuffer` idéntico. */
export async function materializeToBytes(
  storage: StorageAdapter,
  key: string,
): Promise<Uint8Array> {
  const stream = await storage.get(key);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Extrae la pista de audio de un clip de vídeo (en NUESTRO storage) a un WAV en memoria, con ffmpeg.
 * Materializa el vídeo a un temp file, corre `ffmpeg -i <in> -vn -acodec pcm_s16le -ac 1 <out>.wav`
 * (`-vn` descarta el vídeo; PCM WAV mono es un formato que el ASR acepta sin ambigüedad de contenedor),
 * lee el WAV de vuelta y limpia los temps. LANZA `AudioExtractionError` (con exit code + stderr) si
 * ffmpeg falla — un fallo DETERMINISTA de la entrada, distinto de un fallo de fal/ASR.
 *
 * `storageKey` es la clave del clip de vídeo en storage. El temp de entrada se nombra `in.mp4` fijo:
 * ffmpeg elige el demuxer por CONTENIDO (no por la extensión), y VEED siempre entrega un .mp4 — un
 * parámetro de extensión sería inerte (su único valor posible es el default).
 */
export async function extractAudioTrack(
  deps: ExtractAudioTrackDeps,
  args: { storageKey: string },
): Promise<ExtractAudioTrackResult> {
  const log = deps.logger ?? NOOP_LOGGER;
  const runFfmpeg = deps.ffmpeg ?? defaultFfmpegRunner;

  // Materializar el clip de storage (stream) a un temp file: ffmpeg lee ficheros, no ReadableStreams.
  const dir = await mkdtemp(join(tmpdir(), 'ugc-extract-'));
  const inPath = join(dir, `in.mp4`);
  const outPath = join(dir, `out.wav`);
  try {
    await writeFile(inPath, await materializeToBytes(deps.storage, args.storageKey));

    const result = await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inPath,
      '-vn', // drop the video stream — we only want the embedded voice track
      '-acodec',
      'pcm_s16le',
      '-ac',
      '1', // mono: the voiceover is a single speaker; smaller input for the ASR
      '-y',
      outPath,
    ]);
    if (result.code !== 0) {
      throw new AudioExtractionError(
        `extractAudioTrack: ffmpeg salió con código ${String(result.code)} extrayendo el audio de ${args.storageKey}`,
        { exitCode: result.code, stderr: tailStderr(result.stderr) },
      );
    }

    const bytes = new Uint8Array(await readFile(outPath));
    if (bytes.byteLength === 0) {
      throw new AudioExtractionError(
        `extractAudioTrack: ffmpeg produjo un WAV de 0 bytes para ${args.storageKey} (¿el clip no tiene pista de audio?)`,
        { exitCode: 0, stderr: tailStderr(result.stderr) },
      );
    }

    log.info(
      {
        event: 'audio_track_extracted',
        sourceStorageKey: args.storageKey,
        bytes: bytes.byteLength,
      },
      'pista de audio extraída del clip de vídeo con ffmpeg',
    );
    return { bytes, mime: 'audio/wav' };
  } finally {
    // Limpiar SIEMPRE los temps (aunque ffmpeg fallara): nunca dejar basura en /tmp.
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // La limpieza es best-effort: un fallo aquí no debe enmascarar el error real de la extracción.
    });
  }
}

/**
 * Mide la DURACIÓN (segundos) de un clip de vídeo (en NUESTRO storage) con ffprobe. Materializa el vídeo
 * a un temp file (storage es puro streams; ffprobe lee ficheros), corre
 * `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <in>`, parsea el
 * número de stdout y limpia el temp. LANZA `VideoProbeError` (con exit code + stderr) si ffprobe falla o
 * su salida no es un número finito positivo.
 *
 * POR QUÉ EXISTE. El endpoint VEED (`veed/avatars/text-to-video`) NO emite `duration` en su output
 * (confirmado vs la doc de fal 2026-07-20), pero el clip se factura POR MINUTO — hace falta la duración
 * ANTES de liquidar. Se MIDE aquí, sobre el clip ya descargado, antes del `cost`+`finalize` (así la
 * facturación por minuto es exacta y `charged⟺completed` se preserva sobre la duración REAL). Un fallo del
 * probe ocurre ANTES de facturar → no hay dinero en juego (el clip queda descargado pero sin `cost_entry`).
 */
export async function probeVideoDurationSeconds(
  deps: ProbeVideoDurationDeps,
  args: { storageKey: string },
): Promise<number> {
  const log = deps.logger ?? NOOP_LOGGER;
  const runFfprobe = deps.ffprobe ?? defaultFfprobeRunner;

  const dir = await mkdtemp(join(tmpdir(), 'ugc-probe-'));
  const inPath = join(dir, `in.mp4`);
  try {
    await writeFile(inPath, await materializeToBytes(deps.storage, args.storageKey));

    const result = await runFfprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inPath,
    ]);
    if (result.code !== 0) {
      throw new VideoProbeError(
        `probeVideoDurationSeconds: ffprobe salió con código ${String(result.code)} sondeando ${args.storageKey}`,
        { exitCode: result.code, stderr: tailStderr(result.stderr) },
      );
    }
    const durationSeconds = Number.parseFloat(result.stdout.trim());
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new VideoProbeError(
        `probeVideoDurationSeconds: ffprobe no devolvió una duración válida para ${args.storageKey} (stdout: ${JSON.stringify(result.stdout.trim())})`,
        { exitCode: 0, stderr: tailStderr(result.stderr) },
      );
    }

    log.info(
      { event: 'video_duration_probed', sourceStorageKey: args.storageKey, durationSeconds },
      'duración del clip de vídeo medida con ffprobe',
    );
    return durationSeconds;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // Best-effort: un fallo de limpieza no debe enmascarar el error real del sondeo.
    });
  }
}

/** El identificador de un asset de audio nuevo para el WAV extraído (namespacing legible por generación). */
export function extractedAudioStorageKey(generationId: string): string {
  return `generations/${generationId}/extracted-audio-${newUlid()}.wav`;
}
