'use client';

// Nodo compuesto N7 (sub-DAG de generación por variante, §7.2), expandible a sus
// N7a–N7e. La identidad de grupo es el `variantId` del step (`variantId ?? 'N7'`, ver
// `stepsToGraph`): el DAG de demo de F0 (sin variantes) cae en el grupo genérico 'N7'.
// Mismo patrón que step-node (rol/aria/data-status por token) + un botón
// expandir/colapsar (clase `nodrag` — React Flow captura el mousedown si no, canvas.md
// §2 regla 10) que despacha la acción del store.
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';
import type { N7GroupNode } from '../steps-to-graph';
import { nodeTitle } from '../node-titles';
import { statusLabel, visualToneClass, visualBorderClass, HANDLE_IN, HANDLE_OUT } from '../status';

/** Etiqueta corta y legible de la variante que este grupo materializa. El `variantId` es un ULID
 *  (26 chars) — se muestra su cola (los últimos 6, como el título del run en la cabecera) para que sea
 *  reconocible sin ser ilegible. Sin variante (fallback F0), es el sub-DAG genérico «N7». */
function variantLabel(variantId: string | null): string {
  return variantId === null ? 'N7' : `Variante ${variantId.slice(-6)}`;
}

export const N7GroupNodeView = memo(function N7GroupNodeView({ data }: NodeProps<N7GroupNode>) {
  const toggle = useRunStore((s) => s.toggleVariantExpanded);
  const group = data.visualGroup;
  const label = variantLabel(data.variantId);
  return (
    <article
      role="article"
      // El accessible name lleva la CLAVE de grupo CRUDA (`groupKey` = variantId o 'N7'): es la API de
      // los tests (canvas.md §4), como el node_key crudo en step-node. El texto visible es el humano.
      aria-label={`${data.groupKey} ${statusLabel[data.status]} (${String(data.childCount)} nodos)`}
      data-status={data.status}
      data-slot="n7-group-node"
      data-variant-id={data.variantId ?? undefined}
      // `h-full w-full`: el nodo React Flow del grupo lleva height/width EXPLÍCITOS (steps-to-graph,
      // = `groupHeight`), así que la caja VISUAL crece a la altura reservada cuando está expandido y
      // ENVUELVE de verdad la pila de hijos (extent:'parent'). Sin `h-full` el <article> mediría su
      // altura intrínseca (~120 colapsado) y los hijos se saldrían/solaparían (T4.11).
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-lg border bg-surface-2 text-text shadow-sm',
        visualBorderClass[group],
      )}
    >
      <Handle type="target" position={Position.Left} id={HANDLE_IN} />
      {/* `flex-1`: la fila (barra de acento + contenido) ocupa toda la altura del nodo, así la barra
          de tono corre de arriba abajo cuando el grupo está expandido; el contenido queda arriba. */}
      <div className="flex flex-1">
        <span aria-hidden className={cn('w-1 shrink-0', visualToneClass[group])} />
        <div className="min-w-0 flex-1 px-3 py-2.5">
          <header className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-micro font-semibold text-text-3">{label}</span>
            <button
              type="button"
              className="nodrag rounded px-1.5 py-0.5 text-micro text-text-2 hover:bg-surface-3"
              aria-expanded={data.expanded}
              aria-label={`${data.expanded ? 'Colapsar' : 'Expandir'} ${label}`}
              onClick={() => {
                toggle(data.groupKey);
              }}
            >
              {data.expanded ? '−' : '+'}
            </button>
          </header>
          {/* Mismo criterio que step-node (T1.16): el título humano manda (el sub-DAG N7 es
              «Generación de assets», §7.2), la variante es el badge mono de arriba. */}
          <div className="truncate text-mono font-semibold text-text">{nodeTitle('N7')}</div>
          <div className="text-micro text-text-3">{data.childCount} sub-pasos</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id={HANDLE_OUT} />
    </article>
  );
});
