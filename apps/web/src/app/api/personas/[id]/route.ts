// `GET|PATCH|DELETE /api/personas/:id` — T2.0 (el resto del CRUD de la librería de personas).
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { PersonaPatchSchema } from '@ugc/core/persona';
import { getPersona, removePersona, updatePersona } from '@ugc/db';
import { getDb, getRequestLogger, withRoute } from '@/server';
import { toPersonaResponse } from '@/server/persona-response';
import { getStorage } from '@/server/storage';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const row = await getPersona(getDb(), params.id);
      if (!row) throw new AppError('not_found', 'persona no encontrada');
      return Response.json(toPersonaResponse(row));
    },
    { params: ParamsSchema },
  ),
);

/** PATCH PARCIAL: el formulario manda solo lo que cambió. Distinto del PATCH del brief
 *  (T1.10b), que manda el documento entero porque allí se VERSIONA — una persona no se
 *  versiona: se edita en sitio (su historia relevante es `perf`, no sus revisiones). */
export const PATCH = withAuth(
  withRoute(
    async ({ params, body }) => {
      const row = await updatePersona(getDb(), params.id, body);
      if (!row) throw new AppError('not_found', 'persona no encontrada');
      return Response.json(toPersonaResponse(row));
    },
    { params: ParamsSchema, body: PersonaPatchSchema },
  ),
);

/**
 * DELETE: borra la persona, sus filas `asset` de referencia y sus FICHEROS del almacén.
 *
 * Lo que NO borra: las `ad_variant` que la usaron (su FK es `ON DELETE set null` — decisión de
 * producto de T2.0: retirar una persona de la librería no destruye los anuncios que ya hizo).
 *
 * Orden deliberado: primero la TRANSACCIÓN de BD (que devuelve las `storage_key`), después los
 * ficheros. Si el borrado del fichero falla, queda un huérfano en disco —molesto pero inocuo— y
 * la BD queda consistente. Al revés, un fallo de la tx tras borrar los ficheros dejaría filas
 * `asset` apuntando a ficheros que ya no existen: un 404 en la descarga de un asset "vivo".
 */
export const DELETE = withAuth(
  withRoute(
    async ({ params }) => {
      const storageKeys = await removePersona(getDb(), params.id);
      if (storageKeys === null) throw new AppError('not_found', 'persona no encontrada');

      // Los borrados son INDEPENDIENTES (claves distintas, cada uno con su try/catch): en
      // paralelo. Con el adapter local da igual, pero el StorageAdapter es un PUERTO — el día
      // que detrás haya S3/R2, serializarlos convierte un round-trip en N.
      const storage = getStorage();
      await Promise.all(
        storageKeys.map(async (key) => {
          try {
            await storage.delete(key); // idempotente (rm --force): borrar dos veces no es error
          } catch (err) {
            // Un fichero que no se puede borrar NO puede tumbar el DELETE: la persona ya no
            // existe en la BD (que es la verdad del producto). Se registra y se sigue.
            getRequestLogger().warn(
              { err, storage_key: key, persona_id: params.id },
              'no se pudo borrar el fichero de una imagen de referencia',
            );
          }
        }),
      );

      return Response.json({ ok: true });
    },
    { params: ParamsSchema },
  ),
);
