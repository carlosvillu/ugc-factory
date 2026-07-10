// `POST /api/steps/:id/edit` (T0.8, §7.1.b): edita y aprueba un step en
// `waiting_approval` — el usuario reemplaza los artefactos de la IA
// (`output_refs`) por los suyos, se aprueba, se INVALIDA el sub-grafo aguas abajo
// (§7.1.c: filas nuevas con supersedes_id, las antiguas → superseded) y se escribe
// el diff IA-vs-editado en `audit_log` (§19.1). Muta estado ⇒ withRoute (+ withAuth).
//
// Body: `{ outputRefs }` — los artefactos editados (jsonb opaco). La lógica vive en
// core (`editStep`); el handler parsea y cablea.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { editStep } from '@ugc/core/orchestrator';
import { makeWithTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';
import { toCheckpointError } from '../checkpoint-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
// `outputRefs` es un jsonb opaco (los artefactos editados). `.optional()` para que
// un body vacío sea válido (aprobar-con-edición-nula); la semántica del shape la
// fija cada tipo de nodo en F2+.
const BodySchema = z.object({ outputRefs: z.unknown().optional() });

export const POST = withAuth(
  withRoute(
    async ({ params, body }) => {
      const boss = await getBoss();
      const withTransaction = makeWithTransaction(getDb(), boss);
      try {
        await editStep({ withTransaction }, params.id, body.outputRefs);
      } catch (err) {
        throw toCheckpointError(err);
      }
      getRequestLogger().info({ step_id: params.id }, 'checkpoint editado + sub-grafo invalidado');
      return Response.json({ ok: true });
    },
    { params: ParamsSchema, body: BodySchema },
  ),
);
