import React from "react";

/** Toggle switch — pill track, circular thumb, accent when on. */
export function Switch({ checked = false, onChange, disabled = false }) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      onClick={disabled ? undefined : () => onChange && onChange(!checked)}
      style={{
        width: "38px",
        height: "22px",
        borderRadius: "var(--r-full)",
        background: checked ? "var(--accent)" : "var(--surface-3)",
        border: checked ? "none" : "1px solid var(--border-2)",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background .15s",
        display: "inline-block",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: checked ? "2px" : "2px",
          left: checked ? "18px" : "2px",
          width: checked ? "18px" : "16px",
          height: checked ? "18px" : "16px",
          borderRadius: "50%",
          background: checked ? "#fff" : "var(--text-3)",
          transition: "left .15s",
          boxShadow: checked ? "var(--shadow-sm)" : "none",
        }}
      />
    </span>
  );
}
