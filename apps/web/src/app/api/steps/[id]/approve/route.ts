// `POST /api/steps/:id/approve` (T0.8, §7.1.b): aprueba un step en
// `waiting_approval` SIN cambios — reanuda el run con los artefactos de la IA
// intactos y escribe una fila de auditoría (§19.1). Muta estado ⇒ withRoute (+
// withAuth por fuera). `:id` = ULID.
//
// La lógica vive en core (`approveStep`, §9.0): el handler solo parsea `:id`,
// cablea el withTransaction y mapea los errores del orquestador al envelope.
//
// T1.10b — EFECTO DE DOMINIO: si el step aprobado es el checkpoint del BRIEF (CP1, N3), su
// `product_brief` v1 pasa de `draft` a `approved`. Aprobar SIN editar NO crea una versión nueva
// (ver `server/brief-checkpoint.ts`): un v2 idéntico al v1 con `edited_by_user:true` mentiría
// sobre quién escribió ese contenido. El efecto se compone AQUÍ, fuera del orquestador genérico
// —que no sabe de briefs y no debe saberlo—, y no-opea para cualquier otro tipo de step.
//
// ATÓMICO con la transición (`withDomainTransaction`), y esto es CORRECCIÓN, no elegancia: si el
// efecto de dominio corriese DESPUÉS y fallase, `approveStep` ya habría commiteado —el run ya ha
// REANUDADO aguas abajo— y el brief se quedaría en `draft` PARA SIEMPRE, sin forma de arreglarlo
// (un segundo POST da IllegalTransitionError: el step ya no está en `waiting_approval`). El
// usuario habría aprobado y su brief figuraría como borrador. Dentro de UNA tx: o las dos
// mitades, o ninguna, y reintentar es seguro.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { approveStep } from '@ugc/core/orchestrator';
import { findStep, withDomainTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { approveBriefForStep } from '@/server/brief-checkpoint';
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
        await withDomainTransaction(db, boss, async ({ db: tx, withTransaction }) => {
          // El artefacto se lee ANTES de aprobar: `approveStep` no lo devuelve, y tras la
          // transición el `output_refs` es el mismo (aprobar sin editar no lo toca).
          const step = await findStep(tx, params.id);
          await approveStep({ withTransaction }, params.id);
          // No-op si el step no es CP1 (se discrimina por SCHEMA del artefacto).
          await approveBriefForStep(tx, step?.outputRefs);
        });
      } catch (err) {
        throw toCheckpointError(err);
      }

      getRequestLogger().info({ step_id: params.id }, 'checkpoint aprobado');
      return Response.json({ ok: true });
    },
    { params: ParamsSchema },
  ),
);
