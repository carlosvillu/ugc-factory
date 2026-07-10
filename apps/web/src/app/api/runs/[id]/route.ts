// `GET /api/runs/:id` + `PATCH /api/runs/:id` (T0.11): la fuente REST del objeto
// RUN de la página `/runs/[id]`. El SSE (`.../events`) alimenta los STEPS; este
// endpoint alimenta el RUN (autopilot para el toggle de cabecera, kind/status/id).
// Split deliberado: el snapshot SSE es `{runId, steps}` — NO porta el objeto run
// (§9.0), así que los campos de nivel run (autopilot) llegan y se mutan por REST.
//
// GET: lee la fila del run (404 si no existe). Lectura ⇒ NO necesita boss/tx.
// PATCH: muta `autopilot` (toggle de cabecera). En T0.8 el autopilot era inmutable;
// el canvas exige activarlo/desactivarlo en vivo (Verificación: "activar autopilot
// y ver el run completar sin pausas, con el candado alwaysPause respetado").
// `shouldPause` (core) relee el autopilot en cada checkpoint AÚN NO alcanzado, así
// que este UPDATE afecta a los checkpoints por venir. NO toca los steps.
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { findRun, updateRunAutopilot } from '@ugc/db';
import { withRoute, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
const PatchBodySchema = z.object({ autopilot: z.boolean() });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const run = await findRun(getDb(), params.id);
      if (run === undefined) throw new AppError('not_found', 'run no encontrado');
      // Serializa las fechas a ISO (JSON no tiene Date): la UI las parsea si las
      // necesita; en F0 la cabecera solo usa autopilot/kind/status/id.
      return Response.json({
        id: run.id,
        projectId: run.projectId,
        kind: run.kind,
        autopilot: run.autopilot,
        status: run.status,
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        totalCostEstimated: run.totalCostEstimated,
        totalCostActual: run.totalCostActual,
      });
    },
    { params: ParamsSchema },
  ),
);

export const PATCH = withAuth(
  withRoute(
    async ({ params, body }) => {
      const affected = await updateRunAutopilot(getDb(), params.id, body.autopilot);
      if (affected === 0) throw new AppError('not_found', 'run no encontrado');
      getRequestLogger().info(
        { run_id: params.id, autopilot: body.autopilot },
        'autopilot del run actualizado',
      );
      return Response.json({ ok: true, autopilot: body.autopilot });
    },
    { params: ParamsSchema, body: PatchBodySchema },
  ),
);
