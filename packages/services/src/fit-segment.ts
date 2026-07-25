// SEGMENT FITTER — recorte a la narración + hold del último frame (T5.5b, §9.7 N8 l.288). La pieza que
// falta HOY entre los clips crudos de N7 y el concat de T5.3:
//   · Los clips de vídeo de N7 (avatar/b-roll) salen a duraciones CUANTIZADAS al enum del modelo (§7.5:
//     p.ej. 4s/6s/8s), pero la narración de esa escena dura lo que dure (p.ej. 3,4s).
//   · T5.3 (concat `-c copy`) ASUME segmentos ya cuadrados a su narración; T5.2 (normalize) hace perfil/
//     espacial, NO duración. Nadie recorta a la narración hoy → esta pieza es NUEVA.
//
// El fitter cuadra CADA clip a SU narración ANTES de que T5.2 lo normalice y T5.3 lo concatene. Dos casos
// (§9.7 l.288):
//   1. CLIP MÁS LARGO que la narración (el caso normal): recorta al FINAL con `-t <narración>` (nunca
//      `-ss`, que cortaría el ARRANQUE). Re-encode (NO `-c copy`): `-t` con `-c copy` corta en el keyframe
//      más cercano → duración IMPRECISA; el contrato de esta pieza es la duración EXACTA de la narración,
//      así que se re-encoda (el perfil canónico lo clava T5.2 DESPUÉS; aquí solo se debe la duración).
//   2. CLIP MÁS CORTO que la narración, DÉFICIT <0,5 s: hold del último frame con
//      `tpad=stop_mode=clone:stop_duration=<déficit>` (clona el ÚLTIMO frame para rellenar). SOLO si el
//      déficit es <0,5 s. Si es ≥0,5 s → es un desajuste GROSERO de generación (el clip debería cubrir la
//      narración) → LANZA `FitError` (no lo tapa: taparlo escondería un bug de N7/planificación, anti-
//      principio-9). El déficit se calcula sobre la duración MEDIDA del clip (ffprobe), no la nominal.
//
// PATRÓN T5.2/T5.3: builder PURO de args (`buildFitArgs`) + wrapper file-in/file-out (`fitSegmentFile`)
// con runner+ffprobe INYECTABLES (default: subproceso real). La ARITMÉTICA de la decisión (trim vs hold vs
// error) vive en `planFit`, función PURA — el gate la ejerce sin ffmpeg (boundary del umbral + que el
// throw MUERDE). CLASE DE ERROR PROPIA (`FitError`, anti-T1.8): distinta de NormalizeError/ComposeError.
//
// AUDIO: el fitter NO descarta el audio (`-an` ausente a propósito). Un clip VEED de avatar lleva la voz
// EMBEBIDA que T5.2 extrae aguas abajo (rama `embedded-voice`); recortarla junto al vídeo la mantiene
// alineada, y para un b-roll silencioso preservar «sin audio» es inocuo. `tpad` extiende el vídeo; el
// audio, si acaba antes, deja una cola de silencio (correcta para un hold del último frame).
import type { Logger } from '@ugc/core';

import {
  defaultFfmpegRunner,
  defaultFfprobeRunner,
  tailStderr,
  type FfmpegRunner,
  type FfprobeRunner,
} from './extract-audio-track';
import { NOOP_LOGGER } from './noop-logger';

/**
 * El recorte/hold del clip a la narración falló: ffmpeg salió con código ≠0, el binario no está, el input
 * no es decodificable, o el clip es MÁS CORTO que la narración por un margen GROSERO (déficit ≥0,5 s → un
 * desajuste de generación que NO se tapa con un hold largo). Clase PROPIA (anti-T1.8, hermana de
 * `NormalizeError`/`ComposeError`): «no se pudo cuadrar el segmento a su narración» ≠ «storage falló» ≠
 * «el probe falló» ≠ «fal devolvió mal». `exitCode`+`stderr` de ffmpeg (o `null`+mensaje si el fallo es la
 * validación del déficit, ANTES de correr ffmpeg).
 */
export class FitError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(message: string, opts: { exitCode: number | null; stderr: string }) {
    super(message);
    this.name = 'FitError';
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
  }
}

/**
 * El DÉFICIT MÁXIMO tolerado cuando el clip es más corto que la narración: por debajo de este umbral se
 * rellena con hold del último frame; a partir de él (inclusive) es un desajuste GROSERO de generación y se
 * LANZA (§9.7 l.288: «rellena con hold del último frame si falta <0,5 s»). Segundos. EXPORTADO para que el
 * unit test del gate ejerza el boundary (0,49 → hold; 0,50 → error) sin ffmpeg.
 */
export const MAX_HOLD_DEFICIT_S = 0.5;

/**
 * EL PERFIL DE ENCODE DE LOS INTERMEDIOS de la cadena de render (T5.8c). Lo comparten las etapas que
 * producen un fichero que T5.2 (normalize) vuelve a encodar al perfil canónico: el fitter (`buildFitArgs`) y
 * el concat intra-escena (`buildSceneConcatArgs`). Hermano de `CANONICAL_VIDEO_PROFILE`/
 * `EXPORT_MASTER_PRESET`, pero para lo que NO es un entregable.
 *
 *   · `-preset veryfast`: el output es un INTERMEDIO, así que la eficiencia de bitrate que compraría un
 *     preset lento se descarta — se elige velocidad (medium sería 5–8× más lento por clip×variante sin
 *     ganancia final).
 *   · `-crf 18` (casi-lossless) SÍ importa: da a T5.2 una fuente limpia y evita compresión compuesta
 *     CRF-sobre-CRF en una cadena que ya encadena dos (o tres, con el concat) encodes.
 *   · `yuv420p`: compatible con el concat `-c copy` de T5.3 y con lo que T5.2 normalizará después.
 *
 * NO fija resolución/fps/SAR: eso es de T5.2 (normalize), que corre DESPUÉS. Una CONSTANTE COMPARTIDA (y no
 * dos tuplas escritas a mano) es lo que hace VERDAD el «mismo perfil que el fitter» que documenta el concat:
 * si divergieran, la cadena metería un cambio de perfil silencioso entre etapas.
 */
export const INTERMEDIATE_ENCODE_ARGS: readonly string[] = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
];

/** El PLAN de fitting decidido a partir de las duraciones — el resultado PURO de `planFit`, que la capa de
 *  ffmpeg (o el test) traduce a args. Un discriminated union: `trim` (clip ≥ narración → recorta al final),
 *  `hold` (clip < narración, déficit <0,5 s → holdea el último frame), `error` (déficit ≥0,5 s → grosero). */
export type FitPlan =
  | { readonly kind: 'trim'; readonly targetS: number }
  | { readonly kind: 'hold'; readonly deficitS: number; readonly targetS: number }
  | { readonly kind: 'error'; readonly deficitS: number };

/**
 * DECIDE el plan de fitting a partir de la duración MEDIDA del clip y la de la narración. Función PURA (sin
 * ffmpeg, sin I/O): el corazón de la lógica, testeable en el gate sobre el boundary del umbral y el throw.
 *   · clip ≥ narración → `trim` a la narración (recorte al final).
 *   · clip < narración, déficit <0,5 s → `hold` del último frame por el déficit.
 *   · clip < narración, déficit ≥0,5 s → `error` (desajuste grosero, NO se tapa).
 * El `targetS` siempre es la duración de la narración: es la longitud EXACTA que el segmento debe tener a
 * la salida (recortada o rellenada). El `deficitS` = narración − clip (positivo en hold/error).
 */
export function planFit(args: { clipDurationS: number; narrationDurationS: number }): FitPlan {
  const { clipDurationS, narrationDurationS } = args;
  if (clipDurationS >= narrationDurationS) {
    return { kind: 'trim', targetS: narrationDurationS };
  }
  const deficitS = narrationDurationS - clipDurationS;
  if (deficitS < MAX_HOLD_DEFICIT_S) {
    return { kind: 'hold', deficitS, targetS: narrationDurationS };
  }
  return { kind: 'error', deficitS };
}

/**
 * Los ARGS de ffmpeg del fitting, dado un `plan` ya decidido (`trim` o `hold`). Builder PURO exportado para
 * el unit test del gate. El plan `error` NO tiene args (lo intercepta el wrapper antes de llamar aquí) — se
 * lanza para que un uso indebido rompa ruidosamente en vez de emitir un comando silenciosamente inválido.
 *
 *   · `trim`  → `-i <in> -t <target> -c:v libx264 … <out>`: recorta al FINAL a la duración de la narración.
 *     `-t` va como opción de SALIDA (tras `-i`), nunca `-ss` (que cortaría el arranque). Re-encode (NO
 *     `-c copy`) para un corte EXACTO a la narración (un `-c copy` cortaría en el keyframe más cercano).
 *   · `hold`  → `-i <in> -vf tpad=stop_mode=clone:stop_duration=<déficit> -t <target> …`: clona el ÚLTIMO
 *     frame para rellenar el déficit. `tpad` es un filtro → re-encode obligado. El `-t <target>` acota la
 *     salida EXACTA a la narración (tpad por sí solo puede sobre-extender por redondeo del framerate).
 *
 * Perfil de re-encode: `INTERMEDIATE_ENCODE_ARGS` (la constante COMPARTIDA con el concat intra-escena de
 * T5.8c — ver su docblock para el porqué de cada flag). Este paso solo debe la DURACIÓN.
 *
 * El param `plan` se estrecha a `trim`/`hold` (excluye `error`): el estado inválido lo prohíbe el TIPO, no
 * una rama-throw en runtime. El caller (`fitSegmentFile`) intercepta `error` ANTES de llegar aquí.
 */
export function buildFitArgs(opts: {
  inPath: string;
  outPath: string;
  plan: Extract<FitPlan, { kind: 'trim' | 'hold' }>;
}): string[] {
  const { inPath, outPath, plan } = opts;
  const head = ['-hide_banner', '-loglevel', 'error', '-i', inPath];
  const filter =
    plan.kind === 'hold'
      ? ['-vf', `tpad=stop_mode=clone:stop_duration=${plan.deficitS.toFixed(3)}`]
      : [];
  const encode = ['-t', plan.targetS.toFixed(3), ...INTERMEDIATE_ENCODE_ARGS, '-y', outPath];
  return [...head, ...filter, ...encode];
}

export interface FitSegmentDeps {
  /** Runner de ffmpeg INYECTABLE (default: subproceso real). El unit test del gate inyecta uno que CUENTA
   *  invocaciones (para probar que el plan `error` NO llega a ffmpeg). */
  runner?: FfmpegRunner;
  /** Runner de ffprobe INYECTABLE (default: subproceso real). Mide la duración REAL del clip para el déficit. */
  ffprobe?: FfprobeRunner;
  logger?: Logger;
}

export interface FitSegmentOptions {
  /** Ruta LOCAL del clip crudo de N7 (paths-only: storage es puro streams; el caller materializa antes). */
  readonly inPath: string;
  /** Ruta LOCAL de salida del segmento cuadrado a su narración. */
  readonly outPath: string;
  /** La duración EXACTA de la narración de esta escena (segundos): a esto se cuadra el clip. */
  readonly narrationDurationS: number;
}

export interface FitSegmentResult {
  /** La ruta del segmento cuadrado (= `outPath`). */
  readonly outPath: string;
  /** El plan aplicado (`trim`/`hold`) — útil para el logging/diagnóstico del caller. */
  readonly plan: Extract<FitPlan, { kind: 'trim' | 'hold' }>;
}

/**
 * Cuadra un clip de vídeo a la duración EXACTA de su narración (§9.7 l.288). File-in/file-out (paths
 * locales), runner+ffprobe INYECTABLES. Pasos:
 *   1. MIDE la duración real del clip con ffprobe (el déficit se calcula sobre la duración MEDIDA, no la
 *      nominal — un clip «de 3,2 s» puede medir 3,18/3,23).
 *   2. `planFit(medida, narración)` decide trim/hold/error.
 *   3. Si `error` (déficit ≥0,5 s) → LANZA `FitError` ANTES de correr ffmpeg (no tapa el desajuste; el
 *      runner NUNCA se invoca en este caso).
 *   4. Corre ffmpeg con `buildFitArgs(plan)`; LANZA `FitError` si el exit ≠0.
 * NO toca storage ni la BD (módulo reutilizable, no executor; el wiring lo hace T5.5d).
 */
export async function fitSegmentFile(
  deps: FitSegmentDeps,
  opts: FitSegmentOptions,
): Promise<FitSegmentResult> {
  const log = deps.logger ?? NOOP_LOGGER;
  const runner = deps.runner ?? defaultFfmpegRunner;
  const ffprobe = deps.ffprobe ?? defaultFfprobeRunner;

  // 1. Medir la duración REAL del clip con ffprobe (el déficit se calcula sobre la medida).
  const clipDurationS = await probeDurationSeconds(ffprobe, opts.inPath);

  // 2. Decidir el plan (PURO).
  const plan = planFit({ clipDurationS, narrationDurationS: opts.narrationDurationS });

  // 3. Déficit GROSERO (≥0,5 s) → lanzar ANTES de ffmpeg. El runner no se invoca (control negativo del
  //    principio 9: un desajuste de N7 se destapa, no se tapa con un hold largo).
  if (plan.kind === 'error') {
    throw new FitError(
      `fitSegmentFile: el clip ${opts.inPath} (${clipDurationS.toFixed(3)}s) es más corto que su narración ` +
        `(${opts.narrationDurationS.toFixed(3)}s) por ${plan.deficitS.toFixed(3)}s ≥ ${String(MAX_HOLD_DEFICIT_S)}s ` +
        `— desajuste de generación, no se rellena con hold`,
      { exitCode: null, stderr: '' },
    );
  }

  // 4. Correr ffmpeg (trim o hold).
  const result = await runner(buildFitArgs({ inPath: opts.inPath, outPath: opts.outPath, plan }));
  if (result.code !== 0) {
    throw new FitError(
      `fitSegmentFile: ffmpeg salió con código ${String(result.code)} cuadrando ${opts.inPath} (plan ${plan.kind})`,
      { exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }

  log.info(
    {
      event: 'segment_fitted',
      inPath: opts.inPath,
      plan: plan.kind,
      clipDurationS,
      narrationDurationS: opts.narrationDurationS,
    },
    'segmento cuadrado a la duración de su narración',
  );
  return { outPath: opts.outPath, plan };
}

/** Mide la duración (segundos) de un fichero LOCAL con ffprobe. LANZA `FitError` si ffprobe falla o su
 *  salida no es un número finito positivo. Mismo patrón que `probeDurationSeconds` de `compose-master` (la
 *  deuda journaleada del kernel `probeLocalDurationSeconds` compartido queda FUERA de alcance: aquí se
 *  replica el patrón mínimo, no se extrae el helper). */
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
    throw new FitError(
      `fitSegmentFile: ffprobe falló midiendo la duración de ${path} (código ${String(result.code)})`,
      { exitCode: result.code, stderr: tailStderr(result.stderr) },
    );
  }
  const seconds = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new FitError(
      `fitSegmentFile: ffprobe no devolvió una duración válida para ${path} (stdout: ${JSON.stringify(result.stdout.trim())})`,
      { exitCode: 0, stderr: tailStderr(result.stderr) },
    );
  }
  return seconds;
}
