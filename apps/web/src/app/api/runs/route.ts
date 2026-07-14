// `POST /api/runs` (T0.7b, Apéndice E): crea un run desde una definición de DAG.
// El contrato real es el efecto transaccional (§9.0): INSERT del run + steps y
// encolado atómico de los roots en la MISMA transacción (createRun).
//
// Usa el wrapper completo de T0.4: `withAuth` por fuera (401 antes de parsear el
// body) y `withRoute` por dentro (ALS + request_id, safeParse del body en la
// frontera, mapeo de cualquier throw al envelope `{code,message,details?,request_id}`
// vía toErrorResponse). Así esta ruta ya no lleva molde de error local ni deriva la
// correlación a mano — la comparten todas las rutas.
import { RunDefinitionSchema, InvalidRunDefinitionError, createRun } from '@ugc/core/orchestrator';
import { AppError, RunListQuerySchema, RunListSchema } from '@ugc/core/contracts';
import { listRuns, makeWithTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';

// pg + pg-boss viven en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Muta la BD en cada request: jamás se cachea.
export const dynamic = 'force-dynamic';

// `GET /api/runs` (T1.17, Apéndice E): el LISTADO de runs que pinta la página `/runs`.
// Paginado simple (`?limit&offset`, sin filtros ni búsqueda: eso es el dashboard de T5.10),
// orden DESC por creación.
//
// Handler fino (api.md §1): delega en el repo (`listRuns`) y serializa con el contrato Zod de
// core — el MISMO que valida la página. La query se valida en la frontera vía el schema
// `query` de `withRoute` (`?limit=abc` ⇒ 400 tipado, no 500).
//
// OJO CON LO QUE ESTE ENDPOINT **NO** DEVUELVE: `pipeline_run.status` ni `total_cost_actual`,
// pero por razones DISTINTAS (no las confundas):
//   · `status` — NADIE lo mantiene (deuda viva de T0.8): los runs reales de la BD local dicen
//     `pending` incluidos los que completaron. Por eso se DERIVA de los steps (`deriveRunStatus`).
//   · `total_cost_actual` — desde T1.20 SÍ se mantiene (la recomputa `applyTransition` desde el
//     ledger en cada cierre de step). Aun así el listado agrega del LEDGER: es el original, y la
//     columna una proyección suya, así que las dos pantallas no pueden contradecirse.
// La regla y el porqué, en `run-list.repo.ts` y en `core/contracts/run-list.ts`.
export const GET = withAuth(
  withRoute(
    async ({ query }) => {
      const page = await listRuns(getDb(), query);
      // Serializar = contrato de core (un drift repo↔contrato revienta aquí, en test).
      return Response.json(
        RunListSchema.parse({ ...page, limit: query.limit, offset: query.offset }),
      );
    },
    { query: RunListQuerySchema },
  ),
);

// `withAuth` por fuera (api.md §6): esta ruta NO está en la allowlist, así que un
// request sin sesión válida es 401 JSON tipado ANTES de parsear el body.
export const POST = withAuth(
  withRoute(
    async ({ body }) => {
      // Cableado lazy (composition root de web): withTransaction sobre la BD real y
      // el boss de web (encolado transaccional). Sin conexiones en module scope.
      const boss = await getBoss();
      const withTransaction = makeWithTransaction(getDb(), boss, getRequestLogger());

      // Creación atómica del run. `InvalidRunDefinitionError` (ciclo/dep colgante/
      // sin root) es culpa de la entrada ⇒ 400 validation_error; cualquier otro
      // error sube al 500 opaco de toErrorResponse.
      try {
        const result = await createRun({ withTransaction }, body);
        getRequestLogger().info({ run_id: result.runId, steps: result.steps.length }, 'run creado');
        return Response.json(result, { status: 201 });
      } catch (err) {
        if (err instanceof InvalidRunDefinitionError) {
          throw new AppError('validation_error', err.message);
        }
        throw err;
      }
    },
    { body: RunDefinitionSchema },
  ),
);
