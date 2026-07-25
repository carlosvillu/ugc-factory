// CONCAT INTRA-ESCENA de los clips de una escena troceada (T5.8c, §7.5). La pieza que faltaba entre los
// clips CRUDOS de N7 y el fitter (T5.5b):
//   · §7.5 parte una escena cuya narración excede el `maxDuration` del modelo en `ceil(seconds/maxDuration)`
//     clips, y N7d/N7f los generan Y LOS PAGAN TODOS.
//   · Pero la composición usaba SOLO el `clipIndex 0` (`pickClip`, `reduce(clipIndex≤)`) y descartaba el
//     resto → (a) fuga de dinero (se paga N, se usa 1) y (b) un único clip topado a `maxDuration` NO cubre
//     la narración de la escena → `fitSegmentFile` lanza `FitError` (correctamente: anti-T1.8) y N8 no
//     compone ningún máster. Ese fue el fallo del run real de T5.9.
//
// ORDEN EN LA CADENA (compose-variant.ts, executor N8):
//     clips CRUDOS de N7 → [concatSceneClipsFile SI hay >1] → fitSegmentFile → normalize (T5.2) → composeMaster
// El concat va ANTES del fitter A PROPÓSITO: así el vídeo de la escena es Σ(clips) ≥ narración y el fitter
// RECORTA (rama `trim`) en vez de lanzar. El umbral de 0,5 s del fitter NO se toca: si Σ(clips) sigue sin
// cubrir la narración por un desajuste REAL, `FitError` sigue mordiendo (control negativo de T5.8c).
//
// POR QUÉ EL CONCAT FILTER Y NO EL DEMUXER `-c copy` DE T5.3. `buildConcatArgs` (compose-master) está hecho
// para segmentos YA NORMALIZADOS por T5.2 (mismo perfil/timebase/SAR) y va con `-c copy -an`. Aquí los
// inputs son clips CRUDOS de fal, PRE-normalize: nada garantiza que compartan timebase/SAR/parámetros de
// stream, y un `-c copy` sobre inputs no uniformes produce un fichero con glitches o directamente inválido.
// El filtro `concat` re-encoda (mismo perfil casi-lossless que `buildFitArgs`: H.264 CRF 18 veryfast, un
// INTERMEDIO que T5.2 vuelve a encodar al perfil canónico) y absorbe la heterogeneidad.
//
// AUDIO: `-an`. Los ÚNICOS clips que se trocean son los de N7d (b-roll) y N7f (CTA), y ambos son
// SILENCIOSOS por contrato (su voz es la de N7b, que se mezcla aparte). El clip de N7c (avatar), el único
// que lleva voz EMBEBIDA (rama `embedded-voice` de T5.2), es SIEMPRE un único clip del hook → NUNCA pasa
// por aquí. El caller respeta esto: un segmento de 1 solo clip no entra en esta ruta, se mantiene
// byte-idéntico al camino anterior a T5.8c.
import type { Logger } from '@ugc/core';

import { defaultFfmpegRunner, tailStderr, type FfmpegRunner } from './extract-audio-track';
import { INTERMEDIATE_ENCODE_ARGS } from './fit-segment';
import { NOOP_LOGGER } from './noop-logger';

/**
 * La concatenación intra-escena de los clips de una escena troceada falló: ffmpeg salió con código ≠0, el
 * binario no está, o algún input no es decodificable. Clase PROPIA (anti-T1.8, hermana de `FitError`/
 * `NormalizeError`/`ComposeError`): «no se pudieron unir los clips de la escena» ≠ «no se pudo cuadrar a la
 * narración» ≠ «storage falló».
 */
export class SceneConcatError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(message: string, opts: { exitCode: number | null; stderr: string }) {
    super(message);
    this.name = 'SceneConcatError';
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
  }
}

/**
 * Los ARGS del CONCAT FILTER de los clips de UNA escena (builder PURO, testeable en el gate sin ffmpeg).
 *
 * `-i c0 -i c1 … -filter_complex "[0:v][1:v]…concat=n=<N>:v=1:a=0[v] " -map "[v]" -an <encode> out`
 *
 *   · `concat=n=N:v=1:a=0` une SOLO vídeo (`a=0`) — ver la nota de AUDIO de la cabecera.
 *   · El orden de los inputs ES el orden temporal: el caller pasa los paths ya ordenados por `clipIndex`.
 *   · Re-encode con `INTERMEDIATE_ENCODE_ARGS`: la constante COMPARTIDA con `buildFitArgs` (una sola
 *     verdad del perfil de los intermedios — dos tuplas escritas a mano podrían divergir y meter un cambio
 *     de perfil silencioso entre etapas de la cadena).
 *   · NO se fija resolución/fps/SAR aquí: eso es de T5.2 (normalize), que corre DESPUÉS. Este paso solo debe
 *     la UNIÓN. (El filtro `concat` exige que los inputs compartan resolución; los clips de una MISMA escena
 *     salen del mismo endpoint con el mismo `aspect`/`resolution`, así que la comparten por construcción —
 *     si no, ffmpeg falla RUIDOSO y sale un `SceneConcatError`, que es el surface honesto.)
 *
 * LANZA si se le pasan menos de 2 inputs: un segmento de un solo clip NO debe pasar por el concat (el caller
 * lo corta antes) — un uso indebido rompe ruidosamente en vez de emitir un comando degenerado.
 */
export function buildSceneConcatArgs(opts: {
  inPaths: readonly string[];
  outPath: string;
}): string[] {
  const { inPaths, outPath } = opts;
  if (inPaths.length < 2) {
    throw new SceneConcatError(
      `buildSceneConcatArgs: el concat intra-escena exige ≥2 clips (recibió ${String(inPaths.length)}) — ` +
        'un segmento de un solo clip no pasa por aquí',
      { exitCode: null, stderr: '' },
    );
  }
  const inputs = inPaths.flatMap((p) => ['-i', p]);
  const chain = inPaths.map((_unused, i) => `[${String(i)}:v]`).join('');
  const filter = `${chain}concat=n=${String(inPaths.length)}:v=1:a=0[v]`;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-an',
    ...INTERMEDIATE_ENCODE_ARGS,
    '-y',
    outPath,
  ];
}

export interface ConcatSceneClipsDeps {
  /** Runner de ffmpeg INYECTABLE (default: subproceso real). */
  runner?: FfmpegRunner;
  logger?: Logger;
}

export interface ConcatSceneClipsOptions {
  /** Rutas LOCALES de los clips de la escena, YA ORDENADAS por `clipIndex` (orden temporal §7.5). */
  readonly inPaths: readonly string[];
  /** Ruta LOCAL de salida del vídeo de la escena completa. */
  readonly outPath: string;
}

/**
 * Une los clips de UNA escena troceada en un único vídeo de escena (file-in/file-out, paths locales, runner
 * INYECTABLE — patrón T5.2/T5.3/T5.5b). LANZA `SceneConcatError` si ffmpeg falla. NO toca storage ni la BD.
 */
export async function concatSceneClipsFile(
  deps: ConcatSceneClipsDeps,
  opts: ConcatSceneClipsOptions,
): Promise<void> {
  const log = deps.logger ?? NOOP_LOGGER;
  const runner = deps.runner ?? defaultFfmpegRunner;

  const args = buildSceneConcatArgs({ inPaths: opts.inPaths, outPath: opts.outPath });
  const result = await runner(args);
  if (result.code !== 0) {
    throw new SceneConcatError(
      `concatSceneClipsFile: ffmpeg salió con código ${String(result.code)} concatenando ` +
        `${String(opts.inPaths.length)} clips de la escena en ${opts.outPath}`,
      { exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }

  log.info(
    {
      event: 'scene_clips_concatenated',
      clipCount: opts.inPaths.length,
      outPath: opts.outPath,
    },
    'clips de la escena troceada concatenados antes del fitter (§7.5)',
  );
}
