// `POST /api/variants/:id/publishing/cp5` (T6.2, §preámbulo F6 / §268): gobierna el checkpoint CP5 del flujo
// de publicación en MODO DEGRADADO MANUAL — activar/desactivar el checkpoint, e iniciar/confirmar/reabrir el
// flujo. CP5 es OPCIONAL (§9.7 N10): cuando está ACTIVADO, iniciar el flujo lo PAUSA en `waiting_confirmation`
// y solo confirmar lo reanuda a `confirmed`; desactivado, iniciar va directo a `confirmed` (sin pausa).
//
// La MÁQUINA DE ESTADOS vive en core (`nextPublishState`, PURA y con su control negativo). Esta ruta solo la
// aplica: lee el estado persistido, calcula el siguiente con la regla de core, lo persiste, y devuelve el
// estado completo. NO es un nodo del DAG de generación — no toca el orquestador ni la cola.
import { z } from 'zod';
import { Cp5OpSchema, UlidSchema, nextPublishState } from '@ugc/core/contracts';
import { getPublishingState, setCp5Enabled, setPublishFlowState } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import { assemblePublishingState, requireApprovedLineage } from '@/server/publishing-state';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const POST = withAuth(
  withRoute(
    async ({ params, body }) => {
      const db = getDb();
      // Valida existencia + aprobación de la variante (lanza si no) ANTES de escribir, y REUSA su linaje.
      const lineage = await requireApprovedLineage(db, params.id);

      // Cada rama deja `persisted` = el estado resultante (el `.returning()` del upsert), que se ensambla con
      // el linaje ya en mano — sin re-consultar tras escribir.
      let persisted;
      if (body.op === 'toggle') {
        persisted = await setCp5Enabled(db, params.id, body.enabled);
      } else {
        // `op === 'flow'`: la máquina de estados de core calcula el destino con el `cp5Enabled` y el
        // `flowState` PERSISTIDOS — la pausa (start→waiting_confirmation con CP5 on) es su rama con mordiente.
        const current = await getPublishingState(db, params.id);
        const next = nextPublishState({
          cp5Enabled: current.cp5Enabled,
          current: current.flowState,
          action: body.action,
        });
        persisted = await setPublishFlowState(db, params.id, next);
      }

      return Response.json(assemblePublishingState(lineage, persisted));
    },
    { params: ParamsSchema, body: Cp5OpSchema },
  ),
);
