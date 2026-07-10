// `POST /api/steps/:id/retry` (T0.9, Apéndice E: "Reintentar step fallido"):
// re-ejecuta MANUALMENTE un step en `failed`. failed→queued + reset de
// `retry_count` (presupuesto de intentos nuevo, aunque los automáticos estuvieran
// agotados) + re-encolado. Body opcional `{ config }`: un patch de la config del
// step que se aplica en la MISMA tx antes del re-encolado (p. ej. `fail_rate` de
// 1→0 para que la re-ejecución complete). Muta estado ⇒ withRoute (+ withAuth).
//
// La lógica vive en core (`retryStep`); el handler parsea y cablea. Mapeo de
// errores compartido con las rutas de checkpoint:
//   - StepNotFoundError → 404 not_found.
//   - IllegalTransitionError → 409 invalid_transition (el step no está `failed`;
//     §7.1: no hay retry desde expired/terminal distinto de failed).
import { z } from 'zod';
import { AppError, UlidSchema } from '@ugc/core/contracts';
import { retryStep } from '@ugc/core/orchestrator';
import { makeWithTransaction } from '@ugc/db';
import { withRoute, getBoss, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';
import { toCheckpointError } from '../checkpoint-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
// `config` es un jsonb opaco (los parámetros del executor). El body es OPCIONAL: un
// retry sin patch de config es lo normal (un `POST` sin body debe funcionar, p. ej.
// curl en la Verificación) → el body NO se declara en `withRoute` (que exigiría
// JSON) y se lee/parsea a mano tolerando el cuerpo vacío.
const BodySchema = z.object({ config: z.unknown().optional() });

/** Lee el body opcional: vacío ⇒ `{}` (sin patch); JSON válido ⇒ se valida contra
 *  BodySchema (400 si no encaja); JSON malformado ⇒ 400. */
async function readOptionalConfig(req: Request): Promise<{ config?: unknown }> {
  const text = await req.text();
  if (text.trim() === '') return {};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError('validation_error', 'el body no es JSON');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError('validation_error', 'payload inválido', z.flattenError(parsed.error));
  }
  return parsed.data;
}

export const POST = withAuth(
  withRoute(
    async ({ req, params }) => {
      const { config } = await readOptionalConfig(req);
      const boss = await getBoss();
      const withTransaction = makeWithTransaction(getDb(), boss);
      try {
        await retryStep({ withTransaction }, params.id, { config });
      } catch (err) {
        throw toCheckpointError(err);
      }
      getRequestLogger().info({ step_id: params.id }, 'step reintentado manualmente');
      return Response.json({ ok: true });
    },
    { params: ParamsSchema },
  ),
);
