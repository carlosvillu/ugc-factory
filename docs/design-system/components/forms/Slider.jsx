import React from "react";

/** Range slider with accent fill, and an optional live value label above it. */
export function Slider({ value, min = 0, max = 100, step = 1, label, onChange }) {
  return (
    <div>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-2)", marginBottom: "8px" }}>
          <span>{label}</span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange && onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }}
      />
    </div>
  );
}
