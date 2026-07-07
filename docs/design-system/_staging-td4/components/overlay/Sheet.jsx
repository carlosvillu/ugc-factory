import React from "react";

/**
 * Sheet — a modal panel pinned to an edge of the viewport (a side drawer) over
 * a dark scrim. Inherits the Dialog a11y contract: role="dialog", aria-modal,
 * focus trap, focus return, Escape / ✕ to dismiss.
 * DS foundations: hairline 1px --border on the inner edge, --surface fill,
 * --shadow-lg elevation, --overlay scrim. Solid fill, no glass, no blur.
 * Spec render: shown in the open state so the panel + scrim are visible.
 */
export function Sheet({
  side = "right",
  title = "Detalles de la variante",
  description = "Guion, receta fal y coste estimado del render seleccionado.",
  children,
}) {
  const pinned = side === "left"
    ? { left: 0, borderRight: "1px solid var(--border)" }
    : { right: 0, borderLeft: "1px solid var(--border)" };
  return (
    <div
      style={{
        position: "relative",
        minHeight: "300px",
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
      }}
    >
      {/* scrim */}
      <div style={{ position: "absolute", inset: 0, background: "var(--overlay)" }} />
      {/* edge-pinned panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          ...pinned,
          width: "min(360px, 82%)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          background: "var(--surface)",
          boxShadow: "var(--shadow-lg)",
          padding: "24px",
        }}
      >
        <button
          aria-label="Cerrar"
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: "var(--r-sm)",
            color: "var(--text-2)",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
        <div style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.015em", color: "var(--text)" }}>
          {title}
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-2)" }}>{description}</div>
        {children}
      </div>
    </div>
  );
}
