// Assets sintéticos generados en el propio test con las fuentes `lavfi` de ffmpeg (testing/references/
// media-composition.md §"Assets sintéticos"). PROHIBIDO comitear fixtures binarios de vídeo/audio: son
// deterministas (mismo comando → mismo contenido), se generan en <1 s, no pesan en git y documentan en
// el propio test qué propiedades tiene el input. Estos helpers se exportan como `@ugc/test-utils/media` y
// SOLO los consume la suite `worker:media` (que corre en la imagen del worker, con ffmpeg disponible).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Clip de vídeo sintético. `color` produce un frame sólido (útil para muestrear píxeles y detectar
 * bandas de letterbox); sin `color` usa `testsrc2` (color bars con movimiento, útil para ver cortes/
 * glitches). Devuelve la ruta de salida.
 */
export async function makeTestVideo(opts: {
  out: string;
  width?: number;
  height?: number;
  fps?: number;
  seconds?: number;
  color?: string;
}): Promise<string> {
  const { out, width = 1080, height = 1920, fps = 30, seconds = 2, color } = opts;
  const size = `${String(width)}x${String(height)}`;
  const src = color
    ? `color=c=${color}:size=${size}:rate=${String(fps)}`
    : `testsrc2=size=${size}:rate=${String(fps)}`;
  await run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    src,
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    out,
  ]);
  return out;
}

/**
 * Tono puro; `delaySeconds` antepone silencio — clave para tests de ducking y sincronía, porque el onset
 * del audio queda en un instante EXACTO y conocido. Devuelve la ruta de salida.
 */
export async function makeTestAudio(opts: {
  out: string;
  seconds?: number;
  freq?: number;
  delaySeconds?: number;
}): Promise<string> {
  const { out, seconds = 2, freq = 440, delaySeconds = 0 } = opts;
  const filters =
    delaySeconds > 0 ? ['-af', `adelay=${String(Math.round(delaySeconds * 1000))}:all=1`] : [];
  await run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${String(freq)}:duration=${String(seconds)}`,
    ...filters,
    '-c:a',
    'aac',
    '-ar',
    '48000',
    out,
  ]);
  return out;
}

/**
 * Clip de vídeo CON voz EMBEBIDA (un tono como stand-in de la voz), muxeado en un solo contenedor .mp4 —
 * el caso VEED/voz nativa. Modela un clip de avatar del que hay que EXTRAER la pista de audio. No está en
 * la reference como helper con nombre, pero es la composición «makeTestVideo + makeTestAudio muxeados»
 * que la reference describe (§"Assets sintéticos") y que el test de extracción de voz necesita.
 */
export async function makeTestVideoWithVoice(opts: {
  out: string;
  width?: number;
  height?: number;
  fps?: number;
  seconds?: number;
  freq?: number;
  color?: string;
}): Promise<string> {
  const { out, width = 1920, height = 1080, fps = 25, seconds = 2, freq = 440, color } = opts;
  const size = `${String(width)}x${String(height)}`;
  const videoSrc = color
    ? `color=c=${color}:size=${size}:rate=${String(fps)}`
    : `testsrc2=size=${size}:rate=${String(fps)}`;
  await run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    videoSrc,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${String(freq)}:duration=${String(seconds)}`,
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-shortest',
    out,
  ]);
  return out;
}
