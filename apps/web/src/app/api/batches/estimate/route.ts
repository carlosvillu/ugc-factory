// `POST /api/batches/estimate` — CP2 (T2.3): la matriz que saldría de una config y **lo que
// costaría**. Es el número que el panel pinta en grande y sobre el que el usuario autoriza el gasto.
//
// POR QUÉ ES UN ENDPOINT Y NO ARITMÉTICA EN EL NAVEGADOR (decisión vinculante de T2.3, y la regla
// «todo vía API REST» de la skill frontend):
//
//   · El coste sale de la tabla `recipe` (T2.1, recalibrable en T3.4), de la librería `hook_line`
//     sembrada y de las `persona` reales. Nada de eso está en el cliente, y mandárselo para que
//     calcule sería (a) enseñarle un modelo de coste que puede diverger del que el sistema cobra y
//     (b) dejar que el número que se aprueba lo produzca la parte del sistema que el usuario puede
//     modificar.
//   · Es la MISMA función (`planBatch`) que usa el efecto de dominio al confirmar
//     (`server/batch-checkpoint.ts`). Una sola aritmética ⇒ **lo que se estima es lo que se crea**.
//
// POR QUÉ POST Y NO GET, si no muta nada: la config es un objeto compuesto (ángulos, idiomas,
// persona, tier…) que en un querystring sería un JSON serializado a mano — o sea, un body
// disfrazado, sin la validación de `withRoute` y con el techo de longitud de la URL encima.
// Idempotente y sin efectos: se puede llamar en cada cambio del panel sin miedo.
import { z } from 'zod';
import { BatchConfigSchema, BatchEstimateSchema, UlidSchema } from '@ugc/core/contracts';
import { getDb, withRoute } from '@/server';
import { estimateBatch } from '@/server/batch-checkpoint';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// `.strict()`: una clave desconocida en la config (un `tier` mal escrito, un campo que el cliente
// cree que existe) es un caller roto ⇒ 400. Tragárselo estimaría un lote distinto del que el
// usuario cree estar pidiendo — y luego CREARÍA ese otro lote, porque la misma config viaja a la
// confirmación.
//
// EL BRIEF NO VIENE DEL CLIENTE, VIENE DEL STEP. Se pide el `stepId` del checkpoint y el servidor
// saca el `briefId` de su artefacto (`N4Output`) — la MISMA procedencia que usa la confirmación. Si
// aceptáramos el `briefId` del body (validado solo como ULID, que es lo que hacía antes), un caller
// autenticado podría estimar CUALQUIER brief de la BD y leerse sus ángulos, sus hooks y sus
// personas candidatas. Una sola procedencia para estimar y para crear.
const BodySchema = z.strictObject({
  stepId: UlidSchema,
  config: BatchConfigSchema,
});

export const POST = withAuth(
  withRoute(
    async ({ body }) => {
      const estimate = await estimateBatch(getDb(), body.stepId, body.config);
      // Se serializa con el contrato de core — el MISMO que el api-client usa para validar: un
      // drift servidor↔cliente revienta en test, no en producción (api.md §1).
      return Response.json(BatchEstimateSchema.parse(estimate));
    },
    { body: BodySchema },
  ),
);
