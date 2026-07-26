// UNIT del mapeo de errores de checkpoint (T5.15, regla 5a + principio 9). Corre SIN Docker (el
// `include` de la config unit de apps/web es `src/**/*.test.{ts,tsx}`): `toCheckpointError` es lógica
// pura de clasificación por tipo. El invariante que protege este test es que un fallo de DATOS accionable
// (persona sin imágenes) NO se colapsa en el mismo 500 opaco que un fallo de cableado.
import { describe, expect, it } from 'vitest';
import { AppError } from '@ugc/core/contracts';
import {
  IllegalTransitionError,
  PermanentStepError,
  PersonaWithoutReferenceImageError,
  StepNotFoundError,
} from '@ugc/core/orchestrator';
import { toCheckpointError } from './checkpoint-errors';

describe('toCheckpointError', () => {
  it('StepNotFoundError → 404 not_found', () => {
    const out = toCheckpointError(new StepNotFoundError('x'));
    expect(out).toBeInstanceOf(AppError);
    expect((out as AppError).code).toBe('not_found');
  });

  it('IllegalTransitionError → 409 invalid_transition', () => {
    const out = toCheckpointError(new IllegalTransitionError('01STEP', 'succeeded', 'start'));
    expect(out).toBeInstanceOf(AppError);
    expect((out as AppError).code).toBe('invalid_transition');
  });

  // ── T5.15: EL fallo de datos accionable (persona sin imágenes) → 400, NO 500 ────────────────────────
  it('PersonaWithoutReferenceImageError → 400 validation_error (T5.15: accionable, no 500)', () => {
    const err = new PersonaWithoutReferenceImageError(
      'la persona «Maya» (01ABC) no tiene imágenes de referencia: N7c/avatar no puede generar.',
    );
    const out = toCheckpointError(err);
    expect(out).toBeInstanceOf(AppError);
    const appErr = out as AppError;
    expect(appErr.code).toBe('validation_error');
    expect(appErr.status).toBe(400);
    // El mensaje accionable se propaga literal (nombra la persona y dice qué hacer).
    expect(appErr.message).toContain('no tiene imágenes de referencia');
    expect(appErr.message).toContain('Maya');
  });

  // ── CONTROL NEGATIVO (principio 9): un PermanentStepError GENÉRICO NO se colapsa en el mismo 400 ─────
  // Voz incoherente / endpoint-aún-etiqueta son fallos de CABLEADO/config: deben seguir cayendo al 500
  // opaco (suben tal cual, sin envolverse en AppError). Este assert es lo que impide que un futuro «mapea
  // TODO PermanentStepError a 400» colapse los dos tipos de error en uno.
  it('un PermanentStepError genérico se propaga TAL CUAL (sigue cayendo al 500 opaco)', () => {
    const generic = new PermanentStepError(
      'triple de voz incoherente — provider elevenlabs con endpoint kokoro',
    );
    const out = toCheckpointError(generic);
    expect(out).toBe(generic);
    expect(out).not.toBeInstanceOf(AppError);
  });

  it('un Error cualquiera se propaga TAL CUAL (500 opaco)', () => {
    const boom = new Error('boom');
    expect(toCheckpointError(boom)).toBe(boom);
  });
});
