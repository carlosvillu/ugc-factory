// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL ESTIMADOR DE COSTE DEL LOTE (N4, §7.2 — «Preview del coste total estimado», CP2)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// ── LA DECISIÓN CENTRAL: CÓMO ESCALA EL COSTE CON LA DURACIÓN ──────────────────────────────
//
// El problema: la `recipe` (T2.1, Apéndice B) da el coste POR 30 SEGUNDOS y por tier (Test
// 30–170 ¢ · Standard 180–500 ¢ · Premium 900–1300 ¢). Pero §8.4 define TRES presets de
// duración (12 / 30 / 45 s en `presets.ts`) y §7.5 les asigna distinto número de clips. Un
// anuncio de 12 s y uno de 45 s no cuestan lo mismo: hace falta una regla de escalado.
//
// LA REGLA ELEGIDA: **el coste es lineal en SEGUNDOS DE VÍDEO GENERADO.**
//
//     costeVariante(tier, segundos) = recipe(tier) × (segundos / 30)
//
// Por qué esta y no otra:
//
//  1. **ES LA REGLA DEL PROPIO PRD, no una interpretación mía.** §16.1, última fila de la tabla
//     de COGS: «**Variantes a 15 s ≈ mitad de los valores de 30 s**». Y `research/01 §6.2` (la
//     fuente que §16.1 cita): «A 15 s (en vez de 30) todos los escenarios se reducen
//     aproximadamente a la mitad». La linealidad en segundos está ESCRITA; inventar otra curva
//     sería contradecir al PRD sin mandato.
//
//  2. **ES LO QUE FACTURA fal.ai.** Los modelos de vídeo se cobran POR SEGUNDO GENERADO
//     (`research/01 §3`: Kling AI Avatar v2 Std **$0,0562/s**, Kling Avatar v2 Pro $0,115/s,
//     OmniHuman v1.5 $0,14/s…), y el TTS por caracteres — que a 2,5 palabras/s (§7.2 N5) es
//     también lineal en segundos de locución. La factura de un lote es, literalmente, una suma
//     de segundos por precio-por-segundo.
//
//  3. **EL NÚMERO DE CLIPS DE §7.5 NO ES UN MULTIPLICADOR DE COSTE: ES UNA PARTICIÓN.** Esta
//     es la trampa de la que hay que salir. §7.5 dice que conversión son «1 avatar + 2 b-roll»
//     y storytelling «2 avatar + 3–4 b-roll». Tentación: coste ∝ nº de clips. Pero los clips de
//     §7.5 no son unidades de facturación, son TROZOS: «1 generación de vídeo por escena, con
//     duración objetivo ≤ maxDuration del ModelProfile (**escenas más largas se parten en 2
//     clips**)». Partir 16 s de body en 2 clips de 8 s no duplica el coste — son los mismos 16 s
//     de vídeo generado. Lo confirma la aritmética del ancla: el «COGS 30 s» del Apéndice B
//     mide el escenario B de `research/01 §6.2`, que es «hook avatar **12 s** + b-roll **18 s**»
//     = 30 segundos de vídeo, repartidos en 1 avatar + 1–2 b-roll. El precio salió de los
//     SEGUNDOS, no del recuento de clips.
//
// ── LO QUE NO SE HACE, Y POR QUÉ ───────────────────────────────────────────────────────────
//
// **NO se construye el total sumando los precios por componente de `research/01 §6.1`** (esa
// tabla da $/componente: voz $0,025 + imagen $0,039 + avatar $0,67 + b-roll $0,90 + shots
// $0,12 + compose $0,01). Sería el camino "obvio" y es el equivocado, por dos razones:
//
//   (a) **DERIVA**: esos componentes suman ~$1,76 en Standard — POR DEBAJO del suelo $1,80 de la
//       receta. Un estimador construido así se sale del rango contra el que la Verificación y
//       CP2 lo comparan.
//   (b) **RECALIBRACIÓN**: la fuente de verdad recalibrable es la fila `recipe` de la BD, no una
//       tabla congelada de research — T3.4 «recalibra las `recipe` sembradas en T2.1». Si el
//       estimador se anclara en research, recalibrar la receta NO movería el estimador y este
//       mentiría en silencio sobre la receta que dice usar (principio 9 de testing).
//
// **La receta es el ÚNICO ancla absoluto.** El desglose por segmentos reparte ESE total; nunca
// lo genera. Por construcción: `Σ lineItems == total`, exacto, en céntimos enteros.
//
// ── EL DESGLOSE Y LA ECONOMÍA HOOK×BODY×CTA ────────────────────────────────────────────────
//
// Se desglosa por SEGMENTO (hook/body/cta), que es la unidad de GENERACIÓN (§7.5 mapea cada
// escena a un segmento) y de DEDUPLICACIÓN (§7.2 N7: «segmentos compartidos entre variantes
// —body/CTA en hook-testing— se generan una sola vez, por content-hash»). Cada segmento cuesta
// su parte proporcional de los segundos del preset (§7.5):
//
//     costeSegmento = recipe(tier) × (segundosDelSegmento / 30)
//
// y **cada CLAVE de segmento se cobra UNA sola vez**, aunque N variantes la compartan. Eso es
// lo que hace que el estimador no mienta sobre un lote de hook-testing: 3 hooks del mismo
// ángulo = 3 hooks + 1 body + 1 cta = 5 generaciones, no 9. Es la aritmética de §16.1 («3×2×2 =
// 12 anuncios pagando 7 clips»), y sale sola del modelo — no hay una rama `if (hookTest)` que
// aplique un descuento a mano.
//
// ── DINERO: CÉNTIMOS ENTEROS, SIEMPRE ──────────────────────────────────────────────────────
//
// Nunca float, nunca dólares (§12: `amount_cents`, `est_cost_30s_*_cents`). El prorrateo por
// segundos genera restos; se reparten con el método del mayor resto (`largestRemainder`) para
// que la suma de las partidas sea EXACTAMENTE el total del lote. Un desglose que no suma el
// total es un desglose que miente.
import type { AdSegment, BatchPlan } from '../contracts/batch-plan';
import type { RecipeSeed } from '../library/contracts';
import { DURATION_PRESETS, MAX_EXPORT_SECONDS, RECIPE_ANCHOR_SECONDS } from './presets';

/** Una horquilla de coste en céntimos enteros (la receta da rango, no punto: `contracts.ts`). */
export interface CostRangeCents {
  minCents: number;
  maxCents: number;
}

/**
 * Una partida del desglose: UNA generación real de vídeo/voz que se va a pagar. Si tres
 * variantes comparten el body, hay UNA partida de body — con las tres listadas en `variantIds`.
 */
export interface CostLineItem {
  /** La clave de generación (`PlannedVariant.segmentKeys`): la unidad de dedup por content-hash. */
  segmentKey: string;
  segment: AdSegment;
  /** Los `filenameCode` de las variantes que consumen esta generación. >1 = segmento compartido. */
  variantFilenameCodes: string[];
  /** Segundos de vídeo/voz que genera esta partida (§7.5). */
  seconds: number;
  cost: CostRangeCents;
}

/** El resultado del estimador: total del lote + desglose + coste imputado a cada variante. */
export interface BatchCostEstimate {
  tier: RecipeSeed['tier'];
  /** Total del LOTE: lo que se paga de verdad (con los segmentos compartidos cobrados UNA vez). */
  total: CostRangeCents;
  lineItems: CostLineItem[];
  /**
   * Coste imputado POR VARIANTE (`filenameCode` → horquilla): el coste de sus tres segmentos,
   * con los compartidos REPARTIDOS entre quienes los comparten. Suma exactamente `total` — es
   * la vista que CP2 enseña («¿cuánto me cuesta cada anuncio?»), y en hook-testing es donde se
   * VE la economía: un anuncio cuesta menos que un anuncio suelto porque el body ya está pagado.
   */
  perVariant: Record<string, CostRangeCents>;
  /**
   * El coste de UNA variante aislada (sin compartir nada) a la duración del lote: la referencia
   * contra la que se lee el ahorro. A 30 s ES la horquilla de la receta, literalmente.
   */
  standaloneVariant: CostRangeCents;
  /**
   * ROLLUP POR SEGMENTO: lo que se paga de hook, de body y de cta EN TODO EL LOTE (con los
   * segmentos compartidos cobrados UNA vez), más cuántas generaciones son. Es el desglose que
   * CP2 pinta debajo del total.
   *
   * POR QUÉ VIVE AQUÍ Y NO EN EL PANEL (hallazgo de `simplify`): el panel lo derivaba a mano
   * filtrando `lineItems` y sumando con un `reduce`, lo que (a) violaba la decisión vinculante de
   * T2.3 —«ningún número de dinero se calcula en el navegador»— y (b) sumaba SOLO `maxCents`,
   * tirando el mínimo: el desglose salía como un PUNTO máximo debajo de un total que es HORQUILLA,
   * y el usuario comparaba peras con manzanas en la pantalla donde autoriza el gasto. El rollup se
   * calcula donde se calcula todo lo demás, con la misma aritmética de céntimos enteros.
   *
   * Por construcción `Σ bySegment == total` (los `lineItems` particionan el lote por segmento y
   * cada partida pertenece a UN segmento), y lo fija un test.
   */
  bySegment: Record<AdSegment, SegmentRollup>;
}

/** Lo que cuesta un segmento EN TODO EL LOTE y en cuántas generaciones se paga. NO se exporta: la
 *  superficie pública es `BatchCostEstimate`, y quien necesite esta forma la deriva de ella
 *  (`BatchCostEstimate['bySegment']`) — así no puede desincronizarse del todo. knip veta el export
 *  sin consumidor, y con razón. */
interface SegmentRollup {
  cost: CostRangeCents;
  /** Nº de generaciones reales (partidas) de este segmento: en hook-testing, 3 hooks → 1 body. */
  generations: number;
}

/**
 * Reparte `totalCents` entre `weights` (proporcionalmente) en ENTEROS que suman EXACTAMENTE
 * `totalCents`. Método del mayor resto: se da a cada uno su parte entera y los céntimos que
 * sobran van a los mayores restos (a igualdad, al de menor índice → determinista).
 *
 * Sin esto, redondear cada parte por su cuenta produce un desglose que no cuadra con su total
 * (a veces por 1–2 ¢) — y un desglose que no suma el total es un desglose que miente.
 */
function largestRemainder(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0 || weights.length === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (totalCents * w) / weightSum);
  const floors = exact.map((v) => Math.floor(v));
  let remaining = totalCents - floors.reduce((s, v) => s + v, 0);

  const order = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);

  const out = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remaining -= 1;
  }
  return out;
}

/**
 * El coste de UNA variante aislada de `seconds` segundos, en el tier de la receta.
 * ES LA REGLA (ver la cabecera): lineal en segundos de vídeo generado, anclada a los 30 s del
 * Apéndice B. A `seconds = 30` devuelve la horquilla de la receta SIN TOCAR — el ancla.
 *
 * EL CAP DE §8.4 SE APLICA AQUÍ, Y NO ES DECORACIÓN (hallazgo del code-review: `MAX_EXPORT_SECONDS`
 * estaba declarado y **no lo consumía nadie** — el cap duro de 60 s existía solo como comentario).
 * Sin cota, `Math.round(cents × seconds / 30)` traduce cualquier disparate a un número: una
 * duración de 0 s daría **coste 0** («este lote te cuesta $0,00») y una negativa, coste negativo.
 *
 * El estimador es LA ÚLTIMA DEFENSA antes de que el usuario apruebe un gasto en CP2: ante una
 * duración imposible su trabajo es RECHAZARLA, no convertirla en una cifra creíble.
 */
function scaleToSeconds(recipe: RecipeSeed, seconds: number): CostRangeCents {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`duración inválida (${String(seconds)} s): debe ser > 0`);
  }
  if (seconds > MAX_EXPORT_SECONDS) {
    // §8.4: «Cap duro de export: 60 s». Un anuncio más largo no se puede ni exportar, así que
    // estimar su coste sería estimar el de algo que el sistema no va a producir.
    throw new Error(
      `duración ${String(seconds)} s por encima del cap duro de export de §8.4 (${String(MAX_EXPORT_SECONDS)} s)`,
    );
  }
  const factor = seconds / RECIPE_ANCHOR_SECONDS;
  return {
    minCents: Math.round(recipe.estCost30sMinCents * factor),
    maxCents: Math.round(recipe.estCost30sMaxCents * factor),
  };
}

/**
 * Estima el coste de un `BatchPlan` con la `recipe` de su tier (la fila REAL de la BD /
 * `RECIPE_SEEDS` — nunca una receta de juguete).
 *
 * Lanza si la receta no es la del tier del plan: estimar el coste de un lote Premium con la
 * receta Test es exactamente el bug que este estimador existe para no cometer.
 */
export function estimateBatchCost(plan: BatchPlan, recipe: RecipeSeed): BatchCostEstimate {
  if (recipe.tier !== plan.tier) {
    throw new Error(
      `receta del tier "${recipe.tier}" para un lote del tier "${plan.tier}": el estimador no puede cuadrar`,
    );
  }

  const preset = DURATION_PRESETS[plan.objective];
  const segments: AdSegment[] = ['hook', 'body', 'cta'];

  // Se cobra la duración QUE DECLARA EL PLAN, no la del preset «de memoria». Un `BatchPlan` es un
  // documento (viaja por `ad_batch.matrix` jsonb, §12) y puede llegar aquí de cualquier sitio: si
  // dijera 90 s y se costeara el preset de 30 s, el estimador cobraría de MENOS por un anuncio que
  // ni siquiera se puede exportar. La duración del plan tiene que ser la de su preset — y si no lo
  // es, el plan está corrupto y se dice, no se «arregla» en silencio.
  if (plan.durationTargetSeconds !== preset.targetSeconds) {
    throw new Error(
      `el plan declara ${String(plan.durationTargetSeconds)} s pero el preset de "${plan.objective}" (§8.4) son ${String(preset.targetSeconds)} s: plan incoherente`,
    );
  }

  // El coste de la variante aislada, ancla de todo lo demás: recipe × (segundos / 30).
  // `scaleToSeconds` aplica el cap duro de §8.4 (60 s) y rechaza duraciones imposibles.
  const standaloneVariant = scaleToSeconds(recipe, plan.durationTargetSeconds);

  // El coste de los TRES segmentos de una variante se reparte con el mayor resto sobre sus
  // segundos (§7.5), de forma que hook+body+cta == coste de la variante, exacto.
  const segmentWeights = segments.map((s) => preset.segmentSeconds[s]);
  const segMin = largestRemainder(standaloneVariant.minCents, segmentWeights);
  const segMax = largestRemainder(standaloneVariant.maxCents, segmentWeights);
  const segmentCost: Record<AdSegment, CostRangeCents> = {
    hook: { minCents: segMin[0] ?? 0, maxCents: segMax[0] ?? 0 },
    body: { minCents: segMin[1] ?? 0, maxCents: segMax[1] ?? 0 },
    cta: { minCents: segMin[2] ?? 0, maxCents: segMax[2] ?? 0 },
  };

  // ── Deduplicación: una partida POR CLAVE de segmento, no por variante ──────────────────
  // Aquí es donde vive la economía Hook×Body×CTA. No hay descuento ad-hoc: simplemente, una
  // generación que dos variantes comparten aparece UNA vez en la factura.
  const byKey = new Map<string, CostLineItem>();
  for (const variant of plan.variants) {
    for (const segment of segments) {
      // `segmentKeys` es un Record COMPLETO sobre `AdSegment` (el contrato lo garantiza: los
      // tres segmentos siempre están), así que no hay rama de "clave ausente" que cubrir.
      const key = variant.segmentKeys[segment];
      const existing = byKey.get(key);
      if (existing) {
        existing.variantFilenameCodes.push(variant.filenameCode);
        continue;
      }
      byKey.set(key, {
        segmentKey: key,
        segment,
        variantFilenameCodes: [variant.filenameCode],
        seconds: preset.segmentSeconds[segment],
        cost: { ...segmentCost[segment] },
      });
    }
  }
  const lineItems = [...byKey.values()];

  const total: CostRangeCents = {
    minCents: lineItems.reduce((s, li) => s + li.cost.minCents, 0),
    maxCents: lineItems.reduce((s, li) => s + li.cost.maxCents, 0),
  };

  // El rollup por segmento sale de las MISMAS partidas que el total (ya deduplicadas), así que
  // `Σ bySegment == total` por construcción: cada partida pertenece a un único segmento. Se agrega
  // la horquilla ENTERA (min y max), no solo el techo — que es el bug que esto vino a matar.
  const bySegment: Record<AdSegment, SegmentRollup> = {
    hook: { cost: { minCents: 0, maxCents: 0 }, generations: 0 },
    body: { cost: { minCents: 0, maxCents: 0 }, generations: 0 },
    cta: { cost: { minCents: 0, maxCents: 0 }, generations: 0 },
  };
  for (const item of lineItems) {
    const roll = bySegment[item.segment];
    roll.cost.minCents += item.cost.minCents;
    roll.cost.maxCents += item.cost.maxCents;
    roll.generations += 1;
  }

  // ── Imputación por variante ────────────────────────────────────────────────────────────
  // Una partida compartida por N variantes se reparte entre las N (mayor resto sobre pesos
  // iguales → los céntimos sueltos caen en las primeras, de forma determinista). La suma de
  // `perVariant` es EXACTAMENTE `total`: ningún céntimo se pierde ni se inventa al repartir.
  const perVariant: Record<string, CostRangeCents> = {};
  for (const variant of plan.variants) {
    perVariant[variant.filenameCode] = { minCents: 0, maxCents: 0 };
  }
  for (const item of lineItems) {
    const shares = item.variantFilenameCodes.map(() => 1);
    const minShares = largestRemainder(item.cost.minCents, shares);
    const maxShares = largestRemainder(item.cost.maxCents, shares);
    item.variantFilenameCodes.forEach((code, i) => {
      const acc = perVariant[code];
      if (!acc) return;
      acc.minCents += minShares[i] ?? 0;
      acc.maxCents += maxShares[i] ?? 0;
    });
  }

  return { tier: recipe.tier, total, lineItems, perVariant, standaloneVariant, bySegment };
}
