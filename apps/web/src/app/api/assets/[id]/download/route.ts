// `GET /api/assets/:id/download` (T0.5, PRD §19.2): descarga autenticada y
// PROXIFICADA de un asset. El cliente pide por `:id`; el handler busca la fila,
// resuelve su `storage_key` y hace streaming del fichero desde el StorageAdapter —
// JAMÁS acepta una ruta de storage del cliente ("nunca ruta cruda").
//
// Auth: `withAuth` POR FUERA (api.md §6) — un request sin sesión válida es 401 JSON
// tipado ANTES de tocar la BD o el filesystem, y el 401 no expone ninguna ruta. Es
// la barrera REAL (el matcher del proxy excluye /api: no protege esta ruta). Se
// importa por path directo `@/server/with-auth`: knip veta su reexport en el barrel
// sin más consumidores (aprendido en T0.4).
//
// `withRoute` POR DENTRO valida `:id` como ULID en la frontera (un id malformado es
// 400 validation_error, no un 500), establece el scope ALS con request_id y mapea
// cualquier throw al envelope. El handler devuelve una `Response` de streaming
// binario DIRECTAMENTE: withRoute la pasa verbatim, sin forzar el envelope JSON (el
// envelope solo aplica a los errores y a lo que TÚ construyes con Response.json).
import { z } from 'zod';
import { UlidSchema, AppError } from '@ugc/core/contracts';
import { getAsset } from '@ugc/db';
import { withRoute, getDb } from '@/server';
import { getStorage } from '@/server/storage';
import { withAuth } from '@/server/with-auth';

// pg + acceso a filesystem viven en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Sirve datos vivos de la BD/almacén: jamás se cachea.
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const row = await getAsset(getDb(), params.id);
      // 404 opaco: no revela si el id es sintácticamente plausible pero inexistente
      // vs. existente-sin-fichero. Nunca menciona la ruta de storage.
      if (!row) throw new AppError('not_found', 'asset no encontrado');

      // El adaptador es la única barrera de path traversal: recibe storage_key de
      // la BD (no del cliente) y lanza not_found si el fichero no está en disco.
      const body = await getStorage().get(row.storageKey);

      // Content-Length/Type salen de las columnas (bytes/mime), no del filesystem:
      // la fila es la fuente de verdad del contrato de la respuesta. La descarga
      // usa el id como nombre (nunca el storage_key, que es interno).
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': row.mime,
          'Content-Length': String(row.bytes),
          'Content-Disposition': `attachment; filename="${row.id}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    },
    { params: ParamsSchema },
  ),
);
