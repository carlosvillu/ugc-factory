// API pública de los MODEL ADAPTERS (T3.6). Los consume N7 (F4/T4.11) al construir cada
// generación: `resolveCompileInput`+`compilePrompt` (N6) producen el prompt canónico, `planGeneration`
// (§7.5) trocea las escenas contra `maxDuration`, y `adaptToPayload` transforma cada clip al dialecto
// del endpoint según `model_profile.promptAdapter`.
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

export type {
  AdapterInput,
  AdapterAssets,
  AdapterIssue,
  AdapterPayload,
  AdapterResult,
  ModelAdapter,
} from './types';
