// Mapeo del estado de un step a lo que la UI pinta (T0.11). Un `step_run.status`
// tiene 13 valores (§7.1); el canvas los proyecta a:
//   - un GRUPO visual de 4 (`PipelineNodeStatus`) para el acento/dot heredado de la
//     card presentacional de TD.5 — PERO el nodo del canvas expone SIEMPRE el
//     `status` de 13 valores CRUDO como `data-status` (la API observable de los
//     tests e2e/CUA: ver un `failed` o `skipped` distinto de `succeeded` es un
//     requisito DURO de la Verificación; colapsar a 4 los borraría).
//   - un TOKEN de estado del design system (`--status-*` vía las utilidades de
//     color `success/warning/danger/info/…`) para el color del borde/dot. NUNCA un
//     color hardcodeado (design-system.md): el token es la fuente de verdad visual.
import type { StepSnapshot } from '@ugc/core/orchestrator';

export type StepStatus = StepSnapshot['status'];

// Los 4 estados visuales de la card presentacional (pipeline-node.tsx). El canvas
// NO usa esa card directamente (borra failed/skipped), pero conserva el mismo
// vocabulario de 4 para el acento base y añade el detalle real por `data-status`.
export type StepVisualGroup = 'done' | 'checkpoint' | 'running' | 'pending' | 'failed' | 'skipped';

// Grupo visual por estado (13→6). `waiting_approval`→checkpoint (pulsa),
// running/submitting→running, succeeded→done, failed/expired→failed,
// rejected/skipped/cancelled→skipped, el resto (awaiting_deps/pending/queued)→pending.
// El grupo `failed`/`skipped` se AÑADE a los 4 de la card porque la Verificación
// exige verlos distintos: un nodo fallido no puede pintarse como "pending".
export function visualGroupOf(status: StepStatus): StepVisualGroup {
  switch (status) {
    case 'succeeded':
      return 'done';
    case 'waiting_approval':
      return 'checkpoint';
    case 'running':
    case 'submitting':
      return 'running';
    case 'failed':
    case 'expired':
      return 'failed';
    case 'rejected':
    case 'skipped':
    case 'cancelled':
    case 'superseded':
      return 'skipped';
    case 'awaiting_deps':
    case 'pending':
    case 'queued':
      return 'pending';
  }
}

// Clase de color de TOKEN del design system por grupo visual (NUNCA hex). Fuente
// única para el borde de acento y el dot del nodo. Los tokens `success/warning/
// info/danger/text-3` mapean a `--status-*` vía globals.css (@theme inline).
export const visualToneClass: Record<StepVisualGroup, string> = {
  done: 'bg-success',
  checkpoint: 'bg-warning',
  running: 'bg-info',
  failed: 'bg-danger',
  skipped: 'bg-text-3',
  pending: 'bg-text-3',
};

// Borde de acento por grupo (mismo criterio de token). El checkpoint y el running
// llevan además el halo/pulso en el componente (data-status lo dispara).
export const visualBorderClass: Record<StepVisualGroup, string> = {
  done: 'border-success/40',
  checkpoint: 'border-warning',
  running: 'border-info/40',
  failed: 'border-danger',
  skipped: 'border-border-2',
  pending: 'border-border-2',
};

// Etiqueta legible del estado (español, UI). El texto CRUDO del estado (13 valores)
// también se expone en `data-status` para los tests; esto es lo que ve el humano.
export const statusLabel: Record<StepStatus, string> = {
  awaiting_deps: 'esperando deps',
  pending: 'pendiente',
  queued: 'en cola',
  submitting: 'enviando',
  running: 'en curso',
  waiting_approval: 'esperando aprobación',
  succeeded: 'completado',
  failed: 'fallido',
  rejected: 'rechazado',
  skipped: 'saltado',
  cancelled: 'cancelado',
  expired: 'expirado',
  superseded: 'reemplazado',
};

// `formatCost` vive en `@/lib/money` (formateador de dinero compartido web-wide); se
// re-exporta aquí para no tocar los consumidores del canvas que ya lo importan de
// `./status` (step-node, step-panel vía formatCostSplit, run-shell). El import además
// lo trae al scope de este módulo para que `formatCostSplit` lo use.
import { formatCost } from '@/lib/money';
export { formatCost };

// Coste observable del step: el REAL si ya se conoce, si no el ESTIMADO con prefijo
// "est.". Compartido por la card del nodo y el panel (misma verdad en ambos).
export function formatCostSplit(
  costActual: number | null | undefined,
  costEstimated: number | null | undefined,
): string {
  return costActual != null ? formatCost(costActual) : `est. ${formatCost(costEstimated)}`;
}

// Handle ids de React Flow (canvas.md §2 regla 8): constantes compartidas por TODOS
// los nodos custom (step + n7-group) — una edge cuyo sourceHandle/targetHandle no
// case con un `<Handle id>` simplemente no se pinta. Un solo sitio evita drift.
export const HANDLE_IN = 'in';
export const HANDLE_OUT = 'out';

// Formatea una duración en ms a un texto corto ("5.1s", "1m 03s", "820ms").
// `null` ⇒ "—".
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${String(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  return `${String(min)}m ${String(sec).padStart(2, '0')}s`;
}
