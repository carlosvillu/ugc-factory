// Sweeper de timeouts (T0.9, jobs.md §8): un `setInterval` del worker que expira
// los steps colgados (`running` con `timeout_at < now()`).
//
// POR QUÉ setInterval y NO cron de pg-boss: el cron de pg-boss tiene precisión de
// MINUTO (los schedules se evalúan cada ~30 s y el formato de 5 campos es de
// minuto). La Verificación de T0.9 exige `expired` en <40 s con un timeout de
// 10 s → un cron de 1 min barrería a t≈55-60 s = FAIL. Un setInterval de pocos
// segundos cierra el hueco. Es una desviación deliberada del literal "cron
// pg-boss" del Entrega (regla de trabajo 6, anotada en el journal).
//
// La LÓGICA del barrido (leer ids colgados + transition('expire') por fila) vive
// en core (sweepExpiredSteps); aquí solo el timer, el gate de errores y la limpieza.
import { findExpiredRunningStepIds } from '@ugc/db';
import type { DbClient } from '@ugc/db';
import { sweepExpiredSteps } from '@ugc/core/orchestrator';
import type { TransitionDeps } from '@ugc/core/orchestrator';
import type { Logger } from '@ugc/core';

/** Intervalo por defecto del barrido (ms). 5 s: con un timeout de 10 s, el peor
 *  caso de detección es ~15 s ≪ 40 s del gate. Overrideable vía `intervalMs`. */
const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

export interface StartSweeperDeps {
  db: DbClient;
  transitionDeps: TransitionDeps;
  logger: Logger;
  /** Intervalo del barrido (ms). Default `DEFAULT_SWEEP_INTERVAL_MS`. */
  intervalMs?: number;
}

/** Handle del sweeper: `stop()` retira el timer (lo llama el shutdown/cierre del boss). */
export interface Sweeper {
  stop(): void;
}

/**
 * Arranca el barrido periódico. Cada tick invoca `sweepExpiredSteps` (core), que
 * ya es a prueba de carreras (cada `expire` revalida bajo lock) y NUNCA lanza por
 * un step individual. Aun así, un tick entero se envuelve en try/catch: un fallo
 * de infraestructura (BD caída) NO debe tumbar el proceso ni parar los ticks
 * siguientes — el próximo tick reintenta. `unref()` evita que el timer por sí
 * solo mantenga vivo el event loop en el modo degradado.
 */
export function startSweeper({
  db,
  transitionDeps,
  logger,
  intervalMs = DEFAULT_SWEEP_INTERVAL_MS,
}: StartSweeperDeps): Sweeper {
  const tick = async (): Promise<void> => {
    try {
      await sweepExpiredSteps({
        ...transitionDeps,
        listExpiredStepIds: () => findExpiredRunningStepIds(db),
        logger,
      });
    } catch (err) {
      logger.error({ err }, 'sweeper: tick falló; se reintenta en el próximo intervalo');
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  logger.info({ intervalMs }, 'sweeper de timeouts arrancado');

  return {
    stop() {
      clearInterval(timer);
      logger.info({}, 'sweeper de timeouts detenido');
    },
  };
}
