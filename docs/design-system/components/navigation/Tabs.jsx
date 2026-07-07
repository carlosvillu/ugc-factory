import React, { useState } from "react";

/** Underline tab bar — used for the node side-panel (Brief/Guiones/Assets/Logs) etc. */
export function Tabs({ tabs, defaultActive = 0, onChange }) {
  const [active, setActive] = useState(defaultActive);
  const select = (i) => {
    setActive(i);
    onChange && onChange(i);
  };
  return (
    <div style={{ display: "flex", gap: "2px", padding: "0 6px", borderBottom: "1px solid var(--border)" }}>
      {tabs.map((t, i) => (
        <button
          key={t}
          onClick={() => select(i)}
          style={{
            padding: "12px 14px",
            background: "transparent",
            border: "none",
            borderBottom: `2px solid ${i === active ? "var(--accent)" : "transparent"}`,
            color: i === active ? "var(--text)" : "var(--text-3)",
            fontSize: "13px",
            fontWeight: i === active ? 600 : 500,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
