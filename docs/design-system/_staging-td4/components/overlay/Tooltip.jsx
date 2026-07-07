import React from "react";

/**
 * Tooltip — a small on-hover / on-focus label. role="tooltip", associated to
 * its trigger, appears on hover and keyboard focus, dismisses on Escape.
 * DS foundations: solid --surface-3 fill (no glass, no blur), 1px
 * --border-strong hairline, --r-md, --shadow-md elevation, 12px body copy.
 * Spec render: the popup is shown above the trigger so both are visible.
 */
export function Tooltip({
  content = "Coste estimado del render",
  side = "top",
  children = "Estimar",
}) {
  const above = side !== "bottom";
  return (
    <div style={{ position: "relative", display: "inline-flex", padding: "40px 8px" }}>
      {/* trigger */}
      <button
        style={{
          height: "36px",
          padding: "0 14px",
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          fontWeight: 500,
          cursor: "default",
        }}
      >
        {children}
      </button>
      {/* popup */}
      <div
        role="tooltip"
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          [above ? "bottom" : "top"]: "100%",
          [above ? "marginBottom" : "marginTop"]: "-34px",
          padding: "6px 10px",
          background: "var(--surface-3)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--r-md)",
          boxShadow: "var(--shadow-md)",
          fontSize: "12px",
          color: "var(--text)",
          whiteSpace: "nowrap",
        }}
      >
        {content}
      </div>
    </div>
  );
}
