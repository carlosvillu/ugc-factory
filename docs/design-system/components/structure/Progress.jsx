import React from "react";

/**
 * Progress — a determinate / indeterminate progress bar. A --surface-3 track
 * with a 1px --border and --r-full, an --accent fill. No gradient.
 * role="progressbar" with aria-valuenow / aria-valuemin / aria-valuemax; pass
 * value=null for the indeterminate state (renders a partial accent segment).
 */
export function Progress({ value = 66, max = 100 }) {
  const indeterminate = value == null;
  const pct = indeterminate ? 40 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : value}
      style={{
        position: "relative",
        height: "6px",
        width: "100%",
        overflow: "hidden",
        background: "var(--surface-3)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-full)",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: "var(--accent)",
          borderRadius: "var(--r-full)",
        }}
      />
    </div>
  );
}
