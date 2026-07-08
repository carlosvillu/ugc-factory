import { cn } from '@/lib/utils';
import { spendPct } from './spend-ledger.util';

// SpendLedger — 1:1 with the DS mirror (product/SpendLedger.jsx): the monthly
// budget bar with warn/danger threshold ticks used in the spend panel (/spend).
// Presentational PURE: flat numeric props, NO @ugc/core types — the spend
// feature (F0) computes the totals and passes them in.
//
// The bar is an --accent fill on a --surface-3 track (radius-full), with two
// absolutely-positioned ticks (warning / danger) at their percent thresholds.
// The optional note is the mirror's inline warning box (warning-soft + ⚠ glyph),
// kept 1:1 rather than the Alert primitive because the mirror renders it inline
// with its own geometry. The big spent figure is text-h1 (30px, the exact DS
// step). Threshold/percent math is the pure spendPct() helper (unit-tested).
type SpendLedgerProps = React.ComponentProps<'div'> & {
  /** Amount spent this period (numeric, no $). */
  spent: number;
  /** Monthly budget (numeric, no $). */
  budget: number;
  /** Warn threshold, percent. @default 70 */
  warnAt?: number;
  /** Danger threshold, percent. @default 90 */
  dangerAt?: number;
  /** Optional inline warning note shown below the bar. */
  note?: string;
};

export function SpendLedger({
  className,
  spent,
  budget,
  warnAt = 70,
  dangerAt = 90,
  note,
  ...props
}: SpendLedgerProps) {
  const pct = spendPct(spent, budget);
  return (
    <div
      data-slot="spend-ledger"
      className={cn('rounded-lg border border-border bg-surface p-5.5', className)}
      {...props}
    >
      <div className="mb-1.5 text-small text-text-2">Presupuesto mensual</div>
      <div className="mb-4.5 flex items-baseline gap-2">
        <span className="font-mono text-h1 font-semibold text-text">${spent}</span>
        <span className="font-mono text-body text-text-3">/ ${budget}</span>
      </div>
      <div className="relative mb-1.5 h-2.25 overflow-hidden rounded-full bg-surface-3">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${String(pct)}%` }}
          aria-hidden
        />
        <span
          aria-hidden
          className="absolute -top-0.5 h-3.25 w-0.5 bg-warning"
          style={{ left: `${String(warnAt)}%` }}
        />
        <span
          aria-hidden
          className="absolute -top-0.5 h-3.25 w-0.5 bg-danger"
          style={{ left: `${String(dangerAt)}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-micro text-text-3">
        <span>0</span>
        <span className="text-warning">{warnAt}%</span>
        <span className="text-danger">{dangerAt}%</span>
        <span>100%</span>
      </div>
      {note ? (
        <div
          role="status"
          className="mt-4.5 flex items-start gap-2.25 rounded-md border border-warning-border bg-warning-soft px-3.25 py-2.75 text-small text-text-2"
        >
          <span aria-hidden className="text-warning">
            ⚠
          </span>
          <span>{note}</span>
        </div>
      ) : null}
    </div>
  );
}
