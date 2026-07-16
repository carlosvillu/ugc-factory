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
} from './fal-client';
export { computeContentHash, type ContentHashInput, type GenerationInputs } from './content-hash';
export { extractImageOutput, type FalImage, type FalImageOutput } from './fal-image-output';
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
