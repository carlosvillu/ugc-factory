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
  type PromptKind,
  type PromptStatus,
  type GuardScope,
  type BeatSeed,
  type VariableSpecSeed,
  type AssetSlotSeed,
  type PromptTemplateSeed,
  type GuardPackSeed,
} from './contracts';

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
