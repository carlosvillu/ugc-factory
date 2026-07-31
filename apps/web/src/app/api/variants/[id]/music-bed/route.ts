// `PUT|DELETE /api/variants/:id/music-bed` (T6.2b, §14 `own_license`): ata (o desata) un bed musical
// PROPIO a una variante. El asset ya se subió por `POST /api/assets` (kind=`music_bed`); aquí el usuario
// lo ELIGE como bed de esta variante — «seleccionable en la matriz» (entrega 6 de T6.2b), sin UI: esta es
// la superficie API que persiste la selección.
//
//   · PUT    · body `{ assetId }` → puntero `ad_variant.own_music_bed_asset_id` = ese asset +
//              `audio_source='own_license'` (una sola UPDATE, `setVariantOwnMusicBed`). Cuando la variante
//              genere, N7e SE SALTA (el builder omite `n7eConfig`) y N8 compone con esta pista.
//   · DELETE · desata: puntero NULL + `audio_source` NULL → la variante vuelve al bed IA de N7e. Solo tiene
//              efecto si la variante REALMENTE tenía bed propio (si no, es un 200 no-op que NO toca
//              `audio_source` — un DELETE espurio sobre una variante `ai_bed` no debe borrar su procedencia).
//
// VALIDACIÓN de FRONTERA (antes de escribir): la variante existe (404), el asset existe (404), y el asset
// es `kind='music_bed'` (400). Sin la última barrera, apuntar el bed a un JPEG reventaría DENTRO de ffmpeg
// en N8 en vez de fallar aquí con un mensaje accionable.
//
// COHERENCIA CON EL MÁSTER (409): atar/desatar un bed exige que la variante AÚN NO esté compuesta
// (`master_asset_id IS NULL`). Un máster ya existe = ya deriva del bed que se usó al componer; reatar otro
// dejaría `audio_source`/puntero apuntando a una pista que el máster real NO lleva → la fila MENTIRÍA sobre
// la procedencia (la misma inconsistencia que el guard de N7e evita por el otro lado). Recomponer es
// regeneración (T5.8), no un reatado silencioso.
//
// Lectura/escritura simple ⇒ sin boss ni transacción del orquestador (no toca el DAG de generación).
// `withAuth` por fuera, `withRoute` por dentro.
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { getAsset, getVariant, setVariantOwnMusicBed } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
const AttachBodySchema = z.object({ assetId: UlidSchema });

const MusicBedResponseSchema = z.object({
  variantId: UlidSchema,
  ownMusicBedAssetId: UlidSchema.nullable(),
  audioSource: z.enum(['ai_bed', 'own_license', 'native_trending']).nullable(),
});

// Carga la variante y aplica los dos guards de frontera que PUT y DELETE comparten palabra por palabra:
// existencia (404) y coherencia con el máster (409, un máster ya compuesto no admite reatar/desatar). Una
// sola fuente del mensaje 409 → las dos rutas no pueden divergir. Devuelve la fila ya validada.
async function loadUncomposedVariant(db: ReturnType<typeof getDb>, id: string) {
  const variant = await getVariant(db, id);
  if (variant === undefined) {
    throw new AppError('not_found', `la variante ${id} no existe`);
  }
  // Un máster ya existe = ya deriva del bed que se usó al componer; reatar/desatar otro dejaría la fila
  // mintiendo sobre la procedencia del máster real (la misma inconsistencia que el guard de N7e evita por
  // el otro lado). Recomponer es regeneración (T5.8), no un reatado silencioso.
  if (variant.masterAssetId !== null) {
    throw new AppError(
      'invalid_transition',
      `la variante ${id} ya tiene máster compuesto: no se puede cambiar el bed sin recomponer (regenera con T5.8)`,
    );
  }
  return variant;
}

export const PUT = withAuth(
  withRoute(
    async ({ params, body }) => {
      const db = getDb();

      // Reads independientes en paralelo: `body.assetId` no depende de la fila de la variante. El primer
      // elemento se descarta — `loadUncomposedVariant` corre por sus guards (404/409), no por su valor aquí.
      const [, asset] = await Promise.all([
        loadUncomposedVariant(db, params.id),
        getAsset(db, body.assetId),
      ]);
      if (asset === undefined) {
        throw new AppError('not_found', `el asset ${body.assetId} no existe`);
      }
      if (asset.kind !== 'music_bed') {
        // Barrera clave: solo un asset de música puede ser bed. Un asset de otro kind (imagen, vídeo)
        // compondría un máster corrupto o reventaría en ffmpeg — se rechaza aquí, accionable.
        throw new AppError(
          'validation_error',
          `el asset ${body.assetId} es kind '${asset.kind}', no 'music_bed': no puede usarse como bed musical`,
        );
      }

      await setVariantOwnMusicBed(db, params.id, body.assetId);
      return Response.json(
        MusicBedResponseSchema.parse({
          variantId: params.id,
          ownMusicBedAssetId: body.assetId,
          audioSource: 'own_license',
        }),
      );
    },
    { params: ParamsSchema, body: AttachBodySchema },
  ),
);

export const DELETE = withAuth(
  withRoute(
    async ({ params }) => {
      const db = getDb();

      const variant = await loadUncomposedVariant(db, params.id);

      // NO-OP si la variante NUNCA tuvo bed propio: un DELETE espurio (doble clic, retry) sobre una variante
      // `ai_bed`/`native_trending` NO debe borrar su `audio_source` — el máster SÍ tiene esa música. Solo se
      // desata cuando REALMENTE había bed propio; devolver el estado ACTUAL sin tocar la fila.
      if (variant.ownMusicBedAssetId === null) {
        return Response.json(
          MusicBedResponseSchema.parse({
            variantId: params.id,
            ownMusicBedAssetId: null,
            audioSource: variant.audioSource,
          }),
        );
      }

      // Desata: puntero + audio_source a NULL en una UPDATE (había bed propio → audio_source era own_license).
      await setVariantOwnMusicBed(db, params.id, null);
      return Response.json(
        MusicBedResponseSchema.parse({
          variantId: params.id,
          ownMusicBedAssetId: null,
          audioSource: null,
        }),
      );
    },
    { params: ParamsSchema },
  ),
);
