import React from "react";

const STATUS = {
  done: { bar: "var(--success)", dot: "var(--success)" },
  checkpoint: { bar: "var(--warning)", dot: "var(--warning)", pulse: "#f59e0b66" },
  running: { bar: "var(--info)", dot: "var(--info)", pulse: "#3b82f655" },
  pending: { bar: "var(--text-3)", dot: "var(--text-3)" },
};

/**
 * A single step_run node in the pipeline canvas (React Flow in the real
 * product; this is the visual card only). `status` drives the left
 * accent bar + status dot + optional pulse ring (checkpoint/running).
 */
export function PipelineNode({ code, title, meta, time, cost, status = "pending", width = 168 }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <div
      style={{
        width,
        background: "var(--surface)",
        border: `1px solid ${status === "checkpoint" ? "var(--warning)" : "var(--border-2)"}`,
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
        boxShadow: status === "done" || status === "pending" ? "var(--shadow-sm)" : "0 0 0 3px " + (s.pulse ? s.pulse.slice(0, 7) + "22" : "transparent"),
        display: "flex",
        opacity: status === "pending" ? 0.72 : 1,
        "--pulse-color": s.pulse,
        animation: s.pulse ? "ugc-pulse-ring 2s ease-out infinite" : "none",
      }}
    >
      <span style={{ width: "4px", background: s.bar, flexShrink: 0 }} />
      <div style={{ padding: "12px 13px", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: status === "checkpoint" ? "var(--warning)" : "var(--text-3)", fontWeight: 600 }}>{code}</span>
          {status === "running" ? (
            <span style={{ width: "11px", height: "11px", border: "2px solid var(--info)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "ugc-spin .7s linear infinite" }} />
          ) : (
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: s.dot }} />
          )}
        </div>
        <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "2px", color: "var(--text)" }}>{title}</div>
        <div style={{ fontSize: "11px", color: status === "checkpoint" ? "var(--warning)" : "var(--text-3)", marginBottom: "10px", fontWeight: status === "checkpoint" ? 500 : 400 }}>{meta}</div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>
          <span>{time}</span>
          <span style={{ color: "var(--text-2)" }}>{cost}</span>
        </div>
      </div>
    </div>
  );
}
