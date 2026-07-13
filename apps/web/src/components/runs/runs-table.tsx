// La tabla del listado de runs (T1.17). Pieza de PRESENTACIÓN pura: recibe las filas ya
// derivadas por la API (`RunListItem[]`, contrato de core) y las pinta. Cero lógica de
// negocio — el estado agregado y el coste los deriva el servidor (`run-list.repo.ts`), que es
// el único sitio que sabe que `pipeline_run.status` no lo mantiene nadie.
//
// Componente de SERVIDOR (sin `'use client'`): no hay estado ni interacción — solo enlaces.
//
// PRIMITIVAS DEL DS, sin tabla a mano: `MetricsTable` (la data grid del DS, con su <table>
// semántico y sus `th[scope=col]`) + `Badge` para el estado. El estado se pinta con los MISMOS
// tonos del canvas (`run-canvas/status.ts`): un run fallido es rojo en la fila Y en su canvas,
// porque la correspondencia estado→tono vive en UN solo sitio.
//
// ALCANCE MÍNIMO DELIBERADO (planning T1.17): sin filtros, sin búsqueda y sin acciones de fila
// — eso es el dashboard completo de T5.10. Aquí solo: ver los runs y llegar a su canvas.
import Link from 'next/link';
import type { RunListItem } from '@ugc/core/contracts';
import { Badge } from '@/components/ui/badge';
import { MetricsTable, type MetricsTableColumn } from '@/components/ui/metrics-table';
import { runStatusLabel, runStatusTone } from '@/components/run-canvas/status';
import { formatCost } from '@/lib/money';

const COLUMNS: MetricsTableColumn[] = [
  { key: 'origin', label: 'Origen', width: '2.4fr' },
  { key: 'status', label: 'Estado', width: '1.2fr' },
  { key: 'step', label: 'Paso', width: '0.8fr', mono: true },
  { key: 'cost', label: 'Coste', width: '0.7fr', align: 'right', mono: true },
  { key: 'createdAt', label: 'Lanzado', width: '1.1fr', mono: true },
];

/** Fecha corta y legible ("13 jul, 09:41"). El ISO del contrato se formatea aquí, una vez. */
function formatLaunchedAt(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * QUÉ se analizó, en una línea. Es la celda que hace útil el listado: sin ella, cada fila sería
 * un ULID opaco y el usuario tendría que abrir los runs de uno en uno para encontrar el suyo.
 *
 * El ENLACE al canvas cuelga de aquí (no de un `onClick` en el `<tr>`): un `<tr>` clicable no
 * es tabulable, no tiene rol de enlace y no se puede abrir en otra pestaña — sería inaccesible
 * y, encima, intesteable por rol. Un `<a>` de verdad da teclado, foco y menú contextual gratis,
 * y su nombre accesible (la URL, o el modo de intake) es exactamente lo que un lector de
 * pantalla necesita oír para elegir fila.
 */
function OriginCell({ run }: { run: RunListItem }) {
  const label =
    run.origin.source === 'url'
      ? run.origin.url
      : run.origin.source === 'manual'
        ? 'Descripción manual'
        : 'Run sin análisis';

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Link
        href={`/runs/${run.id}`}
        data-slot="run-row-link"
        className="truncate text-mono font-medium text-text hover:text-accent focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
      >
        {label}
      </Link>
      {/* El ULID, en pequeño: sigue siendo la identidad real del run (es lo que se pega en un
          informe o se busca en los logs), pero deja de ser LO PRIMERO que se lee. Si el run
          FALLÓ, el motivo desplaza al ULID: para decidir si vale la pena abrir un run muerto,
          «el brief no supera la validación» dice infinitamente más que su id. El error ENTERO
          sigue estando a un click, en el canvas. */}
      {run.error !== null && run.status === 'failed' ? (
        <span className="truncate text-micro text-danger" title={run.error}>
          {run.error}
        </span>
      ) : (
        <span className="truncate font-mono text-micro text-text-4">{run.id}</span>
      )}
    </div>
  );
}

interface RunsTableProps {
  runs: RunListItem[];
}

export function RunsTable({ runs }: RunsTableProps) {
  const rows = runs.map((run) => ({
    // La clave de fila que `renderCell` usa para recuperar el run entero: la tabla del DS pasa
    // `row` (un Record de ReactNode), así que el id viaja como dato y el resto se pinta.
    id: run.id,
    origin: <OriginCell run={run} />,
    status: (
      <Badge
        tone={runStatusTone[run.status]}
        dot
        // El estado CRUDO como `data-status`: la MISMA API observable que los nodos del canvas
        // (los tests miran el ESTADO, nunca el color — el color es verificación visual/CUA).
        // No se pisa el `data-slot="badge"` de la primitiva: es su contrato, no el mío.
        data-status={run.status}
      >
        {runStatusLabel[run.status]}
      </Badge>
    ),
    // El paso que EXPLICA el estado (el que falló, el que espera, el que corre). `—` si el run
    // está completado o recién creado: ahí no hay «paso actual», el run entero es la respuesta.
    step: run.currentStep ?? '—',
    cost: formatCost(run.costActualCents),
    createdAt: formatLaunchedAt(run.createdAt),
  }));

  return <MetricsTable columns={COLUMNS} rows={rows} className="w-full" />;
}
