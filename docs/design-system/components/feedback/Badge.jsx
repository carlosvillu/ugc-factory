import React from "react";

const TONES = {
  neutral: { bg: "var(--surface-3)", fg: "var(--text-2)", border: "var(--border-2)" },
  accent: { bg: "var(--accent-soft)", fg: "var(--accent)", border: "var(--accent-border)" },
  success: { bg: "var(--success-soft)", fg: "var(--success)", border: "var(--success-border)" },
  warning: { bg: "var(--warning-soft)", fg: "var(--warning)", border: "var(--warning-border)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)", border: "var(--danger-border)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)", border: "var(--info-border)" },
  violet: { bg: "var(--violet-soft)", fg: "var(--violet)", border: "var(--violet-border)" },
};

/**
 * Pill badge for status/tier/traceability tags. `dashed` renders a
 * dashed neutral outline (used for "estimated" values awaiting a real
 * one). `mono` sets Geist Mono (ids, language codes, costs).
 */
export function Badge({ children, tone = "neutral", dashed = false, mono = false, dot = false, style }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 10px",
        borderRadius: "var(--r-full)",
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        color: dashed ? "var(--text-3)" : t.fg,
        background: dashed ? "transparent" : t.bg,
        border: `1px ${dashed ? "dashed var(--border-strong)" : "solid " + t.border}`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: t.fg }} />}
      {children}
    </span>
  );
}
