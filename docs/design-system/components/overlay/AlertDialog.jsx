import React from "react";

/**
 * AlertDialog — a modal that demands an explicit decision (destructive confirms
 * like "Cancelar lote", "Rechazar variante"). Centered popup over a dark scrim.
 * role="alertdialog", aria-modal, focus trapped and returned. NON-dismissible by
 * outside click and NO ✕ affordance — the footer actions are the only exits, so
 * the choice is deliberate.
 * DS foundations: hairline 1px --border, --r-lg, --surface fill, --shadow-lg,
 * --overlay scrim. The danger action uses --danger, the secondary is a ghost.
 * Spec render: shown in the open state so the popup + scrim are visible.
 */
export function AlertDialog({
  title = "Cancelar lote",
  description = "Se detendrán los 6 renders en curso y no se recuperará su coste. Esta acción no se puede deshacer.",
  confirmLabel = "Cancelar lote",
  cancelLabel = "Volver",
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
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(440px, 90%)",
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
        <div style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.015em", color: "var(--text)" }}>
          {title}
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-2)" }}>{description}</div>
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
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            style={{
              height: "36px",
              padding: "0 16px",
              borderRadius: "var(--r-md)",
              background: "var(--danger)",
              border: "1px solid var(--danger)",
              color: "var(--text-on-accent)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
