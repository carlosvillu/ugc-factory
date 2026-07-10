// Formateadores de dinero compartidos por toda la web (canvas + panel de gasto).
// El dominio guarda el dinero en CÉNTIMOS ENTEROS (step_run.cost, cost_entry.amount_cents,
// el contrato SSE); estos helpers son el ÚNICO sitio que traduce céntimos → texto "$X.XX".

/** Formatea un coste en céntimos (entero) a "$X.XX". `null`/undefined ⇒ "—". */
export function formatCost(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}
