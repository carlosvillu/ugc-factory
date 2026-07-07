import React from "react";

const GLYPH = { success: "✓", warning: "⚠", danger: "✕", info: "i" };
const TONES = {
  success: { bg: "var(--success-soft)", border: "var(--success-border)", fg: "var(--success)" },
  warning: { bg: "var(--warning-soft)", border: "var(--warning-border)", fg: "var(--warning)" },
  danger: { bg: "var(--danger-soft)", border: "var(--danger-border)", fg: "var(--danger)" },
  info: { bg: "var(--info-soft)", border: "var(--info-border)", fg: "var(--info)" },
};

/** Inline status alert — a colored glyph + one line of copy on a soft-tinted card. */
export function Alert({ tone = "info", children }) {
  const t = TONES[tone] || TONES.info;
  return (
    <div
      style={{
        display: "flex",
        gap: "11px",
        alignItems: "center",
        padding: "13px 16px",
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: "var(--r-md)",
        fontSize: "13px",
        color: "var(--text)",
      }}
    >
      <span style={{ color: t.fg, fontSize: "15px", flexShrink: 0 }}>{GLYPH[tone]}</span>
      <span>{children}</span>
    </div>
  );
}
