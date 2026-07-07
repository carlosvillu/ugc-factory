import React from "react";

/** Native select with a custom ▼ caret glyph (no icon asset). */
export function Select({ value, options = [], onChange, disabled = false, style }) {
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "9px 12px",
          background: "var(--surface-2)",
          border: "1px solid var(--border-2)",
          borderRadius: "var(--r-md)",
          color: "var(--text)",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
          outline: "none",
          appearance: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          boxSizing: "border-box",
          ...style,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
      <span
        style={{
          position: "absolute",
          right: "12px",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--text-3)",
          fontSize: "11px",
          pointerEvents: "none",
        }}
      >
        ▼
      </span>
    </div>
  );
}
