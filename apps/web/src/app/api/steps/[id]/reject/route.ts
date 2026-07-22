// `POST /api/steps/:id/reject` (T0.8, §7.1.b): rechaza un step en
// `waiting_approval` — `reject` → `rejected` (terminal). Los dependientes quedan
// varados en `awaiting_deps` a propósito (una rama rechazada no continúa). Escribe
// auditoría del rechazo (§19.1). Muta estado ⇒ withRoute (+ withAuth).
//
// T5.5c — EFECTO DE DOMINIO EN EL RECHAZO (CP4): rechazar es, para la mayoría de checkpoints, solo mover
// el step a `rejected`. CP4 (QA, N9) es el PRIMERO que además tiene un efecto de dominio al rechazar: la
// variante del máster pasa a `ad_variant.status='rejected'` (§9.0). Por eso este route deja de ser el
// `rejectStep` genérico pelado y adopta `withDomainTransaction` (como el de approve): la transición del
// step y el status de la variante commitean JUNTOS o nada. Si el status se escribiera fuera de la tx y la
// transición fallara (409: el step ya no está en `waiting_approval`), la variante quedaría `rejected` sobre
// un step no rechazado — dos verdades del mismo veredicto. El efecto se RESUELVE por la forma del artefacto
// (`applyDomainEffectOnReject`): un checkpoint sin efecto de rechazo (CP1/CP2/CP3, demo) es un no-op.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { rejectStep } from '@ugc/core/orchestrator';
import { findStep, withDomainTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { applyDomainEffectOnReject } from '@/server/domain-effects';
import { withAuth } from '@/server/with-auth';
import { toCheckpointError } from '../checkpoint-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const POST = withAuth(
  withRoute(
    async ({ params }) => {
      const db = getDb();
      const boss = await getBoss();

      try {
        await withDomainTransaction(
          db,
          boss,
          getRequestLogger(),
          async ({ db: tx, withTransaction }) => {
            // El artefacto se lee ANTES de rechazar: `rejectStep` no lo devuelve, y tras la transición el
            // `output_refs` es el mismo (rechazar no lo toca).
            const step = await findStep(tx, params.id);
            await rejectStep({ withTransaction }, params.id);
            // EL EFECTO DE DOMINIO del RECHAZO, resuelto por la FORMA del artefacto: CP4 (QA) marca la
            // variante `rejected`. No-op para cualquier otro step. Dentro de la MISMA tx que la transición.
            await applyDomainEffectOnReject(tx, step?.outputRefs);
          },
        );
      } catch (err) {
        throw toCheckpointError(err);
      }
      getRequestLogger().info({ step_id: params.id }, 'checkpoint rechazado');
      return Response.json({ ok: true });
    },
    { params: ParamsSchema },
  ),
);
