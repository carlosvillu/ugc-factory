'use client';

// Nodo compuesto N7 (sub-DAG por variante), expandible. En F0 el DAG de demo es
// lineal y NO lo ejercita (guard de alcance de T0.11): se implementa por fidelidad
// al contrato de `stepsToGraph`, sin pulir UI que nadie puede ver. Mismo patrón que
// step-node (rol/aria/data-status por token) + un botón expandir/colapsar (clase
// `nodrag` — React Flow captura el mousedown si no, canvas.md §2 regla 10) que
// despacha la acción del store.
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';
import type { N7GroupNode } from '../steps-to-graph';
import { statusLabel, visualToneClass, visualBorderClass, HANDLE_IN, HANDLE_OUT } from '../status';

export const N7GroupNodeView = memo(function N7GroupNodeView({ data }: NodeProps<N7GroupNode>) {
  const toggle = useRunStore((s) => s.toggleVariantExpanded);
  const group = data.visualGroup;
  return (
    <article
      role="article"
      aria-label={`${data.groupKey} ${statusLabel[data.status]} (${String(data.childCount)} nodos)`}
      data-status={data.status}
      data-slot="n7-group-node"
      className={cn(
        'w-56 overflow-hidden rounded-lg border bg-surface-2 text-text shadow-sm',
        visualBorderClass[group],
      )}
    >
      <Handle type="target" position={Position.Left} id={HANDLE_IN} />
      <div className="flex">
        <span aria-hidden className={cn('w-1 shrink-0', visualToneClass[group])} />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <header className="flex items-center justify-between gap-2">
            <span className="font-mono text-micro font-semibold text-text-3">{data.groupKey}</span>
            <button
              type="button"
              className="nodrag rounded px-1.5 py-0.5 text-micro text-text-2 hover:bg-surface-3"
              aria-expanded={data.expanded}
              aria-label={`${data.expanded ? 'Colapsar' : 'Expandir'} ${data.groupKey}`}
              onClick={() => {
                toggle(data.groupKey);
              }}
            >
              {data.expanded ? '−' : '+'}
            </button>
          </header>
          <div className="text-micro text-text-3">{data.childCount} variantes</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id={HANDLE_OUT} />
    </article>
  );
});
