// API pública del módulo `generation` (§9.6, T4.1): el FalClient (cliente HTTP sobre el
// queue de fal), el content_hash de dedupe y el precio por megapíxel de los modelos de
// imagen. El COSTE en el ledger y la PERSISTENCIA los pone `@ugc/services` (runGenerate);
// aquí vive solo la lógica pura + red que architecture §1 permite en core.
export {
  makeFalClient,
  FalProviderError,
  FalResponseError,
  DEFAULT_FAL_CONCURRENCY,
  DEFAULT_FAL_TIMEOUT_MS,
  DEFAULT_FAL_MAX_RETRIES,
  type FalClient,
  type FalClientDeps,
  type FalSubmitResult,
  type FalPollResult,
  type FalStatusCheck,
} from './fal-client';
export {
  reconcileGeneration,
  DEFAULT_RECONCILE_DEADLINES_MS,
  RECONCILABLE_STATUSES,
  CLAIM_STATUSES_POLL,
  CLAIM_STATUSES_IN_PROGRESS,
  type ReconcilableGeneration,
  type GenerationKind,
  type ReconcileOutcome,
  type ReconcileResult,
  type ReconcileDeps,
  type ReconcileDeadlines,
  type ReconcileUpdate,
  type ReconcileEnqueueDownload,
  type ReconcileCheckStatus,
} from './reconcile';
export {
  sweepStuckGenerations,
  type SweepableGenerationRow,
  type SweepGenerationsDeps,
  type SweepGenerationsResult,
  type ListReconcilableGenerations,
  type ResolveGenerationKind,
} from './sweep-generations';
export { computeContentHash, type ContentHashInput, type GenerationInputs } from './content-hash';
export { extractImageOutput, type FalImage, type FalImageOutput } from './fal-image-output';
// TTS + word timestamps (T4.5, N7b, §13.1): el output de audio del TTS y el output de word
// timestamps del ASR encadenado (shape construido desde el output ASR REAL capturado en vivo).
export { extractAudioOutput, type FalAudioOutput } from './fal-audio-output';
export {
  WordTimestampsSchema,
  extractWordTimestamps,
  computeWordCoverage,
  deriveDurationSeconds,
  type WordTimestamps,
  type AsrWord,
  type WordCoverage,
} from './word-timestamps';
// Constructor del prompt de packshot (T4.4, N7a · ruta `ai_packshot`): lógica pura brief → prompt.
export { buildPackshotPrompt, PACKSHOT_MIN_SHOTS, PACKSHOT_MAX_SHOTS } from './packshot-prompt';
// Webhook de fal (T4.2, §9.6): verificación de firma ED25519 (función pura, deps inyectadas) +
// el builder del mensaje firmado (compartido con los tests) + el contrato del payload.
export {
  buildFalWebhookMessage,
  verifyFalWebhook,
  FAL_WEBHOOK_TIMESTAMP_TOLERANCE_S,
  type FalWebhookHeaders,
  type FalWebhookVerification,
  type VerifyFalWebhookDeps,
  type FalJwk,
  type FalJwks,
} from './fal-webhook';
export {
  FalWebhookPayloadSchema,
  FalWebhookStatusSchema,
  type FalWebhookPayload,
  type FalWebhookStatus,
} from './fal-webhook-payload';
