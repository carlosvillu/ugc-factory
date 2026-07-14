// `POST /api/steps/:id/approve` (T0.8, §7.1.b): aprueba un step en
// `waiting_approval` SIN cambios — reanuda el run con los artefactos de la IA
// intactos y escribe una fila de auditoría (§19.1). Muta estado ⇒ withRoute (+
// withAuth por fuera). `:id` = ULID.
//
// La lógica vive en core (`approveStep`, §9.0): el handler solo parsea `:id`,
// cablea el withTransaction y mapea los errores del orquestador al envelope.
//
// T1.10b — EFECTO DE DOMINIO: si el step aprobado es el checkpoint del BRIEF (CP1, N3), su
// `product_brief` v1 pasa de `draft` a `approved`. Aprobar SIN editar NO crea una versión nueva
// (ver `server/brief-checkpoint.ts`): un v2 idéntico al v1 con `edited_by_user:true` mentiría
// sobre quién escribió ese contenido. El efecto se compone AQUÍ, fuera del orquestador genérico
// —que no sabe de briefs y no debe saberlo—, y no-opea para cualquier otro tipo de step.
//
// ATÓMICO con la transición (`withDomainTransaction`), y esto es CORRECCIÓN, no elegancia: si el
// efecto de dominio corriese DESPUÉS y fallase, `approveStep` ya habría commiteado —el run ya ha
// REANUDADO aguas abajo— y el brief se quedaría en `draft` PARA SIEMPRE, sin forma de arreglarlo
// (un segundo POST da IllegalTransitionError: el step ya no está en `waiting_approval`). El
// usuario habría aprobado y su brief figuraría como borrador. Dentro de UNA tx: o las dos
// mitades, o ninguna, y reintentar es seguro.
//
// T1.11 — LA DECISIÓN del checkpoint. El body admite una `decision` OPCIONAL (el canal genérico:
// `CheckpointDecisionSchema` es una unión discriminada por `kind` a la que CP2/CP3/CP4 añaden su
// miembro). Se persiste en `checkpoint_decision` DENTRO DE LA MISMA TX que la transición: un
// checkpoint humano produce DOS cosas —un artefacto y una decisión— y la decisión NO cabe en el
// `output_refs` (el artefacto tiene autor; una decisión colada ahí aparecería en el diff de
// `audit_log` como si la IA hubiera cambiado de opinión). Aprobar SIN decisión (la rama URL de
// CP1, que no tiene nada que decidir) sigue funcionando igual: no-op, sin fila.
import { z } from 'zod';
import { CheckpointDecisionSchema, UlidSchema } from '@ugc/core/contracts';
import { approveStep } from '@ugc/core/orchestrator';
import { findStep, withDomainTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { approveBriefForStep } from '@/server/brief-checkpoint';
import { persistCheckpointDecision } from '@/server/checkpoint-decision';
import { withAuth } from '@/server/with-auth';
import { toCheckpointError } from '../checkpoint-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
// `.strict()`: una `decisión`/`decison` mal escrita en el body es un caller roto ⇒ 400, no una
// decisión que se pierde en silencio (el strip por defecto de Zod). Aquí importa especialmente:
// perder la decisión no rompe la aprobación —el step avanza igual—, así que el usuario se
// enteraría en F4, cuando N7a no encuentre la decisión que él cree haber tomado.
//
// T1.15 — `promote_scraped` NO SE APRUEBA POR AQUÍ. Promover una imagen scrapeada a hero produce
// DOS efectos que no valen nada por separado: la DECISIÓN (esta fila) y el ARTEFACTO (el brief
// con `assets.hero_image_url` = esa imagen). `/approve` es, por definición, «aprobar SIN cambios»:
// no toca el artefacto. Aceptar aquí un `promote_scraped` persistiría una decisión que dice
// «promoví esta imagen» contra un brief cuyo hero sigue siendo `null` — los dos canales
// contradiciéndose, y N7a (T4.4) descubriéndolo en F4, gastando dinero en fal.ai. Promover ES una
// edición del brief y sale por `/edit` (⇒ v2, `edited_by_user:true`), que sí versiona el artefacto
// en la misma tx que la decisión.
//
// El guard vive AQUÍ y no solo en el editor de CP1 (que ya redirige al `/edit`): un `if` en un
// componente de React protege a UN llamante. El invariante es del CONTRATO, y este es el borde
// donde se para a cualquier otro (un curl, un test, el MCP de F8).
const BodySchema = z
  .strictObject({
    decision: CheckpointDecisionSchema.optional(),
  })
  .refine((b) => !(b.decision?.kind === 'brief' && b.decision.images === 'promote_scraped'), {
    message:
      'Promover una imagen a hero EDITA el brief: usa POST /api/steps/:id/edit (crea la v2 con ese hero), no /approve',
    path: ['decision', 'images'],
  });

export const POST = withAuth(
  withRoute(
    async ({ params, body }) => {
      const db = getDb();
      const boss = await getBoss();

      try {
        await withDomainTransaction(
          db,
          boss,
          getRequestLogger(),
          async ({ db: tx, withTransaction }) => {
            // El artefacto se lee ANTES de aprobar: `approveStep` no lo devuelve, y tras la
            // transición el `output_refs` es el mismo (aprobar sin editar no lo toca).
            const step = await findStep(tx, params.id);
            await approveStep({ withTransaction }, params.id);
            // No-op si el step no es CP1 (se discrimina por SCHEMA del artefacto).
            await approveBriefForStep(tx, step?.outputRefs);
            // No-op si el body no trajo decisión. Dentro de la tx ⇒ si la transición hubiera
            // fallado (409: el step ya no está en `waiting_approval`), no queda fila de decisión.
            await persistCheckpointDecision(tx, params.id, body.decision);
          },
        );
      } catch (err) {
        throw toCheckpointError(err);
      }

      getRequestLogger().info(
        { step_id: params.id, decision_kind: body.decision?.kind },
        'checkpoint aprobado',
      );
      return Response.json({ ok: true });
    },
    { params: ParamsSchema, body: BodySchema },
  ),
);
