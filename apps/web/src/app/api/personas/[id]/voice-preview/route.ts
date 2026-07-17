// `POST /api/personas/:id/voice-preview` (T4.6, §8.3): genera (o reutiliza de caché) una MUESTRA DE
// VOZ escuchable para el botón ▶ de CP2/CP3, ANTES de gastar render. Handler fino (api.md §1): parsea
// → valida (idioma) → delega en el servicio de servidor (`generateVoicePreview`) → serializa. La caché
// scoped garantiza que reproducir la muestra N veces NO añade coste (el servicio hace hit sin tocar
// fal ni el ledger).
//
// `withAuth` POR FUERA (barrera real de la API, mono-usuario). El fal-key vive cifrado en `app_setting`
// y el servicio lo descifra; el `<audio src>` del cliente apunta al `GET /api/assets/:id/download`
// existente con el `assetId` que este endpoint devuelve.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { VoicePreviewRequestSchema, VoicePreviewResponseSchema } from '@ugc/core/persona';
import { getDb, getRequestLogger, withRoute } from '@/server';
import { getStorage } from '@/server/storage';
import { generateVoicePreview } from '@/server/voice-preview';
import { withAuth } from '@/server/with-auth';

// pg + fal (red) + filesystem (storage) viven en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Genera/lee datos vivos: jamás se cachea la respuesta HTTP.
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const POST = withAuth(
  withRoute(
    async ({ params, body }) => {
      const result = await generateVoicePreview(
        {
          db: getDb(),
          storage: getStorage(),
          logger: getRequestLogger(),
          // `FAL_BASE_URL` (E2E): ausente en producción → fal real; el fake server del stack lo fija.
          // Se lee del env aquí (borde web); el servicio lo traduce a un `fetch` que reescribe el
          // origen de fal (nunca se lee `FAL_BASE_URL` en core).
          ...(process.env.FAL_BASE_URL !== undefined
            ? { falBaseUrl: process.env.FAL_BASE_URL }
            : {}),
        },
        { personaId: params.id, language: body.language },
      );
      return Response.json(
        VoicePreviewResponseSchema.parse({ assetId: result.assetId, cached: result.cached }),
      );
    },
    { params: ParamsSchema, body: VoicePreviewRequestSchema },
  ),
);
