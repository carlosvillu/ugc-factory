import React from "react";
import { Button } from "../core/Button.jsx";

/** The waiting_approval banner shown when the pipeline pauses at a checkpoint. */
export function CheckpointBanner({ title, description, onApprove, onEdit, onReject }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        padding: "16px 20px",
        background: "var(--warning-soft)",
        border: "1px solid var(--warning-border)",
        borderRadius: "var(--r-lg)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <span
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "var(--r-md)",
            background: "var(--warning-soft)",
            border: "1px solid var(--warning-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--warning)",
            fontSize: "15px",
            flexShrink: 0,
          }}
        >
          ◆
        </span>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>{title}</div>
          <div style={{ fontSize: "12px", color: "var(--text-2)" }}>{description}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "10px" }}>
        <Button variant="secondary" size="sm" onClick={onEdit}>Editar</Button>
        <Button variant="danger-ghost" size="sm" onClick={onReject}>Rechazar</Button>
        <Button
          size="sm"
          onClick={onApprove}
          style={{ background: "var(--success)", borderColor: "var(--success)", color: "var(--success-on)" }}
        >
          Aprobar y continuar
        </Button>
      </div>
    </div>
  );
}
