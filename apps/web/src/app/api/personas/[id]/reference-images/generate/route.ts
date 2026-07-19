// `POST /api/personas/:id/reference-images/generate` (T4.12 pase B): genera reference-images IA de la
// Persona (identity lock §11) — retrato base FLUX.2 → encuadres NB2 ≥2K → persistidos en la persona.
// Handler fino (api.md §1): valida params → delega en `generatePersonaReferenceImages` → serializa.
//
// A diferencia de `POST /api/personas/:id/reference-images` (upload MANUAL de UN fichero, multipart, con
// guard ≥2K sobre lo subido), ESTE genera con fal (gasto real): cada llamada produce output FRESCO (sin
// dedup — es «Generar variación»). El `<img src>` del cliente apunta al `GET /api/assets/:id/download`
// existente con los assetIds que devuelve.
//
// `withAuth` POR FUERA (barrera real de la API, mono-usuario). La fal-key vive cifrada en `app_setting` y
// el servidor la descifra.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { GeneratePersonaImagesResponseSchema } from '@ugc/core/persona';
import { getDb, getRequestLogger, withRoute } from '@/server';
import { getStorage } from '@/server/storage';
import { generatePersonaReferenceImages } from '@/server/persona-generation';
import { withAuth } from '@/server/with-auth';

// pg + fal (red) + filesystem (storage) viven en el runtime Node, no en edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const POST = withAuth(
  withRoute(
    async ({ params }) => {
      const result = await generatePersonaReferenceImages(
        {
          db: getDb(),
          storage: getStorage(),
          logger: getRequestLogger(),
          // `FAL_BASE_URL` (E2E): ausente en producción → fal real; el fake server del stack lo fija.
          ...(process.env.FAL_BASE_URL !== undefined
            ? { falBaseUrl: process.env.FAL_BASE_URL }
            : {}),
        },
        { personaId: params.id },
      );
      return Response.json(GeneratePersonaImagesResponseSchema.parse(result));
    },
    { params: ParamsSchema },
  ),
);
