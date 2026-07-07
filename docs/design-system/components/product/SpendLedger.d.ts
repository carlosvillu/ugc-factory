import * as React from "react";

export interface SpendLedgerProps {
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
}

export function SpendLedger(props: SpendLedgerProps): JSX.Element;
