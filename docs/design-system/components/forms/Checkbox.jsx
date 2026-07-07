import React from "react";

/** Checkbox rendered as a small filled square with a ✓ glyph — no native checkbox styling, no icon asset. */
export function Checkbox({ checked = false, label, onChange, disabled = false }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "13px",
        color: checked ? "var(--text)" : "var(--text-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
      onClick={disabled ? undefined : () => onChange && onChange(!checked)}
    >
      <span
        style={{
          width: "17px",
          height: "17px",
          borderRadius: "var(--r-sm)",
          background: checked ? "var(--accent)" : "var(--surface-2)",
          border: `1px solid ${checked ? "var(--accent)" : "var(--border-2)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: "11px",
          flexShrink: 0,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      {label}
    </label>
  );
}
