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
  /** Duración objetivo del anuncio: la suma de sus segmentos. */
  readonly targetSeconds: number;
  /** Segundos de cada segmento (§7.5: hook + body + cta). */
  readonly segmentSeconds: Readonly<Record<AdSegment, number>>;
}

/** La tabla §8.4 × §7.5, indexada por el objetivo del lote (`ad_batch.objective`). */
export const DURATION_PRESETS: Readonly<Record<AdObjective, DurationPreset>> = {
  hook_test: {
    targetSeconds: 12,
    segmentSeconds: { hook: 4, body: 6, cta: 2 },
  },
  conversion: {
    targetSeconds: 30,
    segmentSeconds: { hook: 10, body: 16, cta: 4 },
  },
  story: {
    targetSeconds: 45,
    segmentSeconds: { hook: 10, body: 30, cta: 5 },
  },
};
