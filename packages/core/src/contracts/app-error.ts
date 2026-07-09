// AppError: la ÚNICA clase de error del backend (architecture.md §5). `code` es
// una unión literal cerrada; el `status` HTTP DERIVA del code — nadie elige un
// status a mano. Los servicios lanzan `AppError` con code semántico; JAMÁS
// `throw new Error("algo falló")`: el frontend hace switch sobre `code` y el
// wording de `message` no es contrato (SKILL.md principio 6).
export const APP_ERROR_CODES = [
  'validation_error',
  'not_found',
  'invalid_transition',
  'unauthorized',
  'invalid_signature',
  'rate_limited',
  'guardrail_blocked',
  'provider_error',
  'internal',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

// El mapa code→status es la tabla del Apéndice E (api.md §4). Es la fuente única:
// `AppError.status` lee de aquí y el envelope HTTP la respeta sin recalcular.
export const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  invalid_signature: 401,
  not_found: 404,
  invalid_transition: 409,
  guardrail_blocked: 422,
  rate_limited: 429,
  internal: 500,
  provider_error: 502,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
