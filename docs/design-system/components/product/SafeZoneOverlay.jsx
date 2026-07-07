import React from "react";
import { Badge } from "../feedback/Badge.jsx";

const PRESETS = {
  universal: { t: 14.06, r: 12.96, b: 35, l: 6.02, label: "Universal · 875×978" },
  tiktok: { t: 6.77, r: 12.96, b: 25.2, l: 4.07, label: "TikTok" },
  meta: { t: 14, r: 6, b: 35, l: 6, label: "Meta / Reels" },
};

/** Dashed safe-zone overlay for 9:16 previews, switchable by platform preset. */
export function SafeZoneOverlay({ preset = "universal", width = 236 }) {
  const p = PRESETS[preset];
  return (
    <div style={{ position: "relative", width, aspectRatio: "9/16", borderRadius: "var(--r-lg)", overflow: "hidden", background: "repeating-linear-gradient(135deg, var(--surface-3) 0 12px, var(--stripe) 12px 24px)", border: "1px solid var(--border-2)" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.34)" }} />
      {p && (
        <div
          style={{
            position: "absolute",
            border: "1.5px dashed var(--accent)",
            background: "var(--accent-soft)",
            borderRadius: "4px",
            top: p.t + "%",
            right: p.r + "%",
            bottom: p.b + "%",
            left: p.l + "%",
          }}
        />
      )}
      <span style={{ position: "absolute", bottom: "8px", left: 0, right: 0, textAlign: "center", fontSize: "10px", fontFamily: "var(--font-mono)", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>
        {p ? p.label : ""}
      </span>
    </div>
  );
}
