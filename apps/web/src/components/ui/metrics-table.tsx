import { cn } from '@/lib/utils';

// MetricsTable — 1:1 with the DS mirror (data/MetricsTable.jsx): a header+row
// data grid for metrics/spend tables (kill/scale grid, spend ledger). `columns`
// is `{key, label, align?, mono?, width?}`; `rows` are plain objects;
// `renderCell(row, col)` lets a caller drop a Badge/custom node into a column.
//
// Deliberate deviation from the mirror's CSS-grid-of-divs: this renders a
// SEMANTIC <table> (thead/th[scope=col]/tbody/td), per the frontend brief
// (a11y is part of the verification) — screen readers announce it as a table
// and the header cells name their columns. The visual output matches the card:
// `table-fixed` + a <colgroup> reproduces the grid track widths (fr units are
// converted to percentages; fixed units like "120px" pass through).
//
// Only token classes. Mirror geometry: container border, radius-lg,
// overflow-hidden, bg-surface; header 11/18 padding (py-2.75 px-4.5), bottom
// hairline, bg-surface-2, 11px mono uppercase (text-micro), weight 600, text-3;
// body cells 13/18 padding (py-3.25 px-4.5), 13px (text-mono), text, a bottom
// hairline between rows. Right-aligned numeric columns set `mono`. (The
// mirror's 0.04em header letter-spacing is dropped: it sits exactly between
// no-tracking and tracking-wide=0.08em with no token for it, and TD.6 bans
// arbitraries — a sub-pixel call on 11px uppercase mono.)

export interface MetricsTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** Render this column's values in Geist Mono. */
  mono?: boolean;
  /** Grid track width, e.g. "2fr" or "120px". @default "1fr" */
  width?: string;
}

interface MetricsTableProps {
  columns: MetricsTableColumn[];
  rows: Record<string, React.ReactNode>[];
  /** Override rendering for a given (row, column) — e.g. to drop in a Badge. */
  renderCell?: (row: Record<string, React.ReactNode>, col: MetricsTableColumn) => React.ReactNode;
  className?: string;
}

// Translate the mirror's grid track widths into <col> widths. `fr` units become
// percentages of the total fr; any non-fr width (px, %, rem) passes through.
function columnWidths(columns: MetricsTableColumn[]): (string | undefined)[] {
  const tracks = columns.map((c) => c.width ?? '1fr');
  const totalFr = tracks.reduce((sum, w) => {
    const fr = /^([\d.]+)fr$/.exec(w);
    return fr ? sum + Number(fr[1]) : sum;
  }, 0);
  return tracks.map((w) => {
    const fr = /^([\d.]+)fr$/.exec(w);
    if (fr && totalFr > 0) {
      const pct = (Number(fr[1]) / totalFr) * 100;
      return `${pct.toString()}%`;
    }
    return fr ? undefined : w;
  });
}

const alignClass = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

export function MetricsTable({ columns, rows, renderCell, className }: MetricsTableProps) {
  const widths = columnWidths(columns);
  return (
    <div
      data-slot="metrics-table"
      className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}
    >
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {columns.map((col, i) => (
            <col key={col.key} style={widths[i] ? { width: widths[i] } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border bg-surface-2">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'px-4.5 py-2.75 text-micro font-semibold uppercase text-text-3 font-mono',
                  alignClass[col.align ?? 'left'],
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border last:border-b-0">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4.5 py-3.25 text-mono text-text align-middle',
                    col.mono ? 'font-mono' : 'font-sans',
                    alignClass[col.align ?? 'left'],
                  )}
                >
                  {renderCell ? (renderCell(row, col) ?? row[col.key]) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
