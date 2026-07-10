'use client';

// Nodo estándar del canvas (N0–N11 hoja). Accesible y testeable: el accessible
// name ES la API de test (canvas.md §4) — `getByRole('article', {name:/N3/i})`.
// El estado se expresa como `data-status` CRUDO (los 13 valores de §7.1: la
// Verificación exige ver failed/skipped distintos) + clases de TOKEN semántico
// (`--status-*` vía success/warning/info/danger); PROHIBIDO color hardcodeado
// (design-system.md). El pulso del checkpoint es la animación de token
// `animate-pulse-ring` disparada por el grupo visual, no un estado React.
//
// memo: excepción documentada de React Flow (canvas.md §2 regla 4) — React Flow
// re-renderiza su lista interna de nodos en cada pan/zoom. No copies memo fuera de
// nodes/.
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { StepNode } from '../steps-to-graph';
import {
  formatCostSplit,
  formatDuration,
  statusLabel,
  visualToneClass,
  visualBorderClass,
  HANDLE_IN,
  HANDLE_OUT,
} from '../status';

export const StepNodeView = memo(function StepNodeView({ data, selected }: NodeProps<StepNode>) {
  const group = data.visualGroup;
  const isCheckpoint = group === 'checkpoint';
  const isRunning = group === 'running';
  const costActual = data.costActual;
  const costEstimated = data.costEstimated;
  return (
    <article
      // rol explícito: es la query de los tests, no dependas del rol implícito.
      role="article"
      aria-label={`${data.nodeKey} ${statusLabel[data.status]}`}
      data-status={data.status}
      data-visual-group={group}
      data-slot="step-node"
      className={cn(
        'w-56 overflow-hidden rounded-lg border bg-surface text-text shadow-sm',
        visualBorderClass[group],
        // El halo/pulso de atención en checkpoint y running (token, respeta
        // prefers-reduced-motion vía globals.css).
        (isCheckpoint || isRunning) && 'pulse-ring-static animate-pulse-ring',
        selected && 'ring-2 ring-accent',
      )}
    >
      <Handle type="target" position={Position.Left} id={HANDLE_IN} />
      {/* barra de acento por token (mismo criterio que la card de TD.5) */}
      <div className="flex">
        <span aria-hidden className={cn('w-1 shrink-0', visualToneClass[group])} />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <header className="mb-1.5 flex items-center justify-between gap-2">
            <span
              className={cn(
                'font-mono text-micro font-semibold',
                isCheckpoint ? 'text-warning' : 'text-text-3',
              )}
            >
              {data.nodeKey}
            </span>
            {isRunning ? (
              <span
                aria-hidden
                className="inline-block size-2.75 animate-spin rounded-full border-2 border-info border-t-transparent"
              />
            ) : (
              <span aria-hidden className={cn('size-1.75 rounded-full', visualToneClass[group])} />
            )}
          </header>
          <div className="mb-0.5 text-mono font-medium text-text-2">{statusLabel[data.status]}</div>
          {data.outputExcerpt ? (
            <p
              data-slot="node-output"
              className="mb-1 truncate text-micro text-text-3"
              title={data.outputExcerpt}
            >
              {data.outputExcerpt}
            </p>
          ) : null}
          <footer className="flex justify-between font-mono text-micro text-text-3">
            <span data-slot="node-duration">{formatDuration(data.durationMs)}</span>
            <span className="text-text-2" data-slot="node-cost">
              {formatCostSplit(costActual, costEstimated)}
            </span>
          </footer>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id={HANDLE_OUT} />
    </article>
  );
});
