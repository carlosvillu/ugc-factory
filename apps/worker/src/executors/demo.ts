// Executor de DEMO de F0 (jobs.md §4): código de PRODUCTO, no de test — es el
// harness que las verificaciones de gate de T0.7b/T0.9 necesitan para provocar
// trabajo, fallos y cuelgues observables sin nodos reales. Lee `step_run.config`
// (validado contra DemoConfigSchema) y se comporta según sus flags:
//   - `sleepMs`: duerme N ms (simula trabajo; se ve el paso por `running`).
//   - `failRate`: LANZA con probabilidad p en este intento (ejercita
//     fail→retry→queued y el agotamiento de retry_count).
//   - `hang`: NO retorna nunca (espera al abort del job) — andamiaje del sweeper
//     de T0.9; en T0.7b nada lo expira.
// Un throw = fallo del step; un retorno = éxito. El executor NO toca el estado del
// step: eso es del consumer vía transition().
import { DemoConfigSchema, type StepExecutor } from '@ugc/core/orchestrator';

/**
 * Decisor de fallo inyectable (mismo patrón que demo-noop, jobs.md §4): separa el
 * caos aleatorio de producción (`failRate` real) de la inyección determinista de
 * los tests (`fail_times`). Recibe la `failRate` ya parseada de la config y
 * devuelve si ESTE intento debe fallar. Default: aleatorio.
 */
export type DemoFailDecider = (failRate: number) => boolean;

/** Aleatorio per-intento — el default de producción/verificación manual. */
export const randomDemoFail: DemoFailDecider = (failRate) => Math.random() < failRate;

export interface DemoExecutorDeps {
  /** Decisor de fallo, resuelto por el composition root (nunca opcional). */
  shouldFail: DemoFailDecider;
}

/**
 * Construye el executor de demo. Una sola implementación cubre `demo.sleep`,
 * `demo.fail` y `demo.hang`: el comportamiento lo fija la `config` del step, no el
 * node_key (así un mismo run mezcla nodos que duermen, fallan y se cuelgan).
 */
export function makeDemoExecutor({ shouldFail }: DemoExecutorDeps): StepExecutor {
  return async ({ config, signal }) => {
    // La config puede venir null (nodo sin params) → objeto vacío = comportamiento
    // neutro (termina de inmediato). Un shape inválido LANZA: es un bug de la
    // definición del DAG, no algo que reintentar en silencio.
    const parsed = DemoConfigSchema.safeParse(config ?? {});
    if (!parsed.success) {
      throw new Error(`config de executor de demo inválida: ${parsed.error.message}`);
    }
    const { sleepMs, failRate, hang } = parsed.data;

    // `hang`: nunca resuelve por su cuenta; solo el abort (shutdown/expiración)
    // rechaza la promesa. En T0.7b no hay quien lo aborte → el step queda en
    // `running` (el sweeper de T0.9 lo llevará a `expired`).
    if (hang === true) {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('demo.hang abortado'));
          },
          { once: true },
        );
      });
      return;
    }

    if (sleepMs !== undefined && sleepMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
    }

    // `failRate`: decide fallar ESTE intento. El consumer traduce el throw a
    // transition('fail') y gatea el retry contra retry_count/max_retries.
    if (failRate !== undefined && failRate > 0 && shouldFail(failRate)) {
      throw new Error('demo executor: fallo inyectado');
    }
  };
}
