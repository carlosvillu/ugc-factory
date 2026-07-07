import * as React from "react";

export interface MetricsTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Render this column's values in Geist Mono. */
  mono?: boolean;
  /** CSS grid track width, e.g. "2fr" or "120px". @default "1fr" */
  width?: string;
}

export interface MetricsTableProps {
  columns: MetricsTableColumn[];
  rows: Record<string, React.ReactNode>[];
  /** Override rendering for a given (row, column) — e.g. to drop in a Badge. */
  renderCell?: (row: Record<string, React.ReactNode>, col: MetricsTableColumn) => React.ReactNode;
}

export function MetricsTable(props: MetricsTableProps): JSX.Element;
