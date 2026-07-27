// Lógica pura del dashboard `/` y de la vista de proyecto (architecture.md §2.3: la
// transformación que consume un RSC vive en lib/, no en el componente — testeable como
// unit sin jsdom, y sobrevive a rediseños). Toma los contratos de core (céntimos enteros)
// y produce lo que las tarjetas pintan.
import type { ActiveBatch, ProjectBatch } from '@ugc/core/contracts';

// `centsToDollars` vive en `@/lib/spend` (una sola definición): el dashboard reusa la de /spend
// para la barra `SpendLedger` en vez de duplicarla.

/** Progreso de un lote como porcentaje de variantes aprobadas sobre el total. Es la
 *  derivación HONESTA del progreso: `ad_batch` no guarda paso-del-pipeline (el mockup
 *  pinta «N3 de 11», que no tiene fuente). 0–100, entero. Un lote sin variantes → 0
 *  (no NaN: dividir por cero en pantalla sería un dato roto). */
export function batchProgressPct(
  batch: Pick<ActiveBatch | ProjectBatch, 'totalVariants' | 'approvedVariants'>,
): number {
  if (batch.totalVariants <= 0) return 0;
  return Math.round((batch.approvedVariants / batch.totalVariants) * 100);
}

/** Etiqueta del tier para la UI (el enum es técnico). */
const TIER_LABEL: Record<ActiveBatch['tier'], string> = {
  test: 'Test',
  standard: 'STD',
  premium: 'Premium',
};
export function tierLabel(tier: ActiveBatch['tier']): string {
  return TIER_LABEL[tier];
}
