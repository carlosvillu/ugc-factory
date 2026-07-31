// `GET|POST /api/variants/:id/native-sound` (T6.6, §14 pt 1-2 / §13.3, PRD:626): el Trending Sound Advisor.
//
//   · GET  → lista los trending sounds de TikTok Creative Center (Popular Music) para ESTA variante, con el
//            FILTRO COMERCIAL aplicado según el destino de su lote (§14 pt 2): organic ⇒ todos con su flag;
//            paid/both (incluyen Spark) ⇒ SOLO Commercial Music Library. Cada sonido trae su flag `commercial`
//            (derivado del `if_cml` real) y sus mood tags (derivados del título). Solo variantes APROBADAS.
//   · POST → elige un sonido nativo/trending → marca `audio_source='native_trending'` (§14 pt 1). La pista NO
//            se compone (se añade nativa en la app al publicar, §12); esto hace que `sparkEligibility` bloquee
//            Spark (coherencia con T6.2, §14 pt 2). GUARD 409: la variante debe estar APROBADA y con máster ya
//            compuesto (`master_asset_id IS NOT NULL`). Por qué: N7e (el bed IA) corre ANTES de la composición;
//            si el máster no existe aún, N7e podría re-marcar `audio_source='ai_bed'` DESPUÉS de esta selección
//            (generate-music.ts guard) → la fila mentiría. Exigir el máster pone esa carrera fuera de alcance.
//
// SEAM E2E: la base URL de Creative Center se lee de `CREATIVE_CENTER_BASE_URL` (env) — AUSENTE en producción
// ⇒ la fuente real; el fake HTTP server del E2E la apunta a sí mismo. La capa core NUNCA lee env (recibe la
// base como dep, molde Firecrawl/FAL_BASE_URL).
//
// `withAuth` por fuera, `withRoute` por dentro. Lectura pública + escritura simple ⇒ sin boss ni transacción
// del orquestador (no toca el DAG de generación).
import { z } from 'zod';
import { AppError, BatchDestinationSchema, UlidSchema } from '@ugc/core/contracts';
import {
  makeCreativeCenterClient,
  SelectNativeSoundSchema,
  SelectNativeSoundResultSchema,
  TrendingSoundListSchema,
} from '@ugc/core/publishing';
import { getVariant, getVariantLineage, setVariantNativeTrending } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const db = getDb();
      const lineage = await getVariantLineage(db, params.id);
      if (lineage === undefined) throw new AppError('not_found', 'variante no encontrada');
      // El Advisor opera sobre variantes YA aprobadas (misma población que la publicación, §9.7 N10).
      if (lineage.variant.status !== 'approved') {
        throw new AppError('invalid_transition', 'la variante no está aprobada');
      }

      // El destino del lote gobierna el filtro comercial (§14 pt 2). `.catch('organic')` tolera matrices legacy
      // (mismo mecanismo que `BatchDestinationSchema.default('organic')` del plan) sin reinventar el coerce.
      const destination = BatchDestinationSchema.catch('organic').parse(lineage.batch.destination);
      const client = makeCreativeCenterClient({
        // Seam E2E: ausente en prod ⇒ la base URL constante de core (Creative Center real).
        baseUrl: process.env.CREATIVE_CENTER_BASE_URL,
      });
      const result = await client.fetchTrendingSounds({ destination });

      return Response.json(
        TrendingSoundListSchema.parse({
          sounds: result.sounds,
          commercialOnly: result.commercialOnly,
          // `sourceOk=false` cuando la lectura de Creative Center falló (red/HTTP/JSON). La UI lo usa para
          // avisar «la fuente no responde» en vez de mostrar «no hay sonidos» — clave en producción, donde SIN
          // sesión de TikTok (T6.1) la fuente real da 404.
          sourceOk: result.sourceOk,
        }),
      );
    },
    { params: ParamsSchema },
  ),
);

export const POST = withAuth(
  withRoute(
    async ({ params }) => {
      const db = getDb();

      const variant = await getVariant(db, params.id);
      if (variant === undefined) {
        throw new AppError('not_found', `la variante ${params.id} no existe`);
      }
      // GUARD 409 (mirror invertido de music-bed): elegir un sonido nativo exige que la variante esté APROBADA
      // y con máster YA compuesto. Sin máster, N7e (bed IA) aún puede correr y pisar `audio_source='ai_bed'`
      // DESPUÉS de esta marca (generate-music.ts guard keya en el puntero de bed propio, no en native_trending)
      // → la fila mentiría. Exigir el máster deja esa carrera estructuralmente fuera de alcance.
      if (variant.status !== 'approved' || variant.masterAssetId === null) {
        throw new AppError(
          'invalid_transition',
          `la variante ${params.id} debe estar aprobada y compuesta para elegir un sonido nativo`,
        );
      }

      // Marca native_trending (limpia el puntero de bed propio en la misma UPDATE, invariante T6.2b). El
      // `soundId` del body se valida en la frontera pero NO se persiste en columna: §12 dice que el sonido se
      // añade nativo en la app al publicar — la selección solo marca la PROCEDENCIA (que bloquea Spark).
      await setVariantNativeTrending(db, params.id);

      return Response.json(
        SelectNativeSoundResultSchema.parse({
          variantId: params.id,
          audioSource: 'native_trending',
        }),
      );
    },
    { params: ParamsSchema, body: SelectNativeSoundSchema },
  ),
);
