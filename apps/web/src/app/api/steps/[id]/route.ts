// `GET /api/steps/:id` (T1.10b): el step COMPLETO, con su `output_refs` ENTERO.
//
// POR QUÉ NO BASTA EL SSE. La proyección del stream (`sseColumns`/`toStepSnapshot`) manda un
// `outputExcerpt` RECORTADO A 200 CARACTERES — a propósito: un artefacto puede ser un jsonb
// enorme y el frame SSE no es sitio para arrastrarlo (T0.10). Ese recorte le basta al canvas
// ("hay artefacto") y al visor genérico del panel, pero NO a CP1: el editor de brief necesita
// el ProductBrief ENTERO (todos los ángulos, sus hooks, las evidencias) y los warnings tipados
// para poder editarlo campo a campo. Cortarlo a 200 caracteres sería editar un brief truncado.
//
// Lectura pura ⇒ sin boss ni transacción.
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { findStepDetail } from '@ugc/db';
import { withRoute, getDb } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

/**
 * Mensaje de error PELADO (T1.16). El consumer persiste el error como `{ message: string }`
 * (step-execute.ts), y el recorte del SSE (`errorExcerptOf`) ya extrae ese `message` para que
 * el visor muestre "N3: config inválida: …" y no `{"message":"…"}` con llaves JSON. Aquí se
 * aplica el MISMO criterio, pero SIN recortar: mismo texto, entero. Un shape inesperado cae al
 * serializado genérico en vez de perderse.
 */
function errorMessageOf(error: unknown): string | null {
  if (error == null) return null;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return JSON.stringify(error);
}

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const step = await findStepDetail(getDb(), params.id);
      if (step === undefined) throw new AppError('not_found', 'step no encontrado');
      return Response.json({
        id: step.id,
        runId: step.runId,
        nodeKey: step.nodeKey,
        status: step.status,
        isCheckpoint: step.isCheckpoint,
        // El artefacto COMPLETO (jsonb opaco): quien lo consume lo valida contra SU contrato
        // (CP1 lo parsea con `N3OutputSchema`). El servidor no adivina qué nodo es.
        outputRefs: step.outputRefs ?? null,
        // El error COMPLETO (T1.16): el `errorExcerpt` del SSE lo trunca a 200 caracteres, y
        // los errores que de verdad importan son largos (el `PermanentStepError` de N3 lleva
        // el volcado de issues de Zod: cortado, el usuario ve el prefijo y ningún issue). El
        // visor modal del inspector lo pide por aquí. `null` si el step no falló.
        error: errorMessageOf(step.error),
      });
    },
    { params: ParamsSchema },
  ),
);
