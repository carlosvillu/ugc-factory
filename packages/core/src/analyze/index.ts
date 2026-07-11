// API pública del módulo `analyze` (T1.7): el paso de VISIÓN del pipeline de análisis.
// Subpath `@ugc/core/analyze`. Mismo patrón que `ingest/` — clientes de proveedor (aquí
// Anthropic Haiku) que hacen SOLO red/CPU; la persistencia vive en la capa servicio de web.
export {
  makeVisualAnalyzer,
  mapToVisualAnalysis,
  type VisualAnalyzer,
  type VisualAnalyzerDeps,
  type VisualAnalyzeInput,
  type VisualAnalyzerImageInput,
  type VisualAnalyzerResult,
  type VisualAnalyzerStatus,
  type VisualAnalyzerUsage,
} from './visual-analyzer';
export {
  rescaleImage,
  imageDimensions,
  MAX_LONG_EDGE_PX,
  type ImageBytes,
  type ImageDimensions,
} from './rescale';
// Cliente Anthropic COMPARTIDO (T1.8): construcción + normalización de `usage`. Lo consumen el
// VisualAnalyzer (T1.7, Haiku) y el BriefSynthesizer (T1.8, Sonnet 5), y el servicio de web lo
// necesita para tipar el `usage` que convierte en cost_entry.
export {
  makeAnthropicClient,
  toAnthropicUsage,
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
  type AnthropicDeps,
  type AnthropicUsage,
} from './anthropic-client';
// BriefSynthesizer (T1.8): el paso N3 de SÍNTESIS — una llamada a Sonnet 5 con structured
// output = ProductBrief, system prompt versionado y cacheado (packages/core/prompts/).
export {
  makeBriefSynthesizer,
  buildUserMessage,
  truncateMarkdown,
  BRIEF_SYNTHESIZER_MODEL,
  MAX_MARKDOWN_CHARS,
  TRUNCATION_MARKER,
  type BriefSynthesizer,
  type BriefSynthesizerDeps,
  type BriefSynthesizeInput,
  type BriefSynthesizerResult,
  type BriefSynthesizerStatus,
} from './brief-synthesizer';
export {
  BRIEF_SYNTHESIZER_SYSTEM_PROMPT,
  BRIEF_SYNTHESIZER_PROMPT_VERSION,
  ANTI_INJECTION_BLOCK,
} from '../../prompts/brief-synthesizer';
// BriefValidator (T1.9, §9.2): checks DETERMINISTAS post-síntesis con perfil por origen
// (`url`/`manual`) y warnings TIPADOS. Puro: corrige (precio del fast path, poda de
// suggested_assets) y avisa; no persiste nada.
export {
  validateBrief,
  MAX_HOOK_WORDS,
  type ValidateBriefOptions,
  type ValidateBriefResult,
} from './brief-validator';
