// `PATCH /api/templates/:id/status` — transición de estado del template (draft→review→published,
// §10.2). T3.8.
//
// NOTA DE ALCANCE (§10.2 regla 2 vs T4.12): «ningún template a published sin thumbnail», pero la
// GENERACIÓN de thumbnail es T4.12 (fal). En T3.8 la transición a published se PERMITE sin
// thumbnail: el estado es lo que se maneja aquí; el guard de thumbnail se cablea cuando el
// thumbnail exista (T4.12). Documentado en el journal.
import { z } from 'zod';
import { AppError } from '@ugc/core/contracts';
import { TemplateStatusChangeSchema } from '@ugc/core/gallery';
import { setTemplateStatus } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import { toTemplateDetail } from '@/server/template-response';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: z.string().min(1) });

export const PATCH = withAuth(
  withRoute(
    async ({ params, body }) => {
      const row = await setTemplateStatus(getDb(), params.id, body.status);
      if (!row) throw new AppError('not_found', 'template no encontrado');
      return Response.json(toTemplateDetail(row));
    },
    { params: ParamsSchema, body: TemplateStatusChangeSchema },
  ),
);
