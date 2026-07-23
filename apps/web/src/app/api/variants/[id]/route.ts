// `GET /api/variants/:id` (T5.6, CP4): la fila `ad_variant` que el panel de QA necesita para
// montar el player. El artefacto de N9 (`N9Output`) trae `{variantId, passed, qaReport}` pero NO el
// `masterAssetId` — ese vive en la FILA de la variante (`ad_variant.master_asset_id`, lo escribió N8
// al finalizar el máster). CP4 pide esta fila por variante seleccionada para resolver el `src` del
// `<video>` (`/api/assets/:id/download`), igual que CP3 pide los guiones del lote por REST: el
// artefacto del step es ligero, el dato pesado se busca por su fuente de verdad.
//
// Lectura pura ⇒ sin boss ni transacción. `withAuth` por fuera (la barrera real, api.md §6),
// `withRoute` por dentro (valida `:id` como ULID en la frontera → 400 si malformado, no 500).
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { getVariant } from '@ugc/db';
import { withRoute, getDb } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const variant = await getVariant(getDb(), params.id);
      if (variant === undefined) throw new AppError('not_found', 'variante no encontrada');
      // SOLO lo que CP4 usa: el máster (para el player), su identidad legible (cabecera de la
      // tarjeta) y su status (para reflejar approved/rejected sin recargar). El `qa_report` NO va
      // por aquí — CP4 lo lee del artefacto de N9 por `getStep` (misma procedencia que el veredicto
      // que el humano resuelve), no de la columna, para no tener dos fuentes del mismo dato.
      return Response.json({
        id: variant.id,
        masterAssetId: variant.masterAssetId,
        filenameCode: variant.filenameCode,
        angleName: variant.angleName,
        language: variant.language,
        status: variant.status,
      });
    },
    { params: ParamsSchema },
  ),
);
