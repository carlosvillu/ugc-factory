// Panel de gasto (T0.12, mockup 8a): dos columnas — presupuesto (barra SpendLedger)
// a la izquierda, ledger por proveedor + por día (MetricsTable de TD.5) a la derecha.
// Server component PURO (todo estático al cargar, sin interactividad): recibe el
// `SpendSummary` ya calculado por el RSC de la página y lo pinta. Color SOLO por token.
//
// La ALERTA over-limit es un banner PROPIO con `role="alert"` y tokens `danger` —
// NO es el `note` de SpendLedger (ese es el aviso informativo `role="status"` del
// mockup, warning-soft, para el estado bajo-presupuesto). Se separan a propósito:
// semántica a11y distinta (alerta vs estado) y selector inequívoco para el spec.
import type { SpendSummary } from '@ugc/core/contracts';
import { MetricsTable } from '@/components/ui/metrics-table';
import { SpendLedger } from '@/components/ui/spend-ledger';
import { centsToDollars, dayRows, providerRows } from '@/lib/spend';
import { formatCost } from '@/lib/money';

const PROVIDER_COLUMNS = [
  { key: 'provider', label: 'Proveedor', width: '1.4fr' },
  { key: 'quantity', label: 'Cantidad', align: 'right' as const, mono: true, width: '1fr' },
  { key: 'unit', label: 'Unidad', align: 'right' as const, mono: true, width: '1fr' },
  { key: 'amount', label: 'USD', align: 'right' as const, mono: true, width: '0.9fr' },
];

const DAY_COLUMNS = [
  { key: 'day', label: 'Día', mono: true, width: '1.4fr' },
  { key: 'amount', label: 'USD', align: 'right' as const, mono: true, width: '1fr' },
];

export function SpendPanel({ summary }: { summary: SpendSummary }) {
  const { totalCents, limitCents, overLimit } = summary;
  const providers = providerRows(summary);
  const days = dayRows(summary);

  // SpendLedger toma props numéricas (dólares) y antepone el `$`. Con presupuesto
  // ausente (limitCents null) no hay barra útil: se muestra el total sin límite.
  const spentDollars = centsToDollars(totalCents);
  const budgetDollars = limitCents !== null ? centsToDollars(limitCents) : null;

  return (
    // Dos columnas del mockup 8a (presupuesto ~2fr / ledger ~3fr). Se aproxima el
    // ratio 1:1.4 con un grid de 5 columnas (col-span 2/3) — utilidades del DS, sin
    // valor arbitrario (design-system.md §3).
    <div className="grid gap-5 md:grid-cols-5">
      <div className="flex flex-col gap-4 md:col-span-2">
        {budgetDollars !== null ? (
          <SpendLedger spent={spentDollars} budget={budgetDollars} />
        ) : (
          <div className="rounded-lg border border-border bg-surface p-5.5">
            <div className="mb-1.5 text-small text-text-2">Gasto total</div>
            <div className="font-mono text-h1 font-semibold text-text">
              {formatCost(totalCents)}
            </div>
            <div className="mt-2 text-small text-text-3">
              Sin presupuesto configurado. (El panel completo llega en T7.7.)
            </div>
          </div>
        )}

        {overLimit ? (
          <div
            role="alert"
            data-testid="spend-over-limit-alert"
            className="flex items-start gap-2.25 rounded-md border border-danger-border bg-danger-soft px-3.25 py-2.75 text-small text-text-2"
          >
            <span aria-hidden className="text-danger">
              ⚠
            </span>
            <span>
              Gasto por encima del presupuesto: {formatCost(totalCents)} de{' '}
              {limitCents !== null ? formatCost(limitCents) : '—'}.
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-6 md:col-span-3">
        <section aria-labelledby="spend-by-provider">
          <h2 id="spend-by-provider" className="mb-3 text-small font-semibold text-text-2">
            Gasto por proveedor
          </h2>
          <MetricsTable columns={PROVIDER_COLUMNS} rows={providers} />
        </section>

        <section aria-labelledby="spend-by-day">
          <h2 id="spend-by-day" className="mb-3 text-small font-semibold text-text-2">
            Gasto por día
          </h2>
          <MetricsTable columns={DAY_COLUMNS} rows={days} />
        </section>
      </div>
    </div>
  );
}
