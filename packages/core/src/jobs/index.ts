// API pública del registro de jobs (subpath `@ugc/core/jobs`, architecture.md §7).
// Nombres de cola + schemas de payload + opciones de retry; los handlers viven en
// apps/worker.
export {
  defineJob,
  type JobDefinition,
  type JobOptions,
  type QueuePolicy,
  type EnqueueRequest,
} from './registry';
export { noopJob, NoopJobSchema, type NoopJob } from './demo-noop';
export { stepExecuteJob, StepExecuteJobSchema, type StepExecuteJob } from './step-execute';
export {
  outputDownloadJob,
  OutputDownloadJobSchema,
  type OutputDownloadJob,
} from './output-download';
