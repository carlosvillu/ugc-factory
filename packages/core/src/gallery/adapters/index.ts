// API pública de los MODEL ADAPTERS (T3.6). Los consume N7 (F4/T4.11) al construir cada
// generación: `planGeneration` (§7.5) trocea las escenas contra `maxDuration`, y `adaptToPayload`
// transforma cada clip al dialecto del endpoint según `model_profile.promptAdapter`. NOTA (auditoría
// 2026-08-01): aunque `compilePrompt` (N6) produce EL prompt canónico, HOY N7 NO se lo pasa a estos
// adapters — usa `buildPackshotPrompt(brief)` (N7a) o `DEFAULT_BROLL_PROMPT` (N7d/N7f); deuda T5b.1b.
export { avatarAdapter, i2vAdapter, seedanceAdapter, imageEditAdapter } from './families';

export { adaptToPayload, ADAPTER_FAMILIES, type AdapterFamily } from './select-adapter';

export {
  planScene,
  planGeneration,
  quantizeDurationToEnum,
  type PlannedClip,
  type ScenePlan,
  type GenerationPlan,
} from './scene-planner';

// T5.8c: el troceo §7.5 se dimensiona contra la narración MEDIDA (N7b), no contra la estimada del guion.
export {
  sizeScenesToNarration,
  segmentSceneIndices,
  type MeasuredNarrationByScene,
} from './narration-sizing';

export type {
  AdapterInput,
  AdapterAssets,
  AdapterIssue,
  AdapterPayload,
  AdapterResult,
  ModelAdapter,
} from './types';
