import { describe, expect, it } from 'vitest';
import type { SpendSummary } from '@ugc/core/contracts';
import { centsToDollars, dayRows, groupThousands, providerLabel, providerRows } from './spend';
import { formatCost } from './money';

// La lógica pura del panel /spend (architecture.md §2.3): formateo de céntimos y
// shaping de filas. Se testea sin jsdom — el RSC solo llama a estas funciones.
// `formatCost` (dinero compartido web-wide) vive en `./money`; el panel lo consume.

describe('formatCost', () => {
  it('formatea céntimos enteros a "$X.XX"', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(1)).toBe('$0.01');
    expect(formatCost(485)).toBe('$4.85');
    expect(formatCost(21240)).toBe('$212.40');
    expect(formatCost(40000)).toBe('$400.00');
  });

  it('devuelve "—" para null', () => {
    expect(formatCost(null)).toBe('—');
  });
});

describe('centsToDollars', () => {
  it('convierte céntimos a dólares numéricos (2 decimales, sin float drift)', () => {
    expect(centsToDollars(21240)).toBe(212.4);
    expect(centsToDollars(485)).toBe(4.85);
    expect(centsToDollars(0)).toBe(0);
  });
});

describe('providerLabel', () => {
  it('mapea el enum técnico a etiqueta legible', () => {
    expect(providerLabel('fal')).toBe('fal.ai');
    expect(providerLabel('anthropic')).toBe('Anthropic');
    expect(providerLabel('firecrawl')).toBe('Firecrawl');
    expect(providerLabel('other')).toBe('Otros');
  });
});

const summary = (over: Partial<SpendSummary> = {}): SpendSummary => ({
  totalCents: 0,
  byDay: [],
  byProvider: [],
  limitCents: null,
  overLimit: false,
  ...over,
});

describe('providerRows', () => {
  it('formatea importe, cantidad y unidad; quantity 0 → "—"', () => {
    const rows = providerRows(
      summary({
        byProvider: [
          { provider: 'fal', amountCents: 18640, quantity: 4210, entries: 3, unit: 'seconds' },
          { provider: 'other', amountCents: 100, quantity: 0, entries: 1, unit: null },
        ],
      }),
    );
    expect(rows[0]).toEqual({
      provider: 'fal.ai',
      quantity: groupThousands(4210), // agrupación de miles con espacio fino U+2009 (mockup 8a)
      unit: 'seconds',
      amount: '$186.40',
    });
    expect(rows[1]).toEqual({ provider: 'Otros', quantity: '—', unit: '—', amount: '$1.00' });
  });
});

describe('groupThousands', () => {
  it('agrupa miles con espacio fino U+2009, determinista sin ICU', () => {
    expect(groupThousands(4210)).toBe('4 210');
    expect(groupThousands(5000000)).toBe('5 000 000');
    expect(groupThousands(999)).toBe('999');
    expect(groupThousands(0)).toBe('0');
  });
});

describe('dayRows', () => {
  it('formatea el importe por día, conservando la fecha UTC', () => {
    const rows = dayRows(
      summary({
        byDay: [
          { day: '2026-07-03', amountCents: 599, entries: 2 },
          { day: '2026-07-04', amountCents: 250, entries: 1 },
        ],
      }),
    );
    expect(rows).toEqual([
      { day: '2026-07-03', amount: '$5.99' },
      { day: '2026-07-04', amount: '$2.50' },
    ]);
  });
});
