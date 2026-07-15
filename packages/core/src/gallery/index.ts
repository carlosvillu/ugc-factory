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
  type PromptKind,
  type PromptStatus,
  type GuardScope,
  type BeatSeed,
  type VariableSpecSeed,
  type AssetSlotSeed,
  type PromptTemplateSeed,
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
