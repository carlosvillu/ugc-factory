import { describe, expect, it } from 'vitest';
import { spendPct } from './spend-ledger.util';

// spendPct owns the only real logic in the product components (the rest just
// paint props — testing/references/frontend.md §1): the budget-bar fill must
// never overflow the track and must degrade sanely on edge inputs.
describe('spendPct', () => {
  it('returns the plain percentage under budget', () => {
    expect(spendPct(132, 200)).toBeCloseTo(66);
    expect(spendPct(0, 200)).toBe(0);
    expect(spendPct(200, 200)).toBe(100);
  });

  it('clamps over-budget spend to 100 so the fill never overflows', () => {
    expect(spendPct(260, 200)).toBe(100);
  });

  it('treats a zero or negative budget as full', () => {
    expect(spendPct(10, 0)).toBe(100);
    expect(spendPct(10, -5)).toBe(100);
  });

  it('clamps negative spend to 0', () => {
    expect(spendPct(-10, 200)).toBe(0);
  });

  // Documents current behavior for NaN spend (not clamped — the Math.min/max
  // chain propagates NaN). Deliberately left as-is: whether NaN should read as
  // 0%, 100%, or "unknown" is an F0 UX decision on flat props, not TD.5's call.
  it('propagates NaN spend (documented, pending an F0 UX decision)', () => {
    expect(spendPct(Number.NaN, 200)).toBeNaN();
  });
});
