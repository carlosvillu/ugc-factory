// Pure helper for SpendLedger, split out so it can be unit-tested in the web
// project's `node` vitest env (which has no JSX transform yet — the jsdom+react
// setup lands in T0.2). Importing the .tsx directly into a test fails to parse.
// This is the "extract the logic to a pure function" rule of
// testing/references/frontend.md §1.

/**
 * Fraction of budget spent, as a percent clamped to [0, 100] — over-budget
 * never overflows the track, a zero/negative budget reads as full.
 */
export function spendPct(spent: number, budget: number): number {
  if (budget <= 0) return 100;
  return Math.min(100, Math.max(0, (spent / budget) * 100));
}
