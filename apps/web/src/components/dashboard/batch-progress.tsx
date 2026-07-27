// Barra de progreso de un lote (variantes aprobadas / total), idéntica en el dashboard `/`
// y en la vista de proyecto `/projects/[id]` — se extrae aquí para no duplicarla (T5.10,
// simplify). El progreso se deriva HONESTAMENTE del recuento de variantes (dato real): el
// mockup pinta el paso del pipeline («N3 de 11»), que no tiene fuente. Solo clases token.
//
// La barra es el `role="progressbar"` accesible; la leyenda «X de Y aprobadas» la pone cada
// vista (difieren en el layout que la rodea), no este componente.
import type { ActiveBatch, ProjectBatch } from '@ugc/core/contracts';
import { batchProgressPct } from '@/lib/dashboard';

export function BatchProgress({
  batch,
}: {
  batch: Pick<ActiveBatch | ProjectBatch, 'totalVariants' | 'approvedVariants'>;
}) {
  const pct = batchProgressPct(batch);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Progreso del lote: ${String(batch.approvedVariants)} de ${String(batch.totalVariants)} variantes aprobadas`}
      className="h-1.5 overflow-hidden rounded-full bg-surface-3"
    >
      <span
        aria-hidden
        className="block h-full rounded-full bg-success"
        style={{ width: `${String(pct)}%` }}
      />
    </div>
  );
}
