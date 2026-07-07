/* UGC Factory UI kit — /spend screen. */
function SpendScreen() {
  const { SpendLedger, MetricsTable, Badge } = window.UGCFactoryDesignSystem_d126b2;

  const columns = [
    { key: "date", label: "Fecha", mono: true, width: "1fr" },
    { key: "provider", label: "Proveedor", width: "1.4fr" },
    { key: "concept", label: "Concepto", width: "2fr" },
    { key: "cost", label: "Coste", align: "right", mono: true, width: "1fr" },
  ];
  const rows = [
    { date: "07-06", provider: "fal.ai", concept: "Kling Avatar v2 · 12s", cost: "$0.67", tone: "info" },
    { date: "07-06", provider: "anthropic", concept: "Sonnet 5 · brief (cached)", cost: "$0.09", tone: "violet" },
    { date: "07-06", provider: "firecrawl", concept: "/scrape · 2 créditos", cost: "$0.01", tone: "success" },
  ];

  return (
    <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "28px 24px 60px" }}>
      <div style={{ marginBottom: "6px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>/spend</div>
      <h1 style={{ fontSize: "24px", fontWeight: 600, letterSpacing: "-0.015em", margin: "0 0 20px" }}>Panel de gasto</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "16px" }}>
        <SpendLedger spent={132} budget={200} note="Vas al 66%. Alerta configurada al 70% — próxima." />
        <MetricsTable
          columns={columns}
          rows={rows}
          renderCell={(row, col) => (col.key === "provider" ? <Badge tone={row.tone}>{row.provider}</Badge> : undefined)}
        />
      </div>
    </div>
  );
}
window.SpendScreen = SpendScreen;
