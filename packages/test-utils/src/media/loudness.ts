// Mediciones de LOUDNESS y RMS con ffmpeg (testing/references/media-composition.md §"Loudness y ducking
// (T5.3)"): `measureIntegratedLufs` (ebur128) y `measureRmsDb` (astats sobre una ventana). Son la
// verificación HONESTA de la mezcla de audio de T5.3 — el loudness integrado del máster a -14 LUFS y la
// caída del bed durante la voz (ducking). Exportados como `@ugc/test-utils/media`; SOLO los consume la
// suite `worker:media` (corre en la imagen del worker, con ffmpeg).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Mide el LOUDNESS INTEGRADO (LUFS) de un fichero con `ffmpeg -af ebur128`. ebur128 escribe su resumen a
 * stderr; se parsea el ÚLTIMO `I: … LUFS` (el bloque Summary final). LANZA si no hay resumen. El máster de
 * T5.3 debe medir -14 LUFS ±1.
 */
export async function measureIntegratedLufs(file: string): Promise<number> {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner',
    '-i',
    file,
    '-af',
    'ebur128',
    '-f',
    'null',
    '-',
  ]);
  const matches = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)];
  const last = matches.at(-1);
  if (last === undefined) throw new Error(`ebur128 sin summary para ${file}`);
  return Number(last[1]);
}

/**
 * Mide el RMS (dB) de una VENTANA temporal `[from, to]` de un fichero: recorta con `-ss/-to`, pasa
 * `-af astats -f null -` y parsea el `RMS level dB` de la sección Overall del stderr. Sirve para el test de
 * ducking: RMS del bed ANTES vs DURANTE la voz → la caída (before − during) debe ser ≥6 dB. LANZA si no
 * encuentra el valor.
 */
export async function measureRmsDb(file: string, from: number, to: number): Promise<number> {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner',
    '-ss',
    String(from),
    '-to',
    String(to),
    '-i',
    file,
    '-af',
    'astats',
    '-f',
    'null',
    '-',
  ]);
  // `astats` imprime valores por canal y un bloque Overall; el último `RMS level dB` es el Overall.
  const matches = [...stderr.matchAll(/RMS level dB:\s+(-?\d+(?:\.\d+)?|-?inf)/g)];
  const last = matches.at(-1);
  if (last === undefined) throw new Error(`astats sin RMS level para ${file}`);
  const raw = last[1];
  return raw === '-inf' || raw === 'inf' ? Number.NEGATIVE_INFINITY : Number(raw);
}
