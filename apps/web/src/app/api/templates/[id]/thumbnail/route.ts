// `POST /api/templates/:id/thumbnail` (T4.12): genera la MINIATURA-IMAGEN de galería de un template
// con fal (flux-2 t2i) y la asocia a `prompt_template.thumbnail_asset_id`. Es la pieza que habilita la
// promoción a `published` (§10.2 regla 2: «ningún template a published sin thumbnail», guard cableado
// en `PATCH /api/templates/:id/status`). Handler fino: valida params → delega en
// `generateTemplateThumbnailImage` → serializa `{assetId, reused, costCents}`.
//
// `withAuth` POR FUERA. Idempotente por el dedup de producción de `runGenerate`: re-generar el
// thumbnail de un template no cambiado reutiliza el asset (0 coste) y re-estampa el mismo id.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { getDb, getRequestLogger, withRoute } from '@/server';
import { getStorage } from '@/server/storage';
import { generateTemplateThumbnailImage } from '@/server/template-generation';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
const ResponseSchema = z.object({
  assetId: z.string(),
  reused: z.boolean(),
  costCents: z.number().int().nonnegative(),
});

export const POST = withAuth(
  withRoute(
    async ({ params }) => {
      const result = await generateTemplateThumbnailImage(
        {
          db: getDb(),
          storage: getStorage(),
          logger: getRequestLogger(),
          ...(process.env.FAL_BASE_URL !== undefined
            ? { falBaseUrl: process.env.FAL_BASE_URL }
            : {}),
        },
        { templateId: params.id },
      );
      return Response.json(ResponseSchema.parse(result));
    },
    { params: ParamsSchema },
  ),
);
