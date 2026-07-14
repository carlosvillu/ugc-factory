// API pública del módulo `ingest` (N1, PRD §9.1). Fast path determinista de T1.3:
// clasificador de URL, normalizador + content_hash, parsers puros (Shopify `.json`,
// JSON-LD, OpenGraph), merge a `RawContent` y el cliente HTTP fino que orquesta el
// fast path con fallback transparente. Firecrawl/Jina (T1.4), mini-crawl (T1.5) y
// síntesis (T1.8) llegan en tareas posteriores sobre este mismo módulo.
export {
  classifyUrl,
  normalizeUrl,
  contentHash,
  // T2.7 — el comparador de redirección significativa (lo consume el BriefValidator).
  detectRedirectMismatch,
  type FastPathPlatform,
  type RedirectMismatch,
  type RedirectMismatchReason,
} from './url';
export { parseShopifyJson } from './parsers/shopify';
export { parseJsonLd } from './parsers/json-ld';
export { parseOpenGraph } from './parsers/opengraph';
export type { RawContentPartial, RawSource } from './parsers/types';
export { mergeRawContent, type MergeInput } from './merge';
export {
  makeFastPathIngester,
  type FastPathIngester,
  type FastPathResult,
  type FastPathDeps,
} from './fast-path';
// Cliente HTTP de scraping N2 (T1.4, §7.2/§9.1): Firecrawl `/v2/scrape` con fallback
// transparente a Jina Reader. Produce un `RawContent` rico + bytes de screenshot +
// créditos; la persistencia (asset/cost_entry/url_analysis) la hace la capa servicio.
export {
  makeFirecrawlIngester,
  FIRECRAWL_CENTS_PER_CREDIT,
  type FirecrawlIngester,
  type FirecrawlDeps,
  type FirecrawlIngestResult,
  type ScreenshotBytes,
} from './firecrawl';
// Síntesis del RawContent en modo MANUAL (T1.6, §7.4): short-circuit puro que NO
// pasa por el fast-path ingester — el intake manual no scrapea.
export { synthManualRawContent, type SynthManualRawContentInput } from './manual';
// Servicio del intake manual (T1.6): orquesta el short-circuit hash → caché → synth
// + insert. Lo delega el route handler POST /api/analyses (modo manual).
export {
  runManualIntake,
  type ManualIntakeStore,
  type ManualIntakeResult,
  type ManualAnalysisRow,
} from './manual-intake';
// Derivación PURA del BrandKit (T1.9, §9.1): dominio registrable (clave del dedup) + fusión
// de branding/visual/brief en los campos de `brand_kit`. El UPSERT vive en packages/db.
export {
  brandKitDomain,
  deriveBrandKit,
  type DerivedBrandKit,
  type DeriveBrandKitInput,
} from './brand-kit';
