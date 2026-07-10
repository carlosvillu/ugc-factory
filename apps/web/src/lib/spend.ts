// Lógica pura del panel /spend (architecture.md §2.3: la transformación de datos de
// un RSC vive en lib/, no en el componente — testeable como unit sin jsdom). Toma el
// `SpendSummary` del contrato (céntimos enteros) y produce lo que las tablas y la
// barra de presupuesto pintan.
import type { SpendSummary } from '@ugc/core/contracts';
import { formatCost } from '@/lib/money';

/** Céntimos → número en dólares (para props numéricas de SpendLedger, que antepone
 *  el `$` él mismo). Redondeado a 2 decimales para no arrastrar float. */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Etiqueta legible del proveedor para el ledger (el enum es minúscula/técnico). */
const PROVIDER_LABEL: Record<SpendSummary['byProvider'][number]['provider'], string> = {
  fal: 'fal.ai',
  anthropic: 'Anthropic',
  firecrawl: 'Firecrawl',
  other: 'Otros',
};

export function providerLabel(provider: SpendSummary['byProvider'][number]['provider']): string {
  return PROVIDER_LABEL[provider];
}

/** Fila del ledger por proveedor (mockup 8a, columna derecha): proveedor, cantidad,
 *  unidad, importe formateado. Tipada como `Record<string, string>` para encajar
 *  directamente en `MetricsTable` (direcciona celdas por `col.key`). `quantity` 0 ⇒
 *  "—" (no facturado por unidad). Claves: provider|quantity|unit|amount. */
export type ProviderRow = Record<string, string>;

/** Agrupa miles con espacio fino (como el mockup 8a: "4 210"). Determinista —
 *  `toLocaleString` depende de los datos ICU del runtime (ausentes en algunos Node),
 *  así que se hace a mano para que el formato sea idéntico en cualquier entorno. */
export function groupThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

export function providerRows(summary: SpendSummary): ProviderRow[] {
  return summary.byProvider.map((p) => ({
    provider: providerLabel(p.provider),
    quantity: p.quantity > 0 ? groupThousands(p.quantity) : '—',
    unit: p.unit ?? '—',
    amount: formatCost(p.amountCents),
  }));
}

/** Fila del ledger por día: fecha (UTC) + importe formateado. Tipada como
 *  `Record<string, string>` (claves day|amount) para encajar en `MetricsTable`. */
export type DayRow = Record<string, string>;

export function dayRows(summary: SpendSummary): DayRow[] {
  return summary.byDay.map((d) => ({ day: d.day, amount: formatCost(d.amountCents) }));
}
