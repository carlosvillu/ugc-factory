// API pública de `@ugc/services` (T1.10a): los servicios INVOCABLES que orquestan
// core (red/CPU) + db/storage (I/O de datos) para un paso del pipeline de análisis.
// Nacieron en `apps/web/src/server/` (T1.4/T1.7/T1.8) pero no importaban nada de
// Next — solo `@ugc/core` y `@ugc/db`. Se movieron aquí (T1.10a) para que
// `apps/worker` los reuse desde los executors N1/N2/N3 sin importar `apps/web`
// (backend/architecture.md §1: apps/web y apps/worker son composition roots
// hermanos, ninguno depende del otro). `apps/web` sigue important estos mismos
// servicios para sus route handlers (T1.4/T1.6/T1.7/T1.8) — MOVER, no duplicar.
//
// El barrel expone SOLO lo que se consume desde fuera del paquete: los tres servicios
// invocables. Los helpers internos (`loadAnthropicKey`, `recordAnthropicCost`,
// `anthropicCostOf`, `sendableProductImageUrls`) y los tipos de sus deps NO salen: sus
// tests los importan por ruta relativa, y exportarlos "por si acaso" es superficie
// muerta (knip la caza).
export { runFirecrawlIngest } from './firecrawl-ingest';
export { runVisualAnalyze } from './visual-analyze';
export { runSynthesizeBrief } from './synthesize-brief';
