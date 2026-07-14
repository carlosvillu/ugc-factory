// LA RESPUESTA DE `POST /api/batches/estimate` (T2.3): la matriz que saldría de una config y lo
// que costaría — el número que CP2 pinta EN GRANDE y sobre el que el usuario autoriza el gasto.
//
// POR QUÉ ES UN CONTRATO ZOD Y NO SOLO EL TIPO DE `estimateBatchCost`. `BatchCostEstimate` es una
// INTERFACE de TypeScript: existe en compilación y se evapora en runtime. Esto viaja por HTTP, así
// que necesita un schema que (a) el handler use para SERIALIZAR (un drift entre lo que devuelve y
// lo que el cliente espera revienta en test, no en producción — api.md §1) y (b) el `api-client`
// use para VALIDAR (architecture.md §3.1: «respuesta que no cumple el contrato = error, no datos
// corruptos aguas abajo»). Con dinero en juego, «datos corruptos aguas abajo» significa un total
// mal pintado.
//
// EL DINERO VIAJA EN CÉNTIMOS ENTEROS, siempre (§12: `amount_cents`, `est_cost_30s_*_cents`).
// Nunca dólares en float: el formateo a `$12.34` es cosa de la UI, en el borde, y no puede
// filtrarse al transporte — un `0.1 + 0.2` en el camino del dinero es exactamente el bug que la
// convención de céntimos existe para hacer imposible.
//
// LAS PIEZAS INTERNAS NO SE EXPORTAN (`CostRangeSchema`, `CostLineItemSchema`,
// `BatchCostEstimateSchema`): la superficie pública de este contrato es UNA —`BatchEstimateSchema`,
// la respuesta entera—, y knip veta el export sin consumidor con razón. Quien necesite el tipo de
// una parte lo deriva del todo (`BatchEstimate['estimate']['total']`), que además no puede
// desincronizarse del contrato que de verdad viaja.
import { z } from 'zod';
import { AdSegmentSchema, BatchPlanSchema } from './batch-plan';
import { RecipeTierSchema } from '../library/contracts';

/** Una horquilla de coste en céntimos enteros (la receta da RANGO, no punto — Apéndice B). */
const CostRangeSchema = z.object({
  minCents: z.number().int().nonnegative(),
  maxCents: z.number().int().nonnegative(),
});

/** Una partida del desglose: UNA generación real que se va a pagar. Si tres variantes comparten
 *  el body (hook-testing), hay UNA partida de body — con las tres en `variantFilenameCodes`. Es
 *  donde la economía Hook×Body×CTA (§16.1) se hace VISIBLE en la UI. */
const CostLineItemSchema = z.object({
  segmentKey: z.string().min(1),
  segment: AdSegmentSchema,
  variantFilenameCodes: z.array(z.string().min(1)).min(1),
  seconds: z.number().positive(),
  cost: CostRangeSchema,
});

const BatchCostEstimateSchema = z.object({
  tier: RecipeTierSchema,
  /** Total del LOTE: lo que se paga de verdad (los segmentos compartidos, cobrados UNA vez). */
  total: CostRangeSchema,
  lineItems: z.array(CostLineItemSchema),
  /** Coste imputado a cada variante (`filenameCode` → horquilla). Suma exactamente `total`. */
  perVariant: z.record(z.string(), CostRangeSchema),
  /** El coste de UNA variante aislada, la referencia contra la que se lee el ahorro. */
  standaloneVariant: CostRangeSchema,
  /** Lo que cuesta cada segmento EN TODO EL LOTE (compartidos cobrados UNA vez) y en cuántas
   *  generaciones. Es el desglose que CP2 pinta: viaja YA CALCULADO porque el navegador no suma
   *  céntimos (decisión vinculante de T2.3) — y porque sumarlo a mano allí tiraba el `minCents`. */
  bySegment: z.record(
    AdSegmentSchema,
    z.object({ cost: CostRangeSchema, generations: z.number().int().nonnegative() }),
  ),
});

/** La respuesta entera: la matriz que se compondría + lo que costaría. Las dos juntas y no en dos
 *  endpoints, porque son la MISMA pregunta («¿qué lote sale de esta config y cuánto vale?») y
 *  separarlas permitiría que la UI pintara un coste de una matriz y una tabla de otra. */
export const BatchEstimateSchema = z.object({
  plan: BatchPlanSchema,
  estimate: BatchCostEstimateSchema,
});
export type BatchEstimate = z.infer<typeof BatchEstimateSchema>;
