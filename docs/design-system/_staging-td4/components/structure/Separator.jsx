import React from "react";

/**
 * Separator — a 1px --border hairline rule that divides content, following the
 * DS foundation "1px hairlines everywhere". role="separator" with the correct
 * aria-orientation. Only the --border token; no thickness beyond 1px.
 */
export function Separator({ orientation = "horizontal", style }) {
  const horizontal = orientation === "horizontal";
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      style={{
        flexShrink: 0,
        background: "var(--border)",
        width: horizontal ? "100%" : "1px",
        height: horizontal ? "1px" : "100%",
        ...style,
      }}
    />
  );
}
