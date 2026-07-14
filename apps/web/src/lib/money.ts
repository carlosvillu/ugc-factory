// Formateadores de dinero compartidos por toda la web (canvas + panel de gasto).
// El dominio guarda el dinero en CÉNTIMOS ENTEROS (step_run.cost, cost_entry.amount_cents,
// el contrato SSE); estos helpers son el ÚNICO sitio que traduce céntimos → texto "$X.XX".

/** Formatea un coste en céntimos (entero) a "$X.XX". `null`/undefined ⇒ "—". */
export function formatCost(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Formatea una HORQUILLA de coste (T2.3): "$1.80 – $5.00", o "$1.80" si min == max.
 *
 * Por qué una horquilla y no un punto: la `recipe` del Apéndice B da RANGO ($0,3–1,7 · $1,8–5 ·
 * $9–13), no un número, y el estimador lo propaga hasta aquí. Enseñar solo el punto medio —o solo
 * el mínimo— sería inventarse una precisión que el modelo de coste no tiene, justo en la pantalla
 * donde el usuario autoriza el gasto. Cuando los dos extremos coinciden (redondeos de un lote
 * diminuto) se colapsa a uno: "$0.12 – $0.12" es ruido, no información.
 */
export function formatCostRange(range: { minCents: number; maxCents: number }): string {
  if (range.minCents === range.maxCents) return formatCost(range.minCents);
  return `${formatCost(range.minCents)} – ${formatCost(range.maxCents)}`;
}
