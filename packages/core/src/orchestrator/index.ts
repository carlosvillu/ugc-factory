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
  RunStore,
  NewRunRow,
  NewStepRow,
  TxStores,
  WithTransaction,
} from './ports';
export { nextStatus, isLegalTransition, type StepStatus, type StepEvent } from './transitions';
export {
  transition,
  failStep,
  type FailOutcome,
  IllegalTransitionError,
  StepNotFoundError,
  type TransitionDeps,
} from './transition';
// Creación de run desde un DAG (T0.7b): contrato de entrada, validación y servicio.
export {
  RunDefinitionSchema,
  RunNodeSchema,
  type RunDefinition,
  type RunNode,
  initialStatus,
  validateDag,
} from './run-definition';
export {
  createRun,
  InvalidRunDefinitionError,
  type CreateRunDeps,
  type CreateRunResult,
  type CreatedStep,
} from './create-run';
export {
  DemoConfigSchema,
  type DemoConfig,
  type StepExecutor,
  type ExecutorContext,
} from './executor';
export { demoRunDefinition } from './demo-dag';
