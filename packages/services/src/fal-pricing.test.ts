// Pricing de la cadena N7b (T4.5): TTS por 1k_chars, ASR por minuto. Cláusulas DETERMINISTAS de la
// Verificación (regla de trabajo 8): el redondeo sub-céntimo a INTEGER, el warning ante unidad
// inesperada, y el warning ante `cost` jsonb inválido (invariante de dinero: nunca lanzan, degradan a
// 0¢ con warning observable). Las cost fns reciben el `cost` CRUDO del profile y validan internamente.
import { describe, expect, it } from 'vitest';

import { falTtsCostOf, falAsrCostOf, falVideoCostOf } from './fal-pricing';

describe('falTtsCostOf — TTS por 1000 caracteres (T4.5)', () => {
  it('1000 chars a 2¢/1k (kokoro) = 2¢', () => {
    const c = falTtsCostOf({ cost: { unit: '1k_chars', amountCents: 2 }, chars: 1000 });
    expect(c.cents).toBe(2);
    expect(c.chars).toBe(1000);
    expect(c.warning).toBeNull();
  });

  it('REDONDEO SUB-CÉNTIMO: 55 chars a 2¢/1k = 0,11¢ → 0¢ (integer del ledger)', () => {
    // Un clip corto factura una fracción de céntimo; `amount_cents` es INTEGER → redondea a 0. La
    // VERDAD granular (chars) queda en `quantity` para recomputar. Documentado en fal-pricing.ts.
    const c = falTtsCostOf({ cost: { unit: '1k_chars', amountCents: 2 }, chars: 55 });
    expect(c.cents).toBe(0);
    expect(c.chars).toBe(55);
  });

  it('CONTROL NEGATIVO: unidad inesperada (megapixel) → 0¢ con warning, NO lanza', () => {
    const c = falTtsCostOf({ cost: { unit: 'megapixel', amountCents: 2 }, chars: 1000 });
    expect(c.cents).toBe(0);
    expect(c.warning).toMatch(/unidad inesperada/);
  });

  it('CONTROL NEGATIVO: cost jsonb inválido/ausente → 0¢ con warning, NO lanza', () => {
    // La degradación que antes vivía a mano en el servicio ahora es de la cost fn (su casa natural).
    expect(falTtsCostOf({ cost: null, chars: 1000 }).cents).toBe(0);
    expect(falTtsCostOf({ cost: null, chars: 1000 }).warning).toMatch(/inválido o ausente/);
    expect(falTtsCostOf({ cost: { foo: 'bar' }, chars: 1000 }).warning).toMatch(
      /inválido o ausente/,
    );
  });
});

describe('falAsrCostOf — ASR por minuto (T4.5)', () => {
  it('60 s a 3¢/min (speech-to-text) = 3¢; durationSeconds es el rastro granular (== ledger)', () => {
    const c = falAsrCostOf({ cost: { unit: 'minute', amountCents: 3 }, durationSeconds: 60 });
    expect(c.cents).toBe(3);
    // `durationSeconds` (no `minutes`): es EXACTAMENTE lo que el caller registra en el ledger
    // (`quantity` = Math.round(durationSeconds), unit='seconds').
    expect(c.durationSeconds).toBe(60);
    expect(c.warning).toBeNull();
  });

  it('REDONDEO SUB-CÉNTIMO: 3,2 s a 3¢/min = 0,16¢ → 0¢', () => {
    const c = falAsrCostOf({ cost: { unit: 'minute', amountCents: 3 }, durationSeconds: 3.2 });
    expect(c.cents).toBe(0);
    expect(c.durationSeconds).toBe(3.2);
  });

  it('90 s a 3¢/min = 4,5¢ → 5¢ (round)', () => {
    const c = falAsrCostOf({ cost: { unit: 'minute', amountCents: 3 }, durationSeconds: 90 });
    expect(c.cents).toBe(5);
  });

  it('CONTROL NEGATIVO: unidad inesperada (1k_chars) → 0¢ con warning, NO lanza', () => {
    const c = falAsrCostOf({ cost: { unit: '1k_chars', amountCents: 3 }, durationSeconds: 60 });
    expect(c.cents).toBe(0);
    expect(c.warning).toMatch(/unidad inesperada/);
  });

  it('CONTROL NEGATIVO: cost jsonb inválido/ausente → 0¢ con warning, NO lanza', () => {
    expect(falAsrCostOf({ cost: undefined, durationSeconds: 60 }).cents).toBe(0);
    expect(falAsrCostOf({ cost: undefined, durationSeconds: 60 }).warning).toMatch(
      /inválido o ausente/,
    );
  });
});

describe('falVideoCostOf — avatar image+audio por segundo (T4.7)', () => {
  it('FLOAT sub-céntimo: 4 s a 5,62¢/s (Kling Std) = 22,48¢ → 22¢ (round)', () => {
    // Kling siembra `amountCents: 5.62` (float a propósito, ver ModelCostSchema). El precio unitario
    // fraccional se multiplica por segundos y se redondea al ENTERO del ledger. Reintroducir un parse
    // que exija enteros degradaría Kling a 0¢ silenciosamente — este assert lo protege.
    const c = falVideoCostOf({ cost: { unit: 'second', amountCents: 5.62 }, durationSeconds: 4 });
    expect(c.cents).toBe(22);
    expect(c.durationSeconds).toBe(4);
    expect(c.warning).toBeNull();
  });

  it('OmniHuman Premium: 4 s a 16¢/s = 64¢', () => {
    const c = falVideoCostOf({ cost: { unit: 'second', amountCents: 16 }, durationSeconds: 4 });
    expect(c.cents).toBe(64);
    expect(c.warning).toBeNull();
  });

  it('CONTROL NEGATIVO: unidad inesperada (minute) → 0¢ con warning, NO lanza', () => {
    const c = falVideoCostOf({ cost: { unit: 'minute', amountCents: 16 }, durationSeconds: 4 });
    expect(c.cents).toBe(0);
    expect(c.warning).toMatch(/unidad inesperada/);
  });

  it('CONTROL NEGATIVO: cost jsonb inválido/ausente → 0¢ con warning, NO lanza', () => {
    expect(falVideoCostOf({ cost: null, durationSeconds: 4 }).cents).toBe(0);
    expect(falVideoCostOf({ cost: null, durationSeconds: 4 }).warning).toMatch(
      /inválido o ausente/,
    );
  });
});
