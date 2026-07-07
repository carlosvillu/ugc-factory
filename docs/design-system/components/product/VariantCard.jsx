import React from "react";
import { Badge } from "../feedback/Badge.jsx";

const STATUS_BADGE = {
  approved: { label: "✓ aprobada", tone: "success" },
  composing: { label: "componiendo", tone: "info" },
  failed: { label: "fallo", tone: "danger" },
};

/** 9:16 video variant card for the library grid (`/library`). */
export function VariantCard({ filenameCode, title, tags = [], status = "composing", duration, cost, tier = "STD" }) {
  const badge = STATUS_BADGE[status] || STATUS_BADGE.composing;
  return (
    <div
      style={{
        border: `1px solid ${status === "failed" ? "var(--danger-border)" : "var(--border)"}`,
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        width: "230px",
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "9/16",
          background: "repeating-linear-gradient(135deg, var(--surface-3) 0 10px, var(--stripe) 10px 20px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {status === "composing" ? (
          <span style={{ width: "26px", height: "26px", border: "3px solid var(--border-strong)", borderTopColor: "var(--info)", borderRadius: "50%", animation: "ugc-spin .8s linear infinite" }} />
        ) : status === "failed" ? (
          <span style={{ fontSize: "22px", color: "var(--danger)" }}>⚠</span>
        ) : (
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>preview 9:16</span>
        )}
        <span style={{ position: "absolute", top: "10px", left: "10px" }}>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
        <span style={{ position: "absolute", top: "10px", right: "10px" }}>
          <Badge tone="accent">{tier}</Badge>
        </span>
        {duration && (
          <span style={{ position: "absolute", bottom: "10px", right: "10px", padding: "2px 7px", borderRadius: "var(--r-sm)", fontSize: "10px", fontFamily: "var(--font-mono)", color: "#fff", background: "rgba(0,0,0,0.6)" }}>
            {duration}
          </span>
        )}
      </div>
      <div style={{ padding: "13px 14px" }}>
        <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--text-3)", marginBottom: "5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filenameCode}</div>
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px", color: "var(--text)" }}>{title}</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
          {tags.map((t) => (
            <Badge key={t} mono={/^[A-Z]{2}$/.test(t)}>{t}</Badge>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "11px", borderTop: "1px solid var(--border)" }}>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{cost}</span>
          <a href="#" style={{ fontSize: "11px", color: "var(--accent)" }}>
            {status === "failed" ? "reintentar ↺" : status === "approved" ? "linaje →" : "ver →"}
          </a>
        </div>
      </div>
    </div>
  );
}
