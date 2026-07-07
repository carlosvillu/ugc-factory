import React from "react";
import { Button } from "../core/Button.jsx";

/** Dashed-border empty state — recurs across /library, /gallery, /personas. */
export function EmptyState({ title, description, actionLabel, onAction }) {
  return (
    <div
      style={{
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--r-lg)",
        background: "var(--surface)",
        padding: "32px 20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "12px",
      }}
    >
      <span
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "var(--r-lg)",
          background: "var(--surface-3)",
          border: "1px solid var(--border-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-3)",
          fontSize: "20px",
        }}
      >
        +
      </span>
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "3px", color: "var(--text)" }}>{title}</div>
        {description && <div style={{ fontSize: "12px", color: "var(--text-3)", maxWidth: "240px" }}>{description}</div>}
      </div>
      {actionLabel && (
        <Button variant="primary" onClick={onAction} style={{ marginTop: "4px" }}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
