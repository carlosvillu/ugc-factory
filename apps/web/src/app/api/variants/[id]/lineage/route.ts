// `GET /api/variants/:id/lineage` (T5.7, panel 4c de `/library`): el LINAJE COMPLETO de una variante — del
// máster hasta el hook line y el `template@version` EXACTOS, pasando por persona y objetivo/destino del lote.
// Es lo que la Verificación exige que la UI muestre.
//
// SOLO lectura ⇒ sin boss ni transacción. `withAuth` por fuera (la barrera real), `withRoute` por dentro
// (valida `:id` como ULID → 400 si malformado, no 500). El repo TOLERA los punteros null (hook del brief,
// persona sin fijar): el linaje los refleja como `null`, no lanza.
import { z } from 'zod';
import { AppError, UlidSchema, VariantLineageSchema } from '@ugc/core/contracts';
import { getVariantLineage } from '@ugc/db';
import { getDb, withRoute } from '@/server';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const lineage = await getVariantLineage(getDb(), params.id);
      if (lineage === undefined) throw new AppError('not_found', 'variante no encontrada');
      // El `briefId` es interno (lo usa el bundle para el brand_name); NO se expone en el linaje de la UI.
      const { batch, ...rest } = lineage;
      return Response.json(
        VariantLineageSchema.parse({
          ...rest,
          batch: { id: batch.id, objective: batch.objective, destination: batch.destination },
        }),
      );
    },
    { params: ParamsSchema },
  ),
);
