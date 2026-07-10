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
  NewSupersedingStepRow,
  AuditStore,
  AuditEntry,
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
  type RunDefinitionInput,
  type RunNode,
  type RunNodeInput,
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
export {
  demoRunDefinition,
  demoCheckpointRunDefinition,
  demoCanvasRunDefinition,
} from './demo-dag';
export {
  shouldPause,
  CheckpointConfigSchema,
  type CheckpointConfig,
  type ShouldPauseInput,
} from './checkpoint';
// Timeouts por tipo de nodo (T0.9): mapa + override `config.timeout_ms` + cálculo
// del instante de expiración. PURO (lo consume transition() y sus tests).
export { timeoutMsFor, timeoutAtFor, TIMEOUT_BY_NODE_MS, DEFAULT_TIMEOUT_MS } from './timeout';
// Barrido de steps colgados (T0.9): expira los `running` con `timeout_at < now()`.
// Lo dispara un setInterval del worker (NO cron pg-boss, jobs.md §8). La query de
// ids vive en @ugc/db y se inyecta.
export {
  sweepExpiredSteps,
  type SweepDeps,
  type SweepResult,
  type ListExpiredStepIds,
} from './sweep';
export {
  approveStep,
  editStep,
  rejectStep,
  skipStep,
  cancelRun,
  type CheckpointOpsDeps,
} from './checkpoint-ops';
// Retry MANUAL de un step fallido (T0.9): failed→queued + reset de retry_count +
// patch opcional de config. Lo cablea `POST /api/steps/:id/retry`.
export { retryStep, type RetryStepDeps, type RetryStepInput } from './retry';
// Contrato de eventos del stream SSE (§9.0, T0.10): discriminated union Zod
// (snapshot | step_changed | heartbeat) que emite el route handler y consume el
// hook del frontend (T0.11). Vive en core: contrato único compartido.
export {
  RunEventSchema,
  RunSnapshotSchema,
  RUN_EVENT_TYPES,
  type RunEvent,
  type RunSnapshot,
  type StepChangedEvent,
  type StepSnapshot,
} from './run-events';
