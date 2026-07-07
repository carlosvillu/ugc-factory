import React from "react";

const VARIANT_STYLES = {
  primary: {
    background: "var(--accent)",
    color: "var(--text-on-accent)",
    border: "1px solid var(--accent)",
    fontWeight: 600,
  },
  secondary: {
    background: "var(--surface-3)",
    color: "var(--text)",
    border: "1px solid var(--border-2)",
    fontWeight: 500,
  },
  ghost: {
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid transparent",
    fontWeight: 500,
  },
  danger: {
    background: "var(--danger)",
    color: "#fff",
    border: "1px solid var(--danger)",
    fontWeight: 600,
  },
  "danger-ghost": {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    border: "1px solid var(--danger-border)",
    fontWeight: 600,
  },
};

const SIZE_STYLES = {
  sm: { padding: "5px 11px", fontSize: "12px", borderRadius: "var(--r-sm)" },
  md: { padding: "8px 16px", fontSize: "13px", borderRadius: "var(--r-md)" },
  lg: { padding: "11px 22px", fontSize: "15px", borderRadius: "var(--r-md)" },
};

/**
 * UGC Factory's single button primitive. Covers primary / secondary /
 * ghost / danger / danger-ghost, three sizes, disabled, loading, and an
 * icon-only square mode.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  icon = false,
  onClick,
  type = "button",
  style,
}) {
  const v = VARIANT_STYLES[variant] || VARIANT_STYLES.primary;
  const s = SIZE_STYLES[size] || SIZE_STYLES.md;

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontFamily: "var(--font-sans)",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all .15s",
    ...v,
    ...s,
  };

  if (icon) {
    base.width = s.padding === SIZE_STYLES.sm.padding ? "28px" : "34px";
    base.height = base.width;
    base.padding = 0;
  }

  if (disabled) {
    base.background = "var(--surface-3)";
    base.color = "var(--text-4)";
    base.borderColor = "var(--border)";
    base.opacity = 0.6;
  }

  return (
    <button type={type} onClick={disabled ? undefined : onClick} disabled={disabled} style={{ ...base, ...style }}>
      {loading && (
        <span
          style={{
            width: "13px",
            height: "13px",
            border: "2px solid rgba(255,255,255,0.4)",
            borderTopColor: "currentColor",
            borderRadius: "50%",
            display: "inline-block",
            animation: "ugc-spin .7s linear infinite",
          }}
        />
      )}
      {children}
    </button>
  );
}
