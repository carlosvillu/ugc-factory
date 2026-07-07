/* UGC Factory UI kit — shared header (nav tabs + theme/accent switcher). */
function UgcHeader({ screen, setScreen, theme, setTheme, accent, setAccent }) {
  const { Badge } = window.UGCFactoryDesignSystem_d126b2;
  const navBtn = (key, label) => (
    <button
      onClick={() => setScreen(key)}
      style={{
        padding: "7px 13px",
        background: screen === key ? "var(--surface-3)" : "transparent",
        border: "1px solid " + (screen === key ? "var(--border-2)" : "transparent"),
        borderRadius: "var(--r-md)",
        color: screen === key ? "var(--text)" : "var(--text-3)",
        fontSize: "13px",
        fontWeight: screen === key ? 600 : 500,
        fontFamily: "var(--font-sans)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
  const swatch = (key, color) => (
    <button
      key={key}
      onClick={() => setAccent(key)}
      title={key}
      style={{
        width: "20px",
        height: "20px",
        borderRadius: "50%",
        background: color,
        border: "none",
        cursor: "pointer",
        padding: 0,
        boxShadow: accent === key ? "0 0 0 2px var(--surface), 0 0 0 4px " + color : "none",
      }}
    />
  );
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 50, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "26px", height: "26px", borderRadius: "7px", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: "10px", height: "10px", borderRadius: "3px", background: "#fff" }} />
            </div>
            <div style={{ fontSize: "14px", fontWeight: 600, letterSpacing: "-0.01em" }}>UGC Factory</div>
          </div>
          <nav style={{ display: "flex", gap: "4px" }}>
            {navBtn("pipeline", "Canvas")}
            {navBtn("library", "Library")}
            {navBtn("spend", "Spend")}
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            {swatch("indigo", "#6366f1")}
            {swatch("emerald", "#10b981")}
            {swatch("amber", "#f59e0b")}
            {swatch("cyan", "#06b6d4")}
          </div>
          <div style={{ display: "inline-flex", gap: "3px", padding: "3px", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
            <button onClick={() => setTheme("dark")} style={{ padding: "4px 10px", fontSize: "11px", fontWeight: 600, borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", background: theme === "dark" ? "var(--accent)" : "transparent", color: theme === "dark" ? "#fff" : "var(--text-2)" }}>Oscuro</button>
            <button onClick={() => setTheme("light")} style={{ padding: "4px 10px", fontSize: "11px", fontWeight: 600, borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", background: theme === "light" ? "var(--accent)" : "transparent", color: theme === "light" ? "#fff" : "var(--text-2)" }}>Claro</button>
          </div>
        </div>
      </div>
    </header>
  );
}
window.UgcHeader = UgcHeader;
