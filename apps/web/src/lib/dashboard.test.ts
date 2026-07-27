import { describe, expect, it } from 'vitest';
import { batchProgressPct, tierLabel } from './dashboard';

// `centsToDollars` ya no vive aquí (se reusa la de `@/lib/spend`, cubierta por spend.test.ts).

describe('batchProgressPct', () => {
  it('porcentaje de variantes aprobadas sobre el total (entero)', () => {
    expect(batchProgressPct({ totalVariants: 8, approvedVariants: 2 })).toBe(25);
    expect(batchProgressPct({ totalVariants: 3, approvedVariants: 3 })).toBe(100);
  });

  it('CONTROL: un lote sin variantes es 0, no NaN (no se divide por cero en pantalla)', () => {
    expect(batchProgressPct({ totalVariants: 0, approvedVariants: 0 })).toBe(0);
  });
});

describe('tierLabel', () => {
  it('mapea el enum técnico a la etiqueta de UI', () => {
    expect(tierLabel('test')).toBe('Test');
    expect(tierLabel('standard')).toBe('STD');
    expect(tierLabel('premium')).toBe('Premium');
  });
});
