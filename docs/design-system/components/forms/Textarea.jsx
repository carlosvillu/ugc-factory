import React from "react";

/** Multi-line text field — descriptions, briefs, script scenes. */
export function Textarea({ value, defaultValue, rows = 3, disabled = false, onChange, style, ...rest }) {
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
    resize: "vertical",
    boxSizing: "border-box",
    transition: "all .15s",
    opacity: disabled ? 0.6 : 1,
  };
  return (
    <textarea
      rows={rows}
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      onChange={onChange}
      onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; e.target.style.boxShadow = "0 0 0 3px var(--ring)"; }}
      onBlur={(e) => { e.target.style.borderColor = base.border; e.target.style.boxShadow = "none"; }}
      style={{ ...base, ...style }}
      {...rest}
    />
  );
}
