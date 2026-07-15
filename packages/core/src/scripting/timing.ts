// EL TIMING DURO (§7.2 N5, research/04 §3.2) — la mitad DETERMINISTA de N5, y la que NUNCA sale
// del LLM. Lógica pura: se testea sin gastar un céntimo y no puede derivar con el modelo.
//
// LA REGLA DURA DE T2.4: «prohibido pedirle al LLM un número que puedas calcular tú». El modelo
// emite TEXTO; los segundos, los instantes de inicio, los subtítulos y el `est_seconds` salen de
// aquí — de contar las palabras que el modelo REALMENTE escribió, no de lo que dice que duran.
import {
  countSpokenWords,
  secondsForText,
  type AdScene,
  type AdSubtitle,
  type AdSegment,
} from '../contracts';
import type { DurationPreset } from '../strategy/presets';

/** Una escena tal y como la EMITE el modelo: texto, sin tiempo (§9 del system prompt). */
export interface DraftScene {
  narration: string;
  visual: string;
  camera: string;
  emotion: string;
}

/**
 * FACTOR DE HOLGURA DE LA MIRA (T2.4, code-review). La MIRA del prompt va DELIBERADAMENTE POR
 * DEBAJO del techo del rango, no en el objetivo. Motivo medido: Sonnet 5 se pasa ~25% del
 * presupuesto de palabras que se le da, y además `est_seconds` sólo puede SUBIR respecto a
 * `wordCount ÷ 2,5` (el `ceil()` final y el suelo de 0,5 s/escena empujan hacia arriba, nunca
 * hacia abajo). Apuntar al objetivo (30 palabras / 12 s en hook_test) hacía aterrizar ~38 palabras
 * / 16 s → por encima del techo de 15 s, y un solo reintento no rescataba porque re-apuntaba al
 * MISMO número que causó el overshoot. Apuntando al 80% (~24 palabras / ~10 s), el mismo overshoot
 * del 25% aterriza ~30 palabras / ~12 s: cómodo bajo el techo. La ACEPTACIÓN sigue en `maxSeconds`
 * (`budgetViolation`): esto sólo mueve la MIRA, no el check.
 */
const PROMPT_AIM_FACTOR = 0.8;

/**
 * EL PRESUPUESTO DE PALABRAS QUE SE LE DA AL MODELO. Es la conversión de los segundos del preset
 * (§8.4 × §7.5) a la única unidad que el modelo SÍ controla: `segundos × 2,5 palabras/segundo`,
 * apretada por `PROMPT_AIM_FACTOR` para dejar holgura al overshoot conocido del modelo.
 *
 * Se redondea HACIA ABAJO (`floor`): este presupuesto es la MIRA, y redondear al alza le daría
 * permiso para escribir de más. Que el guion QUEPA se valida aparte, contra el techo del rango
 * (`budgetViolation` → `maxSeconds`, §8.4): la mira apunta BAJO el techo a propósito (ver
 * `PROMPT_AIM_FACTOR`), el techo acota la aceptación (T2.4).
 */
export function wordBudgetFor(preset: DurationPreset): Record<AdSegment, number> {
  const budget = (seconds: number): number => Math.floor(seconds * 2.5 * PROMPT_AIM_FACTOR);
  return {
    hook: budget(preset.segmentSeconds.hook),
    body: budget(preset.segmentSeconds.body),
    cta: budget(preset.segmentSeconds.cta),
  };
}

/**
 * Coloca las escenas en la timeline: calcula la DURACIÓN de cada una (`palabras ÷ 2,5`) y su
 * INSTANTE de inicio (la suma de las anteriores). Determinista y puro.
 *
 * SUELO DE 0,5 s POR ESCENA: una escena de 1 palabra daría 0,4 s de vídeo — no existe generador
 * que produzca un clip así, y `AdSceneSchema` exige `seconds > 0`. El suelo es el mínimo que N7
 * puede pedirle a un modelo de vídeo sin que el plan sea una ficción. Sube el total, y por eso el
 * validador de presupuesto (`fitsBudget`) mide DESPUÉS del suelo, no antes: si el suelo hiciera
 * pasarse del objetivo, es un guion que no cabe — y hay que reescribirlo, no maquillarlo.
 */
export const MIN_SCENE_SECONDS = 0.5;

export function computeSceneTiming(
  drafts: readonly (DraftScene & { segment: AdSegment })[],
): AdScene[] {
  const scenes: AdScene[] = [];
  let t = 0;
  for (const draft of drafts) {
    const seconds = Math.max(MIN_SCENE_SECONDS, secondsForText(draft.narration));
    scenes.push({
      t: Math.round(t * 100) / 100,
      seconds,
      segment: draft.segment,
      narration: draft.narration,
      visual: draft.visual,
      camera: draft.camera,
      emotion: draft.emotion,
    });
    t += seconds;
  }
  return scenes;
}

/**
 * Deriva los subtítulos de las escenas ya temporizadas (§7.2 N5 `subtitles[]`). Una línea por
 * escena: es el corte natural (una escena = un plano = una idea hablada) y hace los subtítulos
 * SINCRONIZABLES por construcción — su `start`/`end` son literalmente los de la escena, así que no
 * pueden desincronizarse de la voz que los dice.
 */
export function subtitlesFromScenes(scenes: readonly AdScene[]): AdSubtitle[] {
  return scenes.map((scene) => ({
    start: scene.t,
    end: Math.round((scene.t + scene.seconds) * 100) / 100,
    text: scene.narration,
  }));
}

/** Palabras habladas de todas las escenas (lo que se cuenta para `word_count`). */
export function totalWords(scenes: readonly AdScene[]): number {
  return scenes.reduce((sum, scene) => sum + countSpokenWords(scene.narration), 0);
}

/** `est_seconds` de §12: la duración del guion, redondeada AL ALZA (un anuncio no se corta a media
 *  palabra; el redondeo a la baja mentiría a favor nuestro justo en la cláusula que se verifica). */
export function estSecondsOf(scenes: readonly AdScene[]): number {
  const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  return Math.ceil(total);
}

/** El texto hablado completo, en orden. Es lo que se persiste en `ad_script.full_text`. */
export function fullTextOf(scenes: readonly AdScene[]): string {
  return scenes.map((scene) => scene.narration).join(' ');
}

/** Palabras habladas de las escenas de UN segmento (para el mensaje de feedback del reintento). */
export function wordsInSegment(scenes: readonly AdScene[], segment: AdSegment): number {
  return totalWords(scenes.filter((scene) => scene.segment === segment));
}
