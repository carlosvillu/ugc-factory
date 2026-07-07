import React from "react";

/**
 * Skeleton — a quiet loading placeholder block. A flat --surface-3 fill (no
 * gradient, no shimmer sweep — the DS bans gradients and decorative animation),
 * --r-sm by default. Presentational only (aria-hidden); the surrounding region
 * owns aria-busy / role="status" for assistive tech.
 * Size comes from style (width / height).
 */
export function Skeleton({ style, ...props }) {
  return (
    <div
      aria-hidden
      style={{
        background: "var(--surface-3)",
        borderRadius: "var(--r-sm)",
        ...style,
      }}
      {...props}
    />
  );
}
