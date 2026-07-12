// `GET /api/steps/:id` (T1.10b): el step COMPLETO, con su `output_refs` ENTERO.
//
// POR QUÉ NO BASTA EL SSE. La proyección del stream (`sseColumns`/`toStepSnapshot`) manda un
// `outputExcerpt` RECORTADO A 200 CARACTERES — a propósito: un artefacto puede ser un jsonb
// enorme y el frame SSE no es sitio para arrastrarlo (T0.10). Ese recorte le basta al canvas
// ("hay artefacto") y al visor genérico del panel, pero NO a CP1: el editor de brief necesita
// el ProductBrief ENTERO (todos los ángulos, sus hooks, las evidencias) y los warnings tipados
// para poder editarlo campo a campo. Cortarlo a 200 caracteres sería editar un brief truncado.
//
// Lectura pura ⇒ sin boss ni transacción.
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { findStep } from '@ugc/db';
import { withRoute, getDb } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const step = await findStep(getDb(), params.id);
      if (step === undefined) throw new AppError('not_found', 'step no encontrado');
      return Response.json({
        id: step.id,
        runId: step.runId,
        nodeKey: step.nodeKey,
        status: step.status,
        isCheckpoint: step.isCheckpoint,
        // El artefacto COMPLETO (jsonb opaco): quien lo consume lo valida contra SU contrato
        // (CP1 lo parsea con `N3OutputSchema`). El servidor no adivina qué nodo es.
        outputRefs: step.outputRefs ?? null,
      });
    },
    { params: ParamsSchema },
  ),
);
