/* UGC Factory UI kit — /library screen. */
function LibraryScreen() {
  const { VariantCard, EmptyState, Badge } = window.UGCFactoryDesignSystem_d126b2;
  const [hasVariants, setHasVariants] = React.useState(true);

  return (
    <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "28px 24px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "20px" }}>
        <div>
          <div style={{ marginBottom: "6px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>/library</div>
          <h1 style={{ fontSize: "24px", fontWeight: 600, letterSpacing: "-0.015em", margin: 0 }}>Biblioteca de vídeos</h1>
        </div>
        <button onClick={() => setHasVariants(!hasVariants)} style={{ fontSize: "11px", color: "var(--text-3)", background: "none", border: "1px solid var(--border-2)", borderRadius: "var(--r-sm)", padding: "5px 9px", cursor: "pointer" }}>
          {hasVariants ? "ver vacío" : "ver variantes"}
        </button>
      </div>

      {hasVariants ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "16px" }}>
          <VariantCard filenameCode="serum-painpoint-h02-lena-18s" title="Pain-point · Hook 02" tags={["Lena", "ES"]} status="approved" duration="0:18" cost="$2.14" />
          <VariantCard filenameCode="serum-confesion-h01-mateo-18s" title="Confesión · Hook 01" tags={["Mateo", "EN"]} status="composing" cost="est. $2.00" />
          <VariantCard filenameCode="serum-visual-h03-lena-30s" title="Prueba visual · Hook 03" tags={["Lena", "ES"]} status="failed" cost="$0.42" />
          <VariantCard filenameCode="serum-comparacion-h04-mateo-24s" title="Comparación · Hook 04" tags={["Mateo", "EN"]} status="approved" duration="0:24" cost="$1.98" />
        </div>
      ) : (
        <div style={{ maxWidth: "420px" }}>
          <EmptyState title="Aún no hay lotes" description="Pega una URL de producto o escribe una descripción para lanzar tu primer lote." actionLabel="Nuevo lote" />
        </div>
      )}
    </div>
  );
}
window.LibraryScreen = LibraryScreen;
