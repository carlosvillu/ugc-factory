/* UGC Factory UI kit — /runs/[id] pipeline canvas screen. */
function PipelineScreen() {
  const { PipelineNode, CheckpointBanner, Tabs, Badge } = window.UGCFactoryDesignSystem_d126b2;
  const [approved, setApproved] = React.useState(false);

  return (
    <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "28px 24px 60px" }}>
      <div style={{ marginBottom: "6px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>/runs/8f21 · Sérum Vitamina C 15%</div>
      <h1 style={{ fontSize: "24px", fontWeight: 600, letterSpacing: "-0.015em", margin: "0 0 20px" }}>Canvas del pipeline</h1>

      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-xl)", padding: "26px", background: "var(--bg-subtle)", marginBottom: "24px", overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: "0", minWidth: "760px" }}>
          <PipelineNode code="N1" title="Ingesta" meta="shopify · 8 imágenes" time="0.9s" cost="$0.01" status="done" />
          <Connector />
          <PipelineNode code="N2" title="Análisis visual" meta="3 hero · paleta" time="4.2s" cost="$0.01" status="done" />
          <Connector />
          <PipelineNode
            code={approved ? "N3" : "N3 · CP1"}
            title="ProductBrief"
            meta={approved ? "8 ángulos · aprobado" : "esperando aprobación"}
            time={approved ? "—" : undefined}
            cost="$0.09"
            status={approved ? "done" : "checkpoint"}
            width={180}
          />
          <Connector />
          <PipelineNode code="N4" title="Estrategia" meta={approved ? "componiendo matriz" : "pendiente"} time="—" cost="est. $0" status={approved ? "running" : "pending"} />
        </div>
      </div>

      {!approved && (
        <div style={{ marginBottom: "24px" }}>
          <CheckpointBanner
            title="CP1 · Brief listo para revisión"
            description="El pipeline está en pausa. Revisa el brief antes de continuar."
            onApprove={() => setApproved(true)}
          />
        </div>
      )}

      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--r-lg)", background: "var(--surface)", overflow: "hidden" }}>
        <Tabs tabs={["Brief", "Guiones", "Assets", "Logs"]} />
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <FieldRow label="Nombre del producto" value="Sérum Vitamina C 15%" tone="success" tag="✓ extraído" quote={'"Sérum Vitamina C 15% — brillo y uniformidad"'} />
          <FieldRow label="Precio" value="34,90 €" tone="success" tag="✓ extraído · N1=N3" mono />
          <FieldRow label="Audiencia — nivel de consciencia" value="Problem-aware: sabe que su piel está apagada pero no conoce la vitamina C estabilizada como solución." tone="violet" tag="inferido · 0.78" italic="Inferido del tono de la landing y las reviews; sin evidencia textual directa." />
        </div>
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "0 4px" }}>
      <span style={{ width: "26px", height: "2px", background: "repeating-linear-gradient(90deg, var(--border-strong) 0 4px, transparent 4px 8px)" }} />
    </div>
  );
}

function FieldRow({ label, value, tone, tag, quote, italic, mono }) {
  const { Badge } = window.UGCFactoryDesignSystem_d126b2;
  return (
    <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
        <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-2)" }}>{label}</label>
        <Badge tone={tone}>{tag}</Badge>
      </div>
      <div style={{ fontSize: "14px", fontWeight: mono ? 400 : 500, fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", color: "var(--text)" }}>{value}</div>
      {quote && <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-3)", fontFamily: "var(--font-mono)", borderLeft: "2px solid var(--success)", paddingLeft: "10px" }}>{quote}</div>}
      {italic && <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-3)", fontStyle: "italic" }}>{italic}</div>}
    </div>
  );
}

window.PipelineScreen = PipelineScreen;
