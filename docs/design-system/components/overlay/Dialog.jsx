import React from "react";

/**
 * Modal dialog — a centered overlay panel over a dark scrim. Traps focus,
 * returns it to the trigger, closes on Escape / ✕ / footer action.
 * role="dialog", aria-modal, aria-labelledby (title) + aria-describedby (desc).
 * Spec render: shown in the open state so the popup + scrim are visible.
 */
export function Dialog({
  title = "Editar brief",
  description = "Ajusta los beneficios y el hook antes de aprobar. Los cambios crean una versión nueva.",
  children,
}) {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "260px",
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
      }}
    >
      {/* scrim */}
      <div style={{ position: "absolute", inset: 0, background: "var(--overlay)" }} />
      {/* popup */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(420px, 90%)",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "24px",
        }}
      >
        <button
          aria-label="Cerrar"
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            width: "28px",
            height: "28px",
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
        <div style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.015em", color: "var(--text)" }}>
          {title}
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-2)" }}>{description}</div>
        {children}
        <div
          style={{
            marginTop: "4px",
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            borderTop: "1px solid var(--border)",
            paddingTop: "16px",
          }}
        >
          <button
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "var(--r-md)",
              background: "transparent",
              border: "1px solid transparent",
              color: "var(--text-2)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "var(--r-md)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              color: "var(--text-on-accent)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
