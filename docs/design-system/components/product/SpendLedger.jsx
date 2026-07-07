import React from "react";
import { Badge } from "../feedback/Badge.jsx";

/** Budget bar + threshold ticks used in the spend panel (`/spend`). */
export function SpendLedger({ spent, budget, warnAt = 70, dangerAt = 90, note }) {
  const pct = Math.min(100, (spent / budget) * 100);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: "22px", background: "var(--surface)" }}>
      <div style={{ fontSize: "12px", color: "var(--text-2)", marginBottom: "6px" }}>Presupuesto mensual</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "18px" }}>
        <span style={{ fontSize: "30px", fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: "-0.02em", color: "var(--text)" }}>${spent}</span>
        <span style={{ fontSize: "14px", color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>/ ${budget}</span>
      </div>
      <div style={{ position: "relative", height: "9px", background: "var(--surface-3)", borderRadius: "var(--r-full)", overflow: "hidden", marginBottom: "6px" }}>
        <span style={{ display: "block", height: "100%", width: pct + "%", background: "var(--accent)", borderRadius: "var(--r-full)" }} />
        <span style={{ position: "absolute", top: "-2px", left: warnAt + "%", width: "2px", height: "13px", background: "var(--warning)" }} />
        <span style={{ position: "absolute", top: "-2px", left: dangerAt + "%", width: "2px", height: "13px", background: "var(--danger)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
        <span>0</span>
        <span style={{ color: "var(--warning)" }}>{warnAt}%</span>
        <span style={{ color: "var(--danger)" }}>{dangerAt}%</span>
        <span>100%</span>
      </div>
      {note && (
        <div style={{ marginTop: "18px", padding: "11px 13px", background: "var(--warning-soft)", border: "1px solid var(--warning-border)", borderRadius: "var(--r-md)", fontSize: "12px", color: "var(--text-2)", display: "flex", gap: "9px", alignItems: "flex-start" }}>
          <span style={{ color: "var(--warning)" }}>⚠</span>
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}
