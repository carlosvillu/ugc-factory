// API pública del módulo `strategy` (T2.2, PRD §7.2 N4): el COMPOSITOR DE MATRIZ y el
// ESTIMADOR DE COSTE. Subpath `@ugc/core/strategy`.
//
// Lógica PURA y $0 (§7.2 marca N4 «Determinista + recomendador … $0»): sin LLM, sin red, sin
// BD. Sus entradas son el `ProductBrief` (T1.8), la librería sembrada (T2.1) y las personas
// (T2.0); su salida es el `BatchPlan` (contrato transversal, `contracts/batch-plan.ts`) y el
// desglose de coste que CP2 (T2.3) enseña antes de gastar un céntimo.
export { composeMatrix, type ComposeMatrixInput, type PlannablePersona } from './matrix';
export {
  estimateBatchCost,
  type BatchCostEstimate,
  type CostLineItem,
  type CostRangeCents,
} from './cost';
// Los presets de §8.4 × §7.5: los consume CP2 (para enseñar la duración del objetivo elegido)
// y el ScriptWriter de T2.4 (que escribe el guion a esos segundos por segmento).
export {
  DURATION_PRESETS,
  MAX_EXPORT_SECONDS,
  RECIPE_ANCHOR_SECONDS,
  type DurationPreset,
} from './presets';
