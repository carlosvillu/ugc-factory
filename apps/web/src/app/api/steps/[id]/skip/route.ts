// `POST /api/steps/:id/skip` (T0.8, §7.1): salta un step skippable — `skip` →
// `skipped`. El nodo saltado cuenta como dep RESUELTA (T0.8), así que sus
// dependientes avanzan y el run puede completar. Muta estado ⇒ withRoute (+ withAuth).
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { skipStep } from '@ugc/core/orchestrator';
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
        await skipStep({ withTransaction }, params.id);
      } catch (err) {
        throw toCheckpointError(err);
      }
      getRequestLogger().info({ step_id: params.id }, 'step saltado');
      return Response.json({ ok: true });
    },
    { params: ParamsSchema },
  ),
);
