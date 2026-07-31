// `GET|PATCH /api/variants/:id/publishing` (T6.2, §15.4 / §preámbulo F6): el estado de PUBLICACIÓN de una
// variante aprobada — el checklist de compliance marcable, la elegibilidad de la opción Spark (§14 pt 2) y
// el estado del checkpoint CP5. Es lo que el panel de publicación de `/library` renderiza.
//
//   · GET   · devuelve el `PublishingState` completo (checklist con `done`, spark, cp5).
//   · PATCH · MARCA/desmarca UN ítem del checklist y devuelve el estado resultante (trabajo NUEVO de F6:
//             el bundle emitía los pasos, marcarlos «hechos» no se persistía).
//
// Lectura/escritura simple ⇒ sin boss ni transacción del orquestador (no es el DAG de generación; CP5 aquí
// es una confirmación del FLUJO de publicación, no un nodo). `withAuth` por fuera, `withRoute` por dentro.
import { z } from 'zod';
import { MarkChecklistItemSchema, UlidSchema } from '@ugc/core/contracts';
import { markChecklistItem } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import {
  assemblePublishingState,
  loadPublishingState,
  requireApprovedLineage,
} from '@/server/publishing-state';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const state = await loadPublishingState(getDb(), params.id);
      return Response.json(state);
    },
    { params: ParamsSchema },
  ),
);

export const PATCH = withAuth(
  withRoute(
    async ({ params, body }) => {
      const db = getDb();
      // Valida que la variante existe y está aprobada (lanza si no) ANTES de escribir, y REUSA su linaje.
      const lineage = await requireApprovedLineage(db, params.id);
      // El upsert devuelve el estado persistido resultante (`.returning()`): se ensambla con el linaje ya en
      // mano, sin re-consultar. La respuesta es la misma forma que el GET (la UI no re-consulta).
      const persisted = await markChecklistItem(db, params.id, body.itemId, body.done);
      return Response.json(assemblePublishingState(lineage, persisted));
    },
    { params: ParamsSchema, body: MarkChecklistItemSchema },
  ),
);
