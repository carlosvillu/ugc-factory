// `POST /api/runs/:id/cancel` (T0.8, §7.1): cancela un run en curso — BARRIDO de
// `cancel` sobre TODOS los steps no-terminales del run en UNA tx (anclaje B: no
// basta cancelar el step "actual"; un step en awaiting_deps/queued sobreviviría y
// el run no quedaría detenido). Muta estado ⇒ withRoute (+ withAuth). `:id` = ULID.
//
// Idempotente: un run ya totalmente terminal (o inexistente) cancela 0 steps y
// devuelve 200 con `cancelled: 0` — cancelar dos veces no es un error.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { cancelRun } from '@ugc/core/orchestrator';
import { makeWithTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const POST = withAuth(
  withRoute(
    async ({ params }) => {
      const boss = await getBoss();
      const withTransaction = makeWithTransaction(getDb(), boss);
      const cancelled = await cancelRun({ withTransaction }, params.id);
      getRequestLogger().info({ run_id: params.id, cancelled }, 'run cancelado');
      return Response.json({ ok: true, cancelled });
    },
    { params: ParamsSchema },
  ),
);
