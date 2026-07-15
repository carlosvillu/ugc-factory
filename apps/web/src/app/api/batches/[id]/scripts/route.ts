// `GET /api/batches/:id/scripts` (T2.6, CP3): los guiones VIGENTES del lote, listos para el editor.
//
// POR QUÉ ESTE ENDPOINT Y NO EL ARTEFACTO DE N5. El `N5Output` que el canvas trae por SSE es un
// artefacto LIGERO (refs por variante), sin el TEXTO del guion — la verdad vive en las filas
// `ad_script` (§12). Y esas filas no guardan `filenameCode`/`sharedBodyKey`, que `AdScriptSchema`
// exige para que el panel pueda RE-MANDAR el guion editado por el canal de decisión. El servidor los
// reconstruye (fila + matriz) en `readBatchScripts` y sirve un `AdScript` válido.
//
// Lectura pura ⇒ sin boss ni transacción. `:id` = ULID del lote.
import { z } from 'zod';
import { BatchScriptsSchema, UlidSchema } from '@ugc/core/contracts';
import { withRoute, getDb } from '@/server';
import { readBatchScripts } from '@/server/batch-scripts';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });

export const GET = withAuth(
  withRoute(
    async ({ params }) => {
      const scripts = await readBatchScripts(getDb(), params.id);
      // Se serializa con el contrato de core — el MISMO que el api-client usa para validar: un drift
      // servidor↔cliente revienta en test, no en producción (api.md §1).
      return Response.json(BatchScriptsSchema.parse(scripts));
    },
    { params: ParamsSchema },
  ),
);
