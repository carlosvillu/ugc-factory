// Envelope de error del Apéndice E (api.md §2): el contrato Zod que viaja al
// frontend. El frontend hace `switch` sobre `code`; `message` nunca es contrato.
// `request_id` correlaciona el error con los logs pino (observability.md §3.2).
import { z } from 'zod';
import { APP_ERROR_CODES } from './app-error';

export const ErrorCodeSchema = z.enum(APP_ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorEnvelopeSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(), // p. ej. z.flattenError() en validation_error
  request_id: z.string().optional(), // el mismo id que aparece en los logs pino
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
