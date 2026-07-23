// `POST /api/steps/:id/regenerate` (CU4, T5.8, §22.4): la tercera acción de CP4 (QA). A DIFERENCIA de
// approve/reject —que RESUELVEN el step N9 (waiting_approval→succeeded/rejected)—, regenerar NO toca el
// step ni la variante aprobada: CLONA la variante con el CTA cambiado y arranca un RUN DE GENERACIÓN
// `kind='regen'` NUEVO (nodo cambiado → N8 → N9), reutilizando por dedup (T4.10) los N7 no afectados.
// El step N9 original se queda pausado (el usuario puede aún aprobar/rechazar la variante original); el
// cliente navega al `nextRunId` para ver el progreso del run parcial.
//
// El efecto vive en `server/regen-checkpoint.ts` (`regenerateVariantCta`), que compone el clon + el run
// en la MISMA tx (`withDomainTransaction`): clon+run commitean juntos o nada (atomicidad de CP3). El
// handler solo parsea `:id` + el body (el CTA nuevo), lee el `output_refs` de N9 y cablea la tx.
import { z } from 'zod';
import { UlidSchema } from '@ugc/core/contracts';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { spawnRegenForStep } from '@/server/regen-checkpoint';
import { withAuth } from '@/server/with-auth';
import { toCheckpointError } from '../checkpoint-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
// El CTA HABLADO nuevo (la narración de la escena `cta`). `.strict()`: un campo mal escrito es un caller
// roto → 400, no un CTA que se pierde en silencio. Se recorta/valida no-vacío en el efecto (con el
// mensaje de dominio); aquí solo la forma.
const BodySchema = z.strictObject({ cta: z.string().min(1) });

export const POST = withAuth(
  withRoute(
    async ({ params, body }) => {
      const db = getDb();
      const boss = await getBoss();

      // Toda la lógica (lock del N9 FOR UPDATE + guards + clon + run + marcador de idempotencia) vive en
      // `spawnRegenForStep`, en UNA tx. El handler solo parsea `:id`+CTA y traduce el error a HTTP. La
      // extracción es lo que hace el seam testeable con concurrencia REAL (dos llamadas solapadas → el lock
      // de Postgres serializa; el test comprueba que solo una crea el run).
      let nextRunId: string;
      try {
        const result = await spawnRegenForStep(db, boss, getRequestLogger(), params.id, body.cta);
        nextRunId = result.nextRunId;
      } catch (err) {
        throw toCheckpointError(err);
      }

      getRequestLogger().info(
        { step_id: params.id, next_run_id: nextRunId },
        'checkpoint CP4: regeneración parcial arrancada',
      );
      // `nextRunId` SIEMPRE presente en éxito (regenerar arranca un run): el cliente navega a su canvas.
      return Response.json({ ok: true, nextRunId });
    },
    { params: ParamsSchema, body: BodySchema },
  ),
);
