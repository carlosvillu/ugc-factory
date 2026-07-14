// `POST /api/steps/:id/edit` (T0.8, §7.1.b): edita y aprueba un step en
// `waiting_approval` — el usuario reemplaza los artefactos de la IA
// (`output_refs`) por los suyos, se aprueba, se INVALIDA el sub-grafo aguas abajo
// (§7.1.c: filas nuevas con supersedes_id, las antiguas → superseded) y se escribe
// el diff IA-vs-editado en `audit_log` (§19.1). Muta estado ⇒ withRoute (+ withAuth).
//
// Body — DOS formas, y la distinción importa:
//   - `{ outputRefs }` (T0.8): el editor JSON GENÉRICO del panel del canvas. El artefacto viaja
//     tal cual, opaco. Sirve para cualquier nodo.
//   - `{ brief }`     (T1.10b): la edición TIPADA del checkpoint del brief (CP1). El body es el
//     ProductBrief entero (validado contra su schema — la BD guarda jsonb opaco, así que esta es
//     la única frontera que impide persistir un brief con forma inválida). El handler crea la
//     versión v2 en `product_brief` (`approved`, `edited_by_user:true`) y construye el
//     `output_refs` editado apuntando a ella, ANTES de llamar a `editStep`.
//
// El MECANISMO de checkpoint sigue siendo UNO (`editStep` de core): lo que cambia es quién
// prepara el artefacto. El efecto de dominio (versionar el brief) se compone fuera del
// orquestador — ver `server/brief-checkpoint.ts` — pero DENTRO DE SU MISMA TRANSACCIÓN
// (`withDomainTransaction`): si `editStep` falla tras crear la v2 (doble clic, run cancelado
// entre medias, step ya no en `waiting_approval`), la v2 quedaría HUÉRFANA — una versión que
// ningún step referencia, que quema un número de versión y que el lector futuro de "el brief
// actual de este producto" (F2) se llevaría creyendo que el usuario la aprobó. Invertir el orden
// no vale: `editStep` NECESITA el `briefId` de la v2 para escribirlo en el `output_refs`. Una
// tx: o las dos mitades, o ninguna.
import { z } from 'zod';
import {
  AppError,
  CheckpointDecisionSchema,
  ProductBriefSchema,
  UlidSchema,
} from '@ugc/core/contracts';
import { editStep } from '@ugc/core/orchestrator';
import { findStep, withDomainTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { createEditedBriefVersion } from '@/server/brief-checkpoint';
import { persistCheckpointDecision } from '@/server/checkpoint-decision';
import { withAuth } from '@/server/with-auth';
import { toCheckpointError } from '../checkpoint-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
// Las DOS formas son MUTUAMENTE EXCLUYENTES, y el schema lo IMPONE (una unión, no dos opcionales
// en el mismo objeto): con `{outputRefs, brief}` a la vez, uno de los dos pisaría al otro EN
// SILENCIO y el usuario perdería su edición sin un solo error. Un body que trae las dos es un
// caller confundido ⇒ 400, no una precedencia inventada.
//
//  - `{ outputRefs }` (T0.8): el editor JSON genérico del panel del canvas. Artefacto opaco.
//    `.optional()` dentro de su rama para que `{}` siga siendo válido (aprobar-con-edición-nula).
//  - `{ brief }`      (T1.10b): la edición TIPADA de CP1 (ProductBrief entero).
//
// T1.11 — `decision` (opcional) es ORTOGONAL a las dos formas: el mismo checkpoint que edita un
// artefacto puede además DECIDIR algo (en CP1, el usuario del modo manual elige packshot-IA y
// además corrige un hook antes de guardar). Por eso viaja en las DOS ramas y no en una tercera.
const DecisionField = { decision: CheckpointDecisionSchema.optional() };
const BodySchema = z.union([
  z.strictObject({ brief: ProductBriefSchema, outputRefs: z.never().optional(), ...DecisionField }),
  z.strictObject({
    outputRefs: z.unknown().optional(),
    brief: z.never().optional(),
    ...DecisionField,
  }),
]);

export const POST = withAuth(
  withRoute(
    async ({ params, body }) => {
      const db = getDb();
      const boss = await getBoss();

      try {
        await withDomainTransaction(
          db,
          boss,
          getRequestLogger(),
          async ({ db: tx, withTransaction }) => {
            // CP1: el body trae un ProductBrief tipado ⇒ se versiona (v2) y el artefacto editado
            // del step pasa a referenciar esa versión nueva. El resto de nodos siguen por el canal
            // opaco.
            let editedOutputRefs: unknown = body.outputRefs;
            if (body.brief !== undefined) {
              const step = await findStep(tx, params.id);
              if (step === undefined) throw new AppError('not_found', 'step no encontrado');
              try {
                editedOutputRefs = await createEditedBriefVersion(tx, step.outputRefs, body.brief);
              } catch (err) {
                // El step no es un checkpoint de brief (o su brief no existe): no es un 500 opaco,
                // es una petición mal dirigida. `AppError` cruza el catch de fuera intacto
                // (`toCheckpointError` solo traduce los errores del orquestador).
                throw new AppError(
                  'validation_error',
                  err instanceof Error ? err.message : 'el step no admite una edición de brief',
                );
              }
            }

            await editStep({ withTransaction }, params.id, editedOutputRefs);
            // T1.11 — la DECISIÓN del checkpoint (si la hubo), en la MISMA tx: si `editStep` lanza,
            // ni versión nueva del brief, ni transición, ni decisión. No-op sin `decision`.
            await persistCheckpointDecision(tx, params.id, body.decision);
          },
        );
      } catch (err) {
        throw toCheckpointError(err);
      }

      getRequestLogger().info(
        { step_id: params.id, decision_kind: body.decision?.kind },
        'checkpoint editado + sub-grafo invalidado',
      );
      return Response.json({ ok: true });
    },
    { params: ParamsSchema, body: BodySchema },
  ),
);
