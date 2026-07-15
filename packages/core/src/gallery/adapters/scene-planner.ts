// EL PLANNER DE ESCENAS §7.5 (T3.6). Función PURA, determinista y gratuita: dado un guion
// (`AdScene[]`) y la `maxDuration` del `ModelProfile` que va a generar el clip, devuelve el PLAN
// de clips — el "plan de generación" de la Verificación de T3.6. NO persiste, NO es un run de N7,
// NO llama a red ni a BD. Su valor de retorno ES el plan.
//
// LA REGLA §7.5 (PRD l.286-296): «1 generación de vídeo por escena, con duración objetivo ≤
// maxDuration del ModelProfile (escenas más largas se parten en 2 clips)». La prosa dice "2
// clips" porque describe el caso REAL del catálogo sembrado: ninguna escena de un preset (§8.4,
// máx. storytelling 60s repartido en escenas) excede 2×maxDuration para los avatares sembrados
// (OmniHuman maxDuration 30 → 2×30 = 60s). PERO la regla PRIMARIA de §7.5 es la invariante «cada
// clip ≤ maxDuration», y un tope duro de 2 clips la VIOLARÍA para una escena > 2×maxDuration
// (una escena de 65s en 2 clips daría 32,5s > 30). Por eso el troceo es `ceil(seconds /
// maxDuration)` con reparto uniforme: honra la invariante ≤maxDuration Y produce EXACTAMENTE 2
// clips para todo lo que el catálogo sembrado puede generar (l.286 "2 clips" es el caso
// ≤2×maxDuration). El unit test lo fija con una escena que exige 3 clips (maxDuration sintética
// pequeña), como manda testing/references/unit-core.md §8.
import type { AdScene } from '../../contracts/ad-script';

/** Un clip planificado para una escena: su ventana temporal [t, t+seconds) DENTRO del anuncio y su
 *  índice dentro de la escena (0-based). `seconds` es la duración del clip, ya ≤ maxDuration. */
export interface PlannedClip {
  /** Instante de inicio del clip en segundos desde t=0 del anuncio. */
  t: number;
  /** Duración del clip en segundos (≤ maxDuration del profile). */
  seconds: number;
  segment: AdScene['segment'];
  /** Índice del clip DENTRO de su escena (0-based): 0 para el único clip, 0..n-1 si se troceó. */
  clipIndex: number;
  /** Número total de clips en que se troceó la escena (1 si no se partió). */
  clipCount: number;
}

/** El plan de una escena: sus clips (1 si cabe en maxDuration, ≥2 si se troceó). */
export interface ScenePlan {
  scene: AdScene;
  clips: PlannedClip[];
}

/** El plan de un guion completo: un `ScenePlan` por escena, en orden. */
export interface GenerationPlan {
  scenes: ScenePlan[];
  /** Todos los clips del plan, aplanados y en orden temporal (lo que N7 encolará). */
  clips: PlannedClip[];
}

/**
 * Trocea UNA escena en clips ≤ `maxDuration`, repartiendo la duración UNIFORMEMENTE. Nunca lanza.
 *
 * Aritmética §7.5:
 *   - escena ≤ maxDuration → 1 clip (sin trocear);
 *   - escena > maxDuration → `ceil(seconds / maxDuration)` clips de igual duración que suman
 *     `seconds` (reparto uniforme: cada clip = seconds / count ≤ maxDuration). El reparto uniforme
 *     (no "llenar maxDuration y dejar el resto") mantiene los clips equilibrados, que es lo que N8
 *     luego recorta a la narración; y garantiza la invariante ≤maxDuration para CUALQUIER escena.
 *
 * Si `maxDuration` no está definida en el profile, la escena NO se trocea (el modelo no declara
 * tope): 1 clip con la duración completa.
 */
export function planScene(scene: AdScene, maxDuration: number | undefined): ScenePlan {
  const count =
    maxDuration === undefined || scene.seconds <= maxDuration
      ? 1
      : Math.ceil(scene.seconds / maxDuration);

  const clipSeconds = scene.seconds / count;
  const clips: PlannedClip[] = Array.from({ length: count }, (_unused, clipIndex) => ({
    t: scene.t + clipIndex * clipSeconds,
    seconds: clipSeconds,
    segment: scene.segment,
    clipIndex,
    clipCount: count,
  }));

  return { scene, clips };
}

/**
 * Planifica un guion completo contra la `maxDuration` de un profile. NO lanza: una escena que
 * excede maxDuration se TROCEA en el plan (§7.5), jamás produce un error en runtime.
 */
export function planGeneration(
  scenes: readonly AdScene[],
  maxDuration: number | undefined,
): GenerationPlan {
  const scenePlans = scenes.map((scene) => planScene(scene, maxDuration));
  return {
    scenes: scenePlans,
    clips: scenePlans.flatMap((sp) => sp.clips),
  };
}
