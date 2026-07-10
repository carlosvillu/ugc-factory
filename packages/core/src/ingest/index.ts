// API pública del módulo `ingest` (N1, PRD §9.1). Fast path determinista de T1.3:
// clasificador de URL, normalizador + content_hash, parsers puros (Shopify `.json`,
// JSON-LD, OpenGraph), merge a `RawContent` y el cliente HTTP fino que orquesta el
// fast path con fallback transparente. Firecrawl/Jina (T1.4), mini-crawl (T1.5) y
// síntesis (T1.8) llegan en tareas posteriores sobre este mismo módulo.
export { classifyUrl, normalizeUrl, contentHash, type FastPathPlatform } from './url';
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
