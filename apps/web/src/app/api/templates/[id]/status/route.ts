// `PATCH /api/templates/:id/status` — transición de estado del template (draft→review→published,
// §10.2). T3.8; guard de thumbnail cableado en T4.12.
//
// GUARD §10.2 regla 2 (T4.12): «ningún template a published sin thumbnail». El invariante lo hace
// cumplir `setTemplateStatus` en la BD (lee bajo lock + decide en la misma tx): si se intenta publicar
// un template sin `thumbnail_asset_id`, lanza `AppError('validation_error')` que `withRoute` mapea al
// envelope 400 del Apéndice E. Antes (T3.8) la generación de thumbnail no existía y la transición se
// permitía sin él; T4.12 trajo la generación (`generateTemplateThumbnail`) y con ella este guard.
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
