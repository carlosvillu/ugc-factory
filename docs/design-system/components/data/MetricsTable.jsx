import React from "react";

/**
 * Data table for metrics/spend grids. `columns` is an array of
 * `{key, label, align, mono}`; `rows` is an array of plain objects.
 * `renderCell(row, col)` lets a caller render a Badge/custom node for
 * a given column instead of raw text.
 */
export function MetricsTable({ columns, rows, renderCell }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden", background: "var(--surface)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: columns.map((c) => c.width || "1fr").join(" "),
          padding: "11px 18px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--text-3)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {columns.map((c) => (
          <span key={c.key} style={{ textAlign: c.align || "left" }}>
            {c.label}
          </span>
        ))}
      </div>
      {rows.map((row, ri) => (
        <div
          key={ri}
          style={{
            display: "grid",
            gridTemplateColumns: columns.map((c) => c.width || "1fr").join(" "),
            padding: "13px 18px",
            borderBottom: ri < rows.length - 1 ? "1px solid var(--border)" : "none",
            alignItems: "center",
            fontSize: "13px",
          }}
        >
          {columns.map((c) => (
            <span
              key={c.key}
              style={{
                textAlign: c.align || "left",
                fontFamily: c.mono ? "var(--font-mono)" : "var(--font-sans)",
                color: "var(--text)",
              }}
            >
              {renderCell ? renderCell(row, c) : row[c.key]}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
