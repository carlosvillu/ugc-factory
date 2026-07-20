// Pricing de la cadena N7b (T4.5): TTS por 1k_chars, ASR por minuto. Cláusulas DETERMINISTAS de la
// Verificación (regla de trabajo 8): el redondeo sub-céntimo a INTEGER, el warning ante unidad
// inesperada, y el warning ante `cost` jsonb inválido (invariante de dinero: nunca lanzan, degradan a
// 0¢ con warning observable). Las cost fns reciben el `cost` CRUDO del profile y validan internamente.
import { describe, expect, it } from 'vitest';

import {
  falTtsCostOf,
  falAsrCostOf,
  falVideoCostOf,
  falMusicCostOf,
  falPerImageCostOf,
} from './fal-pricing';

describe('falPerImageCostOf — imagen POR IMAGEN (NB2 edit, T4.12 pase B)', () => {
  it('2 imágenes a 8¢/img (nano-banana-2) = 16¢', () => {
    const c = falPerImageCostOf({ cost: { unit: 'image', amountCents: 8 }, imageCount: 2 });
    expect(c.cents).toBe(16);
    expect(c.imageCount).toBe(2);
    expect(c.warning).toBeNull();
  });

  it('1 imagen a 8¢/img = 8¢', () => {
    const c = falPerImageCostOf({ cost: { unit: 'image', amountCents: 8 }, imageCount: 1 });
    expect(c.cents).toBe(8);
  });

  it('CONTROL NEGATIVO: unidad inesperada (megapixel) → 0¢ con warning, NO lanza', () => {
    const c = falPerImageCostOf({ cost: { unit: 'megapixel', amountCents: 8 }, imageCount: 1 });
    expect(c.cents).toBe(0);
    expect(c.warning).toMatch(/unidad inesperada/);
  });

  it('CONTROL NEGATIVO: cost jsonb inválido/ausente → 0¢ con warning, NO lanza', () => {
    expect(falPerImageCostOf({ cost: null, imageCount: 1 }).cents).toBe(0);
    expect(falPerImageCostOf({ cost: null, imageCount: 1 }).warning).toMatch(/inválido o ausente/);
  });
});

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

  // VEED (tier Test, T4.7b) factura por MINUTO, no por segundo → `falVideoCostOf` rutea por unit. Antes
  // de T4.7b esta función SOLO aceptaba 'second' y degradaba 'minute' a 0¢ con warning; ese era el bug de
  // money-path que el verifier de T4.7b habría cazado (fuga silenciosa: un clip VEED registrado a coste
  // 0). Estos asserts blindan el path por-minuto.
  it('VEED por MINUTO: 60 s a 35¢/min = 35¢', () => {
    const c = falVideoCostOf({ cost: { unit: 'minute', amountCents: 35 }, durationSeconds: 60 });
    expect(c.cents).toBe(35);
    expect(c.durationSeconds).toBe(60);
    expect(c.warning).toBeNull();
  });

  it('VEED por MINUTO SIN mínimo: clip corto de 12 s a 35¢/min = 7¢ (round), NO 0¢ (la fuga)', () => {
    // CONTROL ANTI-FUGA: un clip VEED de 12 s son 35×(12/60) = 7¢. Con el bug (degradar 'minute' a 0¢)
    // este clip se registraría a 0¢ — el ledger mentiría. Reintroducir el rechazo de 'minute' pondría
    // este assert en ROJO. (Sin `minBilledSeconds` → sin piso: facturación por duración exacta.)
    const c = falVideoCostOf({ cost: { unit: 'minute', amountCents: 35 }, durationSeconds: 12 });
    expect(c.cents).toBe(7);
    expect(c.warning).toBeNull();
  });

  it('FLOOR DE FACTURACIÓN (T4.7b): clip de 8 s con minBilledSeconds=60 factura 35¢ (1 min), NO ~5¢', () => {
    // VEED cobra un MÍNIMO de 1 min aunque el clip dure 8 s. Sin el floor, 35×(8/60) ≈ 4,67¢ → 5¢: un
    // under-count de ~7× contra el cargo real de 35¢ de fal. El floor lo corrige (`max(8,60)=60` → 35¢).
    // La VERDAD granular `durationSeconds` sigue siendo la REAL (8), no la facturada (60): el ledger no
    // miente sobre cuánto vídeo se produjo, solo cobra el mínimo de fal.
    const c = falVideoCostOf({
      cost: { unit: 'minute', amountCents: 35, minBilledSeconds: 60 },
      durationSeconds: 8,
    });
    expect(c.cents).toBe(35);
    expect(c.durationSeconds).toBe(8);
    expect(c.warning).toBeNull();
  });

  it('FLOOR no penaliza clips MÁS LARGOS que el mínimo: 90 s con minBilledSeconds=60 factura por 90 s', () => {
    // El floor es un PISO, no un valor fijo: un clip de 90 s (> 60 s mínimo) se factura por sus 90 s.
    const c = falVideoCostOf({
      cost: { unit: 'minute', amountCents: 35, minBilledSeconds: 60 },
      durationSeconds: 90,
    });
    expect(c.cents).toBe(53); // 35 × (90/60) = 52,5 → 53 (round)
    expect(c.warning).toBeNull();
  });

  it('CONTROL NEGATIVO: unidad realmente inesperada (image) → 0¢ con warning, NO lanza', () => {
    const c = falVideoCostOf({ cost: { unit: 'image', amountCents: 16 }, durationSeconds: 4 });
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

describe('falMusicCostOf — bed musical (ace-step) por segundo (T4.9)', () => {
  it('bed de 30 s a 0,02¢/s (ace-step) = 0,6¢ → 1¢ (round del ledger)', () => {
    // ace-step siembra `amountCents: 0.02` (float sub-céntimo, $0,0002/s verificado vs fal). Un bed de
    // 30 s son 0,02×30 = 0,6¢ → `Math.round` lo lleva a 1¢. Este assert protege el precio REAL (deuda
    // §13.1 cerrada en T4.9) y el redondeo del ledger sobre un float sub-céntimo.
    const c = falMusicCostOf({ cost: { unit: 'second', amountCents: 0.02 }, durationSeconds: 30 });
    expect(c.cents).toBe(1);
    expect(c.durationSeconds).toBe(30);
    expect(c.warning).toBeNull();
  });

  it('bed largo (240 s, el máximo de ace-step) a 0,02¢/s = 4,8¢ → 5¢', () => {
    const c = falMusicCostOf({ cost: { unit: 'second', amountCents: 0.02 }, durationSeconds: 240 });
    expect(c.cents).toBe(5);
    expect(c.warning).toBeNull();
  });

  it('CONTROL NEGATIVO: unidad inesperada (minute) → 0¢ con warning, NO lanza', () => {
    const c = falMusicCostOf({ cost: { unit: 'minute', amountCents: 0.02 }, durationSeconds: 30 });
    expect(c.cents).toBe(0);
    expect(c.warning).toMatch(/unidad inesperada/);
  });

  it('CONTROL NEGATIVO: cost jsonb inválido/ausente → 0¢ con warning, NO lanza', () => {
    expect(falMusicCostOf({ cost: null, durationSeconds: 30 }).cents).toBe(0);
    expect(falMusicCostOf({ cost: null, durationSeconds: 30 }).warning).toMatch(
      /inválido o ausente/,
    );
  });
});
