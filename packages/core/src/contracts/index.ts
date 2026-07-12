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
// Contrato del intake manual (F1 N0, T1.6): rama de TEXTO LIBRE del intake. El
// mismo schema valida en el cliente (RHF) y re-valida en el route handler.
export {
  ManualIntakeConfigSchema,
  IntakeImageRefSchema,
  MANUAL_FREE_TEXT_MIN,
  MANUAL_FREE_TEXT_MAX,
  MANUAL_IMAGE_REFS_MAX,
  type ManualIntakeConfig,
  type IntakeImageRef,
} from './intake';
// Rama URL del intake (T1.10a): la que T1.6 dejó anticipada. El submit por URL NO crea
// el análisis — arranca el run y N1 lo scrapea dentro (analysis-dag.ts).
export { UrlIntakeConfigSchema, ANALYSIS_LANGUAGES, type UrlIntakeConfig } from './intake';
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
// Settings `GET/PATCH /api/settings` (T0.14): shape enmascarado de lectura + payload
// write-only de escritura de credenciales, y las preferencias (idiomas/preset/umbrales).
// La apariencia (tema/acento/densidad) NO está aquí: persiste en cookie, no en BD.
export {
  SettingsViewSchema,
  SettingsPatchSchema,
  MaskedSecretSchema,
  SettingsPreferencesSchema,
  ExperimentThresholdsSchema,
  SecretProviderSchema,
  SECRET_PROVIDERS,
  DEFAULT_SETTINGS_PREFERENCES,
  type SettingsView,
  type SettingsPatch,
  type MaskedSecret,
  type SettingsPreferences,
  type ExperimentThresholds,
  type SecretProvider,
} from './settings';
// Warnings TIPADOS del BriefValidator (T1.9, §9.2): union discriminada por `code` con los
// datos accionables de cada check. NO confundir con `ProductBrief.meta.warnings` (string[],
// canal de observabilidad del sintetizador).
export {
  isBlockingWarning,
  BriefWarningSchema,
  BriefValidationProfileSchema,
  PriceMismatchWarningSchema,
  PrunedSuggestedAssetWarningSchema,
  HookTooLongWarningSchema,
  NeedsUserDecisionWarningSchema,
  MissingHeroImageWarningSchema,
  NeedsUserDecisionReasonSchema,
  type BriefWarning,
  type BriefWarningCode,
  type BriefValidationProfile,
  type NeedsUserDecisionReason,
} from './brief-warning';
// Artefactos que los nodos dejan en `step_run.output_refs` (T1.10a). Viven en core porque
// `output_refs` es una interfaz PÚBLICA: la consumen el nodo siguiente, el panel del canvas
// y CP1 (T1.10b) — y `apps/web` no puede importar de `apps/worker`. `SkippedOutputSchema` es
// GENÉRICO: cualquier nodo que se autodescarte (F2–F4), no solo N2.
export {
  SkippedOutputSchema,
  isSkippedOutput,
  N1OutputSchema,
  N2OutputSchema,
  N3OutputSchema,
  type SkippedOutput,
  type N1Output,
  type N2Output,
  type N3Output,
} from './step-outputs';
// La DECISIÓN de un checkpoint (T1.11): lo que el humano RESUELVE (CP1: subir fotos vs generar
// packshot-IA), que NO es el artefacto que edita. Canal genérico: unión discriminada por `kind`,
// a la que CP2/CP3/CP4 añaden su miembro. Ver la cabecera de `checkpoint-decision.ts`.
export {
  CheckpointDecisionSchema,
  BriefCheckpointDecisionSchema,
  type CheckpointDecision,
  type BriefCheckpointDecision,
} from './checkpoint-decision';
