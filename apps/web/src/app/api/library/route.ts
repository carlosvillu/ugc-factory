// `GET /api/library` (T5.7, §9.7 N10): la lista de variantes APROBADAS de la biblioteca `/library`, con
// filtros por objetivo del lote, idioma y plataforma. Handler FINO (api.md §1): parsear el querystring →
// delegar en `listLibraryVariants` → serializar con el schema que re-valida el api-client.
//
// SOLO lectura ⇒ sin boss ni transacción. `withAuth` por fuera (la barrera real, api.md §6); `withRoute` por
// dentro (valida el querystring en la frontera). El `destination` de cada fila sale del jsonb `ad_batch.matrix`
// (§14, modelado mínimo de T5.7): el repo ya hace el COALESCE a 'organic'.
import { z } from 'zod';
import { LibraryListSchema } from '@ugc/core/contracts';
import { listLibraryVariants } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El querystring de los filtros: objetivo/idioma/plataforma, todos opcionales (sin filtro = todas). */
const LibraryQuerySchema = z.object({
  objective: z.enum(['hook_test', 'conversion', 'story']).optional(),
  language: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
});

export const GET = withAuth(
  withRoute(
    async ({ query }) => {
      const rows = await listLibraryVariants(getDb(), {
        objective: query.objective,
        language: query.language,
        platform: query.platform,
      });
      // Serializar con el contrato (el api-client lo re-valida). El repo devuelve `Date` en `createdAt`;
      // aquí NO se expone (la lista no lo usa) — solo los campos de la tarjeta + los filtrables.
      return Response.json(
        LibraryListSchema.parse({
          variants: rows.map((r) => ({
            id: r.id,
            filenameCode: r.filenameCode,
            angleName: r.angleName,
            language: r.language,
            status: r.status,
            durationTarget: r.durationTarget,
            platformTargets: r.platformTargets,
            masterAssetId: r.masterAssetId,
            thumbnailAssetId: r.thumbnailAssetId,
            score: r.score,
            objective: r.objective,
            destination: r.destination,
          })),
        }),
      );
    },
    { query: LibraryQuerySchema },
  ),
);
