// LOS PRESETS DE DURACIÓN (§8.4) Y SU PRESUPUESTO TEMPORAL (§7.5) — la tabla que conecta el
// OBJETIVO del lote con los SEGUNDOS de cada segmento del anuncio.
//
// §8.4 da la horquilla de duración por objetivo (hook testing 8–15 s · conversión 21–34 s ·
// storytelling 35–60 s, cap duro de export 60 s) y §7.5 la reparte en segmentos
// (hook/body/cta) con sus clips. Aquí se fija UN punto de esa horquilla —la duración
// OBJETIVO del preset— y el reparto de sus segundos entre los tres segmentos.
//
// Por qué un punto y no un rango: `ad_variant.duration_target` es un `integer` (§12) y el
// guion de N5 tiene timing duro (`word_count ÷ 2,5 = segundos`): el ScriptWriter necesita un
// número al que escribir, no un intervalo. La horquilla de §8.4 sigue siendo la tolerancia de
// QA (N9), no el input del guionista.
//
// LOS NÚMEROS, uno a uno (todos dentro de su horquilla de §8.4 y con el reparto de §7.5):
//
//   hook_test  → 12 s  (§8.4: 8–15 s). §7.5: hook 3–5 + body 4–7 + cta 2–3 → 4 + 6 + 2 = 12.
//   conversion → 30 s  (§8.4: 21–34 s). §7.5: hook 8–12 + body 10–16 + cta 3–6 → 10 + 16 + 4 = 30.
//                LOS 30 s SON EL ANCLA DEL ESTIMADOR: el «COGS 30 s» del Apéndice B mide
//                exactamente este anuncio (research/01 §6.2 escenario B: «hook avatar 12 s +
//                b-roll 18 s» = 30 s de vídeo generado, $1,80 → el suelo del tier Standard).
//                Que el preset de conversión valga 30 s no es coincidencia: es POR QUÉ el
//                Apéndice B tabula a 30 s.
//   story      → 45 s  (§8.4: 35–60 s). §7.5: hook 8–12 + body 20–40 + cta 4–6 → 10 + 30 + 5 = 45.
//
// El cap duro de export de §8.4 (60 s) lo respetan los tres por construcción.
import type { AdObjective } from '../library/contracts';
import type { AdSegment } from '../contracts/batch-plan';

/** El ancla del Apéndice B: la receta tabula el COGS de un anuncio de ESTOS segundos.
 *  Es la única constante que conecta `recipe.est_cost_30s_*_cents` con una duración. */
export const RECIPE_ANCHOR_SECONDS = 30;

/** Cap duro de export (§8.4). Ningún preset puede pasarse de aquí. */
export const MAX_EXPORT_SECONDS = 60;

/** El presupuesto temporal de un preset: segundos por segmento (§7.5). */
export interface DurationPreset {
  /**
   * Duración OBJETIVO del anuncio (la suma de sus segmentos): el PUNTO DE MIRA al que apunta el
   * prompt del ScriptWriter, no un límite duro. §8.4 da a cada objetivo un RANGO (hook-test 8–15 s),
   * y este es el centro de ese rango. Un guion se acepta si cae dentro del rango, no si clava el
   * objetivo — ver `maxSeconds`.
   */
  readonly targetSeconds: number;
  /**
   * Techo de §8.4: el extremo SUPERIOR del rango válido del objetivo (hook-test 15, conversión 34,
   * storytelling 60). Es lo que hace cumplir `budgetViolation`, NO `targetSeconds`. Motivo (T2.4):
   * el presupuesto de palabras de hook_test da 12,0 s EXACTOS con cero margen (`ceil()` + suelos de
   * 0,5 s/escena solo empujan hacia arriba), así que rechazar contra el objetivo tira guiones de
   * 13 s que §8.4 declara perfectamente embarcables. El objetivo guía; el techo acota.
   */
  readonly maxSeconds: number;
  /** Segundos de cada segmento (§7.5: hook + body + cta). */
  readonly segmentSeconds: Readonly<Record<AdSegment, number>>;
  /**
   * Nº MÁXIMO de escenas de `body` (§7.5, columna «Clips generados»). NO es cosmético: en §7.5 el
   * body es **1 clip b-roll en hook_test**, 2 en conversión y 3–5 en storytelling, y cada escena
   * del guion se materializa en UNA generación de vídeo (N7d: «1 generación por escena»). Un body
   * de 2 escenas en hook_test viola §7.5 Y además infla el guion —cada escena arrastra su propia
   * narración—, que fue la causa raíz del overshoot de duración de T2.4: el modelo emitía 2 escenas
   * de body (~13 palabras cada una) y el anuncio se iba a 15–16 s pegado al techo. Acotarlo a 1
   * escena hace CUMPLIR §7.5 y disuelve el inflado de raíz. `hook` y `cta` son siempre 1 escena
   * (un avatar hablando; un product shot / end-card), así que solo el body necesita el parámetro.
   */
  readonly maxBodyScenes: number;
}

/** La tabla §8.4 × §7.5, indexada por el objetivo del lote (`ad_batch.objective`). */
export const DURATION_PRESETS: Readonly<Record<AdObjective, DurationPreset>> = {
  hook_test: {
    targetSeconds: 12,
    maxSeconds: 15,
    segmentSeconds: { hook: 4, body: 6, cta: 2 },
    maxBodyScenes: 1, // §7.5: «body 4–7 s (1 clip b-roll)».
  },
  conversion: {
    targetSeconds: 30,
    maxSeconds: 34,
    segmentSeconds: { hook: 10, body: 16, cta: 4 },
    maxBodyScenes: 2, // §7.5: «body 10–16 s (2 clips b-roll)».
  },
  story: {
    targetSeconds: 45,
    maxSeconds: 60,
    segmentSeconds: { hook: 10, body: 30, cta: 5 },
    maxBodyScenes: 5, // §7.5: «body 20–40 s (3–5 clips)».
  },
};
