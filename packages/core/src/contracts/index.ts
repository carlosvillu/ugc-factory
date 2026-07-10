// Contratos transversales del pipeline (architecture.md §4).
export { HealthStatusSchema, type HealthStatus } from './health';
export { newUlid, UlidSchema } from './ids';
// Errores tipados (architecture.md §5): AppError + su unión de codes/status, y el
// envelope Zod que la capa API serializa (api.md §2). api.md importa AMBOS de
// `@ugc/core/contracts`.
export { AppError, APP_ERROR_CODES, STATUS_BY_CODE, type AppErrorCode } from './app-error';
export { ErrorEnvelopeSchema, ErrorCodeSchema, type ErrorEnvelope, type ErrorCode } from './errors';
// Panel de gasto `GET /api/spend` (T0.12): la vista pública del ledger que el route
// handler serializa y la página /spend valida. Céntimos enteros (ver spend.ts).
export {
  SpendSummarySchema,
  ProviderTotalSchema,
  DayTotalSchema,
  CostProviderSchema,
  type SpendSummary,
  type ProviderTotal,
  type DayTotal,
  type CostProvider,
} from './spend';
// Contratos del análisis (F1, T1.1): la columna vertebral del pipeline
// `IntakeConfig → RawContent → VisualAnalysis → ProductBrief` (§7.4). El ProductBrief
// es el contrato central (Apéndice A) con las 3 divergencias del Apéndice A, y su
// espejo JSON Schema para el `output_config` de Anthropic.
export {
  ProductBriefSchema,
  BriefMetaSchema,
  BriefProductSchema,
  BriefAudienceSchema,
  BriefSocialProofSchema,
  BriefBrandSchema,
  BriefPricingSchema,
  BriefAssetsSchema,
  AngleSchema,
  PlatformSchema,
  AwarenessLevelSchema,
  AdToneSchema,
  type ProductBrief,
  type BriefMeta,
  type Angle,
  type Platform,
  type AwarenessLevel,
  type AdTone,
} from './product-brief';
export { toAnthropicJsonSchema, productBriefJsonSchema } from './product-brief.json-schema';
export {
  RawContentSchema,
  RawImageSchema,
  RawBrandingSchema,
  RawProductSchema,
  type RawContent,
  type RawImage,
  type RawBranding,
  type RawProduct,
} from './raw-content';
export {
  VisualAnalysisSchema,
  ClassifiedImageSchema,
  VisualBrandStyleSchema,
  RenderedSocialProofSchema,
  type VisualAnalysis,
  type ClassifiedImage,
  type VisualBrandStyle,
  type RenderedSocialProof,
} from './visual-analysis';
