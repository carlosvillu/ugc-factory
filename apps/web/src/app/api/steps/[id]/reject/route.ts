// `POST /api/steps/:id/reject` (T0.8, §7.1.b): rechaza un step en
// `waiting_approval` — `reject` → `rejected` (terminal). Los dependientes quedan
// varados en `awaiting_deps` a propósito (una rama rechazada no continúa). Escribe
// auditoría del rechazo (§19.1). Muta estado ⇒ withRoute (+ withAuth).
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { rejectStep } from '@ugc/core/orchestrator';
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
      const withTransaction = makeWithTransaction(getDb(), boss, getRequestLogger());
      try {
        await rejectStep({ withTransaction }, params.id);
      } catch (err) {
        throw toCheckpointError(err);
      }
      getRequestLogger().info({ step_id: params.id }, 'checkpoint rechazado');
      return Response.json({ ok: true });
    },
    { params: ParamsSchema },
  ),
);
