// La lógica de warnings de CP1 (T1.10b), probada como función PURA — sin DOM.
//
// LO QUE FIJA (y por qué importa): "bloqueante para el BRIEF" (core, `isBlockingWarning`) y
// "bloqueante para APROBAR en CP1" (aquí) son dos preguntas DISTINTAS, y fusionarlas dejaría
// pasar el checkpoint manual sin la decisión de imágenes — que es justo lo que la Verificación
// exige ver. Estos tests son la barrera contra esa fusión.
import { describe, expect, it } from 'vitest';
import type { BriefWarning } from '@ugc/core/contracts';
import { canApprove, requiresUserDecision, toWarningView } from './brief-warnings';

const needsDecision: BriefWarning = {
  code: 'needs_user_decision',
  reason: 'missing_hero_image',
  message: 'No hay imagen de producto: sube al menos una foto o elige generar un packshot con IA.',
};

const hookTooLong: BriefWarning = {
  code: 'hook_too_long',
  angleIndex: 0,
  angleName: 'POV: tu piel al despertar',
  hookIndex: 0,
  hook: 'Llevo tres semanas usando este sérum cada mañana y mi piel ya no se apaga',
  wordCount: 14,
};

const priceMismatch: BriefWarning = {
  code: 'price_mismatch',
  synthesized: '39,90 €',
  fastPath: '34,90 €',
};

describe('requiresUserDecision', () => {
  it('`needs_user_decision` EXIGE decisión: es la petición bloqueante de imágenes del modo manual', () => {
    expect(requiresUserDecision(needsDecision)).toBe(true);
  });

  it('`hook_too_long` NO exige decisión (y no es un descuido)', () => {
    // Los hooks auténticos de Sonnet 5 se pasan del techo con frecuencia (8 casos en briefs
    // reales de T1.9). Si bloqueara, CP1 estaría bloqueado en casi cualquier análisis real.
    expect(requiresUserDecision(hookTooLong)).toBe(false);
  });

  it('`price_mismatch` NO exige decisión: el validador ya corrigió el precio', () => {
    expect(requiresUserDecision(priceMismatch)).toBe(false);
  });
});

describe('canApprove', () => {
  it('sin warnings, se puede aprobar', () => {
    expect(canApprove([], null)).toBe(true);
  });

  it('con warnings NO bloqueantes, se puede aprobar sin decidir nada', () => {
    expect(canApprove([hookTooLong, priceMismatch], null)).toBe(true);
  });

  it('con la petición de imágenes SIN resolver, NO se puede aprobar', () => {
    // LA CLÁUSULA DE LA VERIFICACIÓN: un análisis manual sin imágenes muestra en CP1 la
    // petición bloqueante — y bloquea de verdad hasta que el usuario elige.
    expect(canApprove([needsDecision], null)).toBe(false);
  });

  it('resuelta con «subir imágenes», se desbloquea', () => {
    expect(canApprove([needsDecision], 'upload_images')).toBe(true);
  });

  it('resuelta con «packshot IA» (la derivación a N7a), se desbloquea', () => {
    expect(canApprove([needsDecision], 'ai_packshot')).toBe(true);
  });
});

describe('toWarningView', () => {
  it('la petición de imágenes muestra el mensaje ACCIONABLE del validador (con las dos salidas)', () => {
    const view = toWarningView(needsDecision);
    expect(view.requiresDecision).toBe(true);
    // El mensaje viene del servidor TAL CUAL (T1.9 lo escribe accionable); no se reescribe aquí.
    expect(view.detail).toBe(needsDecision.message);
    expect(view.detail).toContain('packshot');
  });

  it('el hook largo se muestra con su texto y su recuento (el usuario lo reescribe en el editor)', () => {
    const view = toWarningView(hookTooLong);
    expect(view.detail).toContain(hookTooLong.hook);
    expect(view.detail).toContain('14 palabras');
    expect(view.requiresDecision).toBe(false);
  });

  it('el precio corregido explica QUÉ se descartó y QUÉ ganó (el cross-check N1==N3)', () => {
    const view = toWarningView(priceMismatch);
    expect(view.detail).toContain('39,90 €'); // lo que propuso la IA (descartado)
    expect(view.detail).toContain('34,90 €'); // el de la página (ganó)
  });
});
