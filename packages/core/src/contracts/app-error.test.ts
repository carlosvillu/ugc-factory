import { describe, expect, it } from 'vitest';
import { AppError, APP_ERROR_CODES, STATUS_BY_CODE } from './app-error';
import { ErrorEnvelopeSchema } from './errors';

describe('AppError', () => {
  it('deriva el status HTTP del code, no de un argumento', () => {
    expect(new AppError('unauthorized', 'x').status).toBe(401);
    expect(new AppError('rate_limited', 'x').status).toBe(429);
    expect(new AppError('validation_error', 'x').status).toBe(400);
    expect(new AppError('internal', 'x').status).toBe(500);
  });

  it('es instanceof Error y conserva code/message/details', () => {
    const err = new AppError('validation_error', 'payload inválido', { field: 'x' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
    expect(err.code).toBe('validation_error');
    expect(err.message).toBe('payload inválido');
    expect(err.details).toEqual({ field: 'x' });
  });

  it('STATUS_BY_CODE cubre TODOS los codes de la unión (sin huecos)', () => {
    for (const code of APP_ERROR_CODES) {
      expect(typeof STATUS_BY_CODE[code]).toBe('number');
    }
    expect(Object.keys(STATUS_BY_CODE).sort()).toEqual([...APP_ERROR_CODES].sort());
  });

  it('el mapa code→status es exactamente la tabla del Apéndice E', () => {
    expect(STATUS_BY_CODE).toEqual({
      validation_error: 400,
      unauthorized: 401,
      invalid_signature: 401,
      not_found: 404,
      invalid_transition: 409,
      guardrail_blocked: 422,
      rate_limited: 429,
      provider_error: 502,
      internal: 500,
    });
  });
});

describe('ErrorEnvelopeSchema', () => {
  it('acepta un envelope válido y rechaza un code fuera de la unión', () => {
    expect(
      ErrorEnvelopeSchema.safeParse({ code: 'unauthorized', message: 'sesión requerida' }).success,
    ).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse({ code: 'nope', message: 'x' }).success).toBe(false);
  });
});
