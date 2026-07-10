// Barrido de steps colgados (T0.9, jobs.md §8): expira los steps que llevan
// `running` más allá de su `timeout_at`. NO es un cron de pg-boss — el cron de
// pg-boss tiene precisión de minuto (~30-60 s) y la Verificación de T0.9 exige
// `expired` en <40 s con timeout de 10 s; por eso el disparo real es un
// `setInterval` en el worker (apps/worker) que invoca esta función. Aquí solo la
// lógica: leer los ids colgados (inyectado) y transicionar cada uno a `expired`.
//
// Frontera de core: este fichero NO importa drizzle ni pg-boss. La query de sweep
// (SELECT ... < now()) vive en @ugc/db (findExpiredRunningStepIds) y se inyecta.
import { IllegalTransitionError, transition } from './transition';
import type { TransitionDeps } from './transition';
import type { Logger } from '../observability';

/**
 * Lee los ids de los steps `running` cuyo `timeout_at` ya pasó (`< now()` de
 * Postgres), en orden por id. Lo implementa @ugc/db (findExpiredRunningStepIds) y
 * lo cablea el composition root del worker; core no sabe de Drizzle.
 */
export type ListExpiredStepIds = () => Promise<string[]>;

export interface SweepDeps extends TransitionDeps {
  listExpiredStepIds: ListExpiredStepIds;
  logger: Logger;
}

/**
 * Resultado del barrido: cuántos steps se expiraron y cuántos fueron no-op
 * (ya no estaban `running` al tomar el lock — carrera con una transición en
 * vuelo). Útil para logging/tests; nunca lanza por un no-op individual.
 */
export interface SweepResult {
  expired: number;
  skipped: number;
}

/**
 * Barre los steps colgados y los lleva a `expired` uno a uno vía `transition`.
 *
 * Robustez (jobs.md §8):
 *  - Los ids se procesan en orden por id (los devuelve así el repo) → orden de
 *    lock determinista, sin deadlock 40P01 con transiciones concurrentes.
 *  - Cada `transition('expire')` toma su propio lock de fila y REVALIDA el estado:
 *    si el step ya terminó entre el SELECT y el lock (succeed/fail/cancel llegó
 *    primero), lanza `IllegalTransitionError` → NO-OP seguro (log + continuar).
 *    Un step que ya no existe (StepNotFoundError) o cualquier otro error de una
 *    fila tampoco tumba el barrido: se loggea y se sigue con el resto.
 */
export async function sweepExpiredSteps(deps: SweepDeps): Promise<SweepResult> {
  const ids = await deps.listExpiredStepIds();
  let expired = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      await transition(deps, id, 'expire');
      expired += 1;
      deps.logger.info({ step_id: id }, 'sweep: step colgado expirado');
    } catch (err) {
      // Carrera esperada (el step se resolvió antes del lock) o cualquier fallo de
      // una fila concreta: no-op seguro, el barrido continúa con las demás.
      skipped += 1;
      if (err instanceof IllegalTransitionError) {
        deps.logger.info({ step_id: id }, 'sweep: step ya no running al lockear: no-op');
      } else {
        deps.logger.warn({ err, step_id: id }, 'sweep: fallo expirando step; se continúa');
      }
    }
  }
  if (expired > 0 || skipped > 0) {
    deps.logger.info({ expired, skipped }, 'sweep: barrido de timeouts completado');
  }
  return { expired, skipped };
}
