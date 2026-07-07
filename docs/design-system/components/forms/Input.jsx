import React from "react";

const base = {
  width: "100%",
  padding: "9px 12px",
  background: "var(--surface-2)",
  border: "1px solid var(--border-2)",
  borderRadius: "var(--r-md)",
  color: "var(--text)",
  fontSize: "13px",
  fontFamily: "var(--font-sans)",
  outline: "none",
  boxSizing: "border-box",
  transition: "all .15s",
};

/**
 * Text input. Set `mono` for values that are data (URLs, prices, ids) —
 * the spec always sets those in Geist Mono.
 */
export function Input({ value, placeholder, mono = false, error = false, disabled = false, onChange, style, ...rest }) {
  const s = {
    ...base,
    fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
    borderColor: error ? "var(--danger)" : base.border,
    boxShadow: error ? "0 0 0 3px var(--danger-border)" : "none",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "text",
  };
  return (
    <input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onChange}
      onFocus={(e) => { if (!error) { e.target.style.borderColor = "var(--accent)"; e.target.style.boxShadow = "0 0 0 3px var(--ring)"; } }}
      onBlur={(e) => { if (!error) { e.target.style.borderColor = base.border; e.target.style.boxShadow = "none"; } }}
      style={{ ...s, ...style }}
      {...rest}
    />
  );
}
