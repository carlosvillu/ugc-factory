// `POST /api/templates/:id/test` (T4.12): genera (o reutiliza de caché) una IMAGEN DE PRUEBA de un
// template para el botón «Probar template» de la ficha, ANTES de comprometer un run. Handler fino
// (api.md §1): valida params → delega en `generateTemplateTestImage` → serializa. La caché scoped
// (`template_test=true`) garantiza que probar N veces NO añade coste (cache-hit sin tocar fal ni el
// ledger). SOLO templates `kind:'image'` (el servidor rechaza los de vídeo con `validation_error`).
//
// `withAuth` POR FUERA (barrera real de la API, mono-usuario). La fal-key vive cifrada en `app_setting`
// y el servidor la descifra; el `<img src>` del cliente apunta al `GET /api/assets/:id/download`
// existente con el `assetId` que este endpoint devuelve.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { TemplateTestResultSchema } from '@ugc/core/gallery';
import { getDb, getRequestLogger, withRoute } from '@/server';
import { getStorage } from '@/server/storage';
import { generateTemplateTestImage } from '@/server/template-generation';
import { withAuth } from '@/server/with-auth';

// pg + fal (red) + filesystem (storage) viven en el runtime Node, no en edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const POST = withAuth(
  withRoute(
    async ({ params }) => {
      const result = await generateTemplateTestImage(
        {
          db: getDb(),
          storage: getStorage(),
          logger: getRequestLogger(),
          // `FAL_BASE_URL` (E2E): ausente en producción → fal real; el fake server del stack lo fija.
          ...(process.env.FAL_BASE_URL !== undefined
            ? { falBaseUrl: process.env.FAL_BASE_URL }
            : {}),
        },
        { templateId: params.id },
      );
      return Response.json(TemplateTestResultSchema.parse(result));
    },
    { params: ParamsSchema },
  ),
);
