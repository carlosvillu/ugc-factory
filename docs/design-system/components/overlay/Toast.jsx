import React from "react";

const GLYPH = { success: "✓", warning: "⚠", danger: "✕", info: "i" };
const BAR = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
};

/**
 * Toast — a transient, non-blocking status message. Solid --surface fill (no
 * glass), hairline 1px --border, --r-lg, --shadow-lg elevation, a 4px left
 * semantic accent bar per tone (borderLeft), a colored Unicode glyph, title in
 * mono-semibold, small description, and a ✕ close glyph. No icon library.
 * Spec render: shown as a single card; the card demo stacks 2-3 bottom-right.
 */
export function Toast({
  tone = "info",
  title = "Notificación",
  description = "",
}) {
  const accent = BAR[tone] || BAR.info;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        width: "min(360px, 100%)",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${accent}`,
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-lg)",
        padding: "14px 14px 14px 16px",
      }}
    >
      <span style={{ color: accent, fontSize: "14px", lineHeight: 1, flexShrink: 0, marginTop: "1px" }}>
        {GLYPH[tone]}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          {title}
        </div>
        {description ? (
          <div style={{ fontSize: "12px", color: "var(--text-2)" }}>{description}</div>
        ) : null}
      </div>
      <button
        aria-label="Descartar"
        style={{
          flexShrink: 0,
          width: "24px",
          height: "24px",
          marginTop: "-2px",
          marginRight: "-2px",
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
    </div>
  );
}
