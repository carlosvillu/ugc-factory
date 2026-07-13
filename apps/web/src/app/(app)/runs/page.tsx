// Página `/runs` (T1.17): el LISTADO de runs. RSC delgado (architecture.md §1.3), mismo molde
// que `/spend`: fetch del listado vía api-server (cookie de sesión) → componer la tabla.
//
// POR QUÉ EXISTE (planning T1.17, «Origen»): hasta ahora, tras lanzar un run no había forma de
// VOLVER a él ni de ver los anteriores — solo existía `/runs/[id]`, y solo se llegaba pegando
// el ULID en la barra de direcciones. Un pipeline que no se puede reabrir no se puede usar.
//
// ESTÁTICO AL CARGAR (NO SSE): la lista es una foto del servidor en cada carga, no un stream.
// El SSE es del CANVAS de UN run (`/runs/:id`), donde miras UN pipeline avanzar; abrir N streams
// —uno por fila— para animar una tabla sería pagar una conexión pg en LISTEN por run listado.
// Quien quiere ver un run moverse, entra en él.
//
// ALCANCE MÍNIMO DELIBERADO: sin filtros, sin búsqueda, sin acciones de fila — eso es el
// dashboard completo (T5.10). Aquí solo: ver qué runs hay, en qué estado están, qué costaron, y
// llegar a su canvas de un click.
import type { Metadata } from 'next';
import { RunListSchema } from '@ugc/core/contracts';
import { api } from '@/lib/api-server';
import { EmptyState } from '@/components/ui/empty-state';
import { RunsTable } from '@/components/runs/runs-table';

export const metadata: Metadata = {
  title: 'Runs · UGC Factory',
  description: 'Los pipelines lanzados: estado, coste y acceso a su canvas',
};

// Lee la BD (vía /api/runs) en cada carga: dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  // El estado y el coste de cada run los DERIVA el servidor (de los steps y del ledger): las
  // columnas `pipeline_run.status`/`total_cost_actual` no las mantiene nadie. Ver
  // `packages/db/src/repos/run-list.repo.ts`.
  const { runs, total } = await api.get('/api/runs', RunListSchema);

  return (
    <main className="mx-auto flex max-w-(--content-max) flex-col gap-6 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Runs</h1>
        <p className="max-w-2xl text-body text-text-2">
          {total === 0
            ? 'Los pipelines que lances aparecerán aquí.'
            : `${String(total)} ${total === 1 ? 'pipeline lanzado' : 'pipelines lanzados'}. Entra en cualquiera para ver su canvas.`}
        </p>
      </header>

      {runs.length === 0 ? (
        // El vacío tiene su primitiva del DS: no un `<p>` suelto. La acción lleva a la puerta
        // real por la que nace un run (el intake), que es lo único accionable estando aquí.
        <EmptyState
          title="Aún no hay runs"
          description="Lanza un análisis desde el intake y su pipeline aparecerá en esta lista."
        />
      ) : (
        <RunsTable runs={runs} />
      )}
    </main>
  );
}
