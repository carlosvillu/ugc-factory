import React from "react";

/**
 * Card — the DS's flat, quiet container: 1px --border, --r-lg (10px, the DS caps
 * cards here), --surface background, --shadow-sm at rest. No gradient, no glass —
 * a solid --surface fill only. Header / body / footer are separated by 1px
 * --border rules with the DS's internal padding rhythm (~18-22px).
 */
export function Card({
  title = "Variante 3 · Hook directo",
  children = "Guion aprobado. Receta fal Standard, 8s, formato 9:16. Coste estimado $1.80.",
  footer,
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
        width: "min(420px, 100%)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          padding: "18px 22px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ fontSize: "15px", fontWeight: 600, letterSpacing: "-0.015em", color: "var(--text)" }}>
          {title}
        </div>
      </div>
      <div style={{ padding: "18px 22px", fontSize: "13px", color: "var(--text-2)" }}>
        {children}
      </div>
      {footer ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "18px 22px",
            borderTop: "1px solid var(--border)",
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
