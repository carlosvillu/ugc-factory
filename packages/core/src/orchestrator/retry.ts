// Retry MANUAL de un step fallido (T0.9, §7.1): `POST /api/steps/:id/retry`
// re-ejecuta un step en `failed` — failed→queued + re-encolado — con dos matices
// propios de la intervención humana:
//   1. RESETEA `retry_count` a 0: un humano que reintenta suele haber arreglado la
//      causa (cambio de config), así que concede un presupuesto de intentos NUEVO
//      aunque los automáticos estuvieran agotados (`retry_count >= max_retries`).
//   2. Admite un PATCH de `config` que se aplica ANTES del re-encolado (en la MISMA
//      tx), de modo que el executor re-lee la config nueva — es lo que permite a la
//      Verificación de T0.9 mutar `fail_rate` de 1→0 y que la re-ejecución complete.
//
// El evento `retry` SOLO es legal desde `failed` (§7.1: no hay expired→queued). Un
// step `expired` o terminal distinto de `failed` da IllegalTransitionError (el
// handler lo mapea a 409) — la Verificación NO pide reintentar un expired.
//
// Frontera de core: sin BD, sin cola. Orquesta puertos vía applyTransition.
import { applyTransition } from './transition';
import type { TransitionDeps } from './transition';

export type RetryStepDeps = TransitionDeps;

export interface RetryStepInput {
  /**
   * Patch de `config` a aplicar antes de re-encolar (opcional). Si se pasa,
   * REEMPLAZA la `config` del step. La Verificación lo usa para `fail_rate: 0`.
   * `undefined` = conservar la config actual.
   */
  config?: unknown;
}

/**
 * Reintenta MANUALMENTE un step `failed`. En UNA tx:
 *   1. Lock + `retry` (failed→queued): applyTransition valida bajo el lock
 *      (IllegalTransitionError si no está `failed`), limpia `finished_at`, e
 *      incrementa retry_count atómicamente; el paso a `queued` re-encola el job.
 *   2. Sobre la fila ya `queued`: resetea `retry_count` a 0 (presupuesto nuevo) y,
 *      si se pasó, escribe el `config` patcheado. Ambos en el mismo UPDATE bajo el
 *      lock que sigue vivo hasta el commit.
 * El re-encolado ocurre en el paso 1 (dentro de applyTransition), después de que
 * el executor, al arrancar, lea la config ya patcheada por el paso 2 — el commit
 * de la tx precede a cualquier ejecución del job (encolado transaccional, jobs.md §5).
 */
export async function retryStep(
  deps: RetryStepDeps,
  stepId: string,
  input: RetryStepInput = {},
): Promise<void> {
  await deps.withTransaction(async (stores) => {
    // 1) failed→queued + increment atómico + re-encolado. Valida legalidad bajo el
    //    lock; si no está `failed`, lanza IllegalTransitionError (rollback).
    await applyTransition(stores, stepId, 'retry');

    // 2) Reset del contador (presupuesto nuevo) + patch de config, sobre la fila ya
    //    `queued` y LOCKEADA por el paso 1 (applyTransition ya hizo findForUpdate y
    //    habría lanzado StepNotFoundError si no existiera), en la MISMA tx. El status
    //    no cambia; solo retry_count y config.
    await stores.steps.update(stepId, {
      status: 'queued',
      resetRetryCount: true,
      ...(input.config !== undefined && { config: input.config }),
    });
  });
}
