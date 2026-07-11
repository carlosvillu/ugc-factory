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
