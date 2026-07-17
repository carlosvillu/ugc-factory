// API pública del módulo `gallery` (T3.2): el seed versionado de templates de prompt (§10) y
// su validador determinista, más el CONTRATO CANÓNICO §10.4 de variables. Subpath
// `@ugc/core/gallery`.
//
// Es DATO + un validador PURO: sin red, sin BD. Lo consumen el script `pnpm seed:gallery`
// (@ugc/db, que inserta) y —en T3.5— el compilador de prompts (que resuelve los slots §10.4
// declarados aquí en `canonical-variables`).

// El contrato §10.4 EN CÓDIGO: el conjunto de slots que el validador rechaza-si-no-están y que
// T3.5 (el compilador) resuelve. Compartido a propósito para que no haya dos copias.
export {
  CANONICAL_SLOTS,
  BENEFIT_INDEXED_SLOT,
  extractSlots,
  isCanonicalSlot,
  type CanonicalSlot,
} from './canonical-variables';

// Los contratos Zod del shape de cada entidad del seed.
export {
  PromptKindSchema,
  PromptStatusSchema,
  GuardScopeSchema,
  BeatSeedSchema,
  VariableSpecSeedSchema,
  AssetSlotSeedSchema,
  PromptTemplateSeedSchema,
  GuardPackSeedSchema,
  ModelKindSchema,
  ModelStatusSchema,
  CostUnitSchema,
  ModelCostSchema,
  ModelCapabilitiesSchema,
  ModelProfileSeedSchema,
  isBrollModelKind,
  type PromptKind,
  type PromptStatus,
  type GuardScope,
  type BeatSeed,
  type VariableSpecSeed,
  type AssetSlotSeed,
  type PromptTemplateSeed,
  type PromptTemplateSeedInput,
  type GuardPackSeed,
  type ModelKind,
  type ModelStatus,
  type CostUnit,
  type ModelCost,
  type ModelCapabilities,
  type ModelProfileSeed,
} from './contracts';

// EL COMPARADOR de `fal:verify` (T3.4): parseo puro del `llms.txt` público de fal + contraste
// del precio del seed contra el publicado. Sin red (el script de @ugc/db hace el fetch y le pasa
// los BYTES): así el gate testea la LÓGICA con fixtures reales capturados, sin golpear fal.
export {
  parseFalPrice,
  compareModelProfile,
  type ParsedFalPrice,
  type ModelVerifyOutcome,
  type ModelVerifyResult,
} from './fal-catalog-verify';

// El validador que corre DENTRO de `pnpm gate` (su test valida el seed REAL) y que
// `pnpm seed:gallery` ejecuta antes de tocar la BD: un seed inválido no llega a Postgres.
export {
  validateGallerySeed,
  formatGallerySeedIssues,
  type GallerySeedIssue,
  type GallerySeedIssueCode,
  type GallerySeed,
  type RawGallerySeedInput,
  type ValidateGallerySeedResult,
} from './seed-validator';

// El seed REAL, tal cual sale de `gallery-seed/*.json` (sin tipar: el validador es la frontera).
export { RAW_GALLERY_SEED, type RawGallerySeed } from './raw-seed';

// El lookup de guard packs §9.5 (T3.3): dado el seed + el contexto de la variante (category del
// brief + plataforma destino), el subconjunto de guard packs que el compilador (T3.5) inyecta.
export { resolveGuardPacks, type GuardLookupContext } from './guard-lookup';

// ── EL COMPILADOR DE PROMPTS (N6, T3.5) ──────────────────────────────────────────
// La resolución de variables canónicas §10.4 (slot→fuente): brief/persona/guion/campaña.
export {
  resolveSlot,
  type CampaignContext,
  type VariableSources,
  type SlotSource,
  type SlotResolution,
} from './variable-sources';

// La selección determinista de template por facetas + scoring §9.3 (perf vacío = neutro,
// desempate por slug para reproducibilidad).
export {
  selectTemplate,
  type SelectTemplateContext,
  type SelectTemplateResult,
} from './select-template';

// El ensamblador del `resolvedPrompt` §10.4: interpolación + fidelity guard + guard packs +
// anti-estilo + beats, con validación de resolución completa (issues accionables).
export {
  compilePrompt,
  templateSlots,
  COMPILER_FIDELITY_GUARD,
  COMPILER_ANTI_STYLE,
  type CompileInput,
  type CompileResult,
  type CompiledPrompt,
  type CompileIssue,
} from './compile-prompt';

// El contrato FORWARD `N6-sources` (T3.5 → F4/T4.11): cómo un predecesor le pasa a N6 las fuentes
// resueltas de una variante, y la función pura que las convierte en `CompileInput` (parseo +
// selección de template). El executor N6 del worker lo usa; F4 cablea el productor.
export {
  N6SourcesSchema,
  resolveCompileInput,
  type N6Sources,
  type ResolveCompileInputResult,
} from './compile-executor-contract';

// Fixtures de DEMO del compilador (brief beauty + persona + guion): datos deterministas que el CLI
// `pnpm compile:prompt` compila y que el executor N6 usa en su test. NO son test-only (el CLI los
// distribuye), por eso viven en el barrel y no en test-utils.
export { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT } from './compile-fixtures';

// ── LOS MODEL ADAPTERS (T3.6) ────────────────────────────────────────────────────
// Librería PURA que N7 (F4/T4.11) llama: transforma el prompt canónico de N6 + assets al payload
// del endpoint fal según `model_profile.promptAdapter`, y trocea escenas > maxDuration (§7.5).
export {
  adaptToPayload,
  ADAPTER_FAMILIES,
  avatarAdapter,
  i2vAdapter,
  seedanceAdapter,
  imageEditAdapter,
  planScene,
  planGeneration,
  quantizeDurationToEnum,
  type AdapterFamily,
  type AdapterInput,
  type AdapterAssets,
  type AdapterIssue,
  type AdapterPayload,
  type AdapterResult,
  type ModelAdapter,
  type PlannedClip,
  type ScenePlan,
  type GenerationPlan,
} from './adapters/index';

// ── LA VISTA DE GALERÍA (T3.8) ───────────────────────────────────────────────────
// Los contratos de respuesta de la API REST de `/gallery` (fila leída, no seed) + las funciones
// PURAS que la UI usa: resaltado de slots, validación en vivo (reusa §10.4) y diff v2↔v1 (LCS
// sin librería). Deterministas → su test corre en `pnpm gate`.
export {
  TemplateSummarySchema,
  TemplateDetailSchema,
  TemplateVersionSchema,
  AppliedGuardPackSchema,
  TemplateWithVersionsSchema,
  FacetCountSchema,
  TemplateListSchema,
  TemplateEditSchema,
  TemplateEditResultSchema,
  TemplateStatusChangeSchema,
  splitBodySlots,
  invalidBodySlots,
  diffLines,
  templateFilterToQuery,
  type TemplateSummary,
  type TemplateDetail,
  type TemplateVersion,
  type AppliedGuardPack,
  type TemplateWithVersions,
  type FacetCount,
  type TemplateList,
  type TemplateEdit,
  type TemplateEditResult,
  type TemplateStatusChange,
  type BodySegment,
  type DiffLine,
  type TemplateFilterQuery,
} from './gallery-view';
