// `DELETE /api/personas/:id/reference-images/:assetId` — T2.0: quitar una imagen de referencia.
//
// Existe porque el CRUD de la Entrega lo necesita de verdad, no por simetría: el usuario va a
// SUSTITUIR las imágenes sintéticas de las personas placeholder por sus caras reales, y para eso
// tiene que poder quitarlas desde la UI (la decisión del usuario dice literalmente «usando el
// propio CRUD que entregas, sin tocar código»).
//
// Mismo orden que el DELETE de la persona: primero la transacción de BD (que quita el id del
// array y borra la fila `asset`, devolviendo la `storage_key`), después el fichero.
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { removeReferenceImage } from '@ugc/db';
import { getDb, getRequestLogger, withRoute } from '@/server';
import { toPersonaResponse } from '@/server/persona-response';
import { getStorage } from '@/server/storage';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema, assetId: UlidSchema });

export const DELETE = withAuth(
  withRoute(
    async ({ params }) => {
      const result = await removeReferenceImage(getDb(), params.id, params.assetId);
      // `null` cubre los dos casos: la persona no existe, o esa imagen no es suya. Los dos son
      // un 404 desde fuera (no se filtra si la imagen existe pero pertenece a otra persona).
      if (result === null) {
        throw new AppError('not_found', 'la imagen de referencia no existe para esa persona');
      }

      try {
        await getStorage().delete(result.storageKey);
      } catch (err) {
        getRequestLogger().warn(
          { err, storage_key: result.storageKey, persona_id: params.id },
          'no se pudo borrar el fichero de una imagen de referencia',
        );
      }

      return Response.json(toPersonaResponse(result.persona));
    },
    { params: ParamsSchema },
  ),
);
