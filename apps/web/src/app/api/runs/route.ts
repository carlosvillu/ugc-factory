// `POST /api/runs` (T0.7b, Apéndice E): crea un run desde una definición de DAG.
// El PRIMER route handler de la app. El contrato real es el efecto transaccional
// (§9.0): INSERT del run + steps y encolado atómico de los roots en la MISMA
// transacción (createRun). El wrapper `withRoute`/`withAuth` completo (ALS,
// envelope de errores, sesión) llega en T0.4; aquí el mínimo: parse Zod en la
// frontera, cableado lazy y mapeo de errores tipados.
import { z } from 'zod';
import { RunDefinitionSchema, InvalidRunDefinitionError, createRun } from '@ugc/core/orchestrator';
import { makeWithTransaction } from '@ugc/db';
import { getRootLogger } from '@/server/logger';
import { getBoss } from '@/server/boss';
import { getDb } from '@/server/db';

// pg + pg-boss viven en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Muta la BD en cada request: jamás se cachea.
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const log = getRootLogger().child({ request_id: requestId, route: '/api/runs' });

  // 1) Parse del body en la frontera (api.md): JSON inválido o shape que no cumple
  //    el contrato ⇒ 400 `validation_error` con details derivados de Zod.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, 'validation_error', 'body JSON inválido');
  }
  const parsed = RunDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      'validation_error',
      'definición de run inválida',
      z.flattenError(parsed.error),
    );
  }

  // 2) Cableado lazy (composition root de web): withTransaction sobre la BD real y
  //    el boss de web (encolado transaccional). Sin conexiones en module scope.
  const boss = await getBoss();
  const withTransaction = makeWithTransaction(getDb(), boss);

  // 3) Creación atómica del run. `InvalidRunDefinitionError` (ciclo/dep colgante/
  //    sin root) ⇒ 400; cualquier otro error sube al 500 genérico.
  try {
    const result = await createRun({ withTransaction }, parsed.data);
    log.info({ run_id: result.runId, steps: result.steps.length }, 'run creado');
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidRunDefinitionError) {
      return errorResponse(400, 'validation_error', err.message);
    }
    log.error({ err }, 'creación de run falló');
    return errorResponse(500, 'internal', 'error interno creando el run');
  }
}

/** Envelope de error del Apéndice E: `{ code, message, details? }`. El wrapper
 *  central que mapea AppError→envelope llega en T0.4; aquí el molde mínimo. */
function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ code, message, ...(details !== undefined && { details }) }, { status });
}
