// API pública del orquestador (subpath `@ugc/core/orchestrator`, architecture.md
// §7). En T0.7a: la máquina de estados pura (§7.1), `transition()` (§9.0) y los
// puertos que db implementa. El resto (creación de run, invalidación de
// sub-grafo, sweeper) llega en T0.7b/T0.8/T0.9.
export type {
  JobQueue,
  StepRow,
  StepPatch,
  StepStore,
  RunNotifier,
  TxStores,
  WithTransaction,
} from './ports';
export { nextStatus, isLegalTransition, type StepStatus, type StepEvent } from './transitions';
export {
  transition,
  IllegalTransitionError,
  StepNotFoundError,
  type TransitionDeps,
} from './transition';
