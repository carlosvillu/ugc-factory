import * as React from "react";

export interface ProgressProps {
  /** Current progress 0..max, or null for the indeterminate state. @default 66 */
  value?: number | null;
  /** @default 100 */
  max?: number;
}

export function Progress(props: ProgressProps): JSX.Element;
