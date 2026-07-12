// API pública del módulo `library` (T2.1): la librería CURADA de copy (hooks/CTAs) y las
// 3 recetas por tier del Apéndice B, con su validador determinista. Subpath
// `@ugc/core/library`.
//
// Es DATO + un validador PURO: sin red, sin BD. Lo consumen el script `pnpm seed`
// (@ugc/db, que inserta) y —en T2.2— el estimador de coste (que lee las recetas).
export {
  RecipeTierSchema,
  AdObjectiveSchema,
  SeedLanguageSchema,
  HookAngleSchema,
  VerticalSchema,
  HookLineSeedSchema,
  CtaLineSeedSchema,
  RecipeStepSeedSchema,
  RecipeSeedSchema,
  type RecipeTier,
  type AdObjective,
  type SeedLanguage,
  type HookAngle,
  type Vertical,
  type HookLineSeed,
  type CtaLineSeed,
  type RecipeStepSeed,
  type RecipeSeed,
} from './contracts';
// El validador que corre DENTRO de `pnpm gate` (su test unitario valida la librería REAL)
// y que `pnpm seed` ejecuta antes de tocar la BD: un seed inválido no llega a Postgres.
export {
  validateSeeds,
  formatSeedIssues,
  type SeedIssue,
  type SeedIssueCode,
  type SeedLibrary,
  type RawSeedLibrary,
  type ValidateSeedsResult,
} from './seed-validator';
// EL PRESUPUESTO DE PALABRAS DE LOS PLACEHOLDERS: el contrato entre el VALIDADOR (que acota
// el peor caso renderizado de cada plantilla) y el RENDERIZADOR de T2.4 (que DEBE recortar el
// valor del brief a su presupuesto al sustituir). Sale al barrel precisamente por eso: si el
// renderizador no lo respeta, el techo de 12 palabras vuelve a mentir un nivel más abajo.
export {
  PLACEHOLDER_WORD_BUDGET,
  KNOWN_PLACEHOLDERS,
  countRenderedWords,
  findPlaceholders,
} from './placeholders';
// Los datos sembrados.
export { SEED_LIBRARY, HOOK_LINE_SEEDS, CTA_LINE_SEEDS, RECIPE_SEEDS } from './seed-data';
