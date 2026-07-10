// `POST /api/steps/:id/approve` (T0.8, §7.1.b): aprueba un step en
// `waiting_approval` SIN cambios — reanuda el run con los artefactos de la IA
// intactos y escribe una fila de auditoría (§19.1). Muta estado ⇒ withRoute (+
// withAuth por fuera). `:id` = ULID.
//
// La lógica vive en core (`approveStep`, §9.0): el handler solo parsea `:id`,
// cablea el withTransaction y mapea los errores del orquestador al envelope.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { approveStep } from '@ugc/core/orchestrator';
import { makeWithTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';
import { toCheckpointError } from '../checkpoint-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const POST = withAuth(
  withRoute(
    async ({ params }) => {
      const boss = await getBoss();
      const withTransaction = makeWithTransaction(getDb(), boss);
      try {
        await approveStep({ withTransaction }, params.id);
      } catch (err) {
        throw toCheckpointError(err);
      }
      getRequestLogger().info({ step_id: params.id }, 'checkpoint aprobado');
      return Response.json({ ok: true });
    },
    { params: ParamsSchema },
  ),
);
