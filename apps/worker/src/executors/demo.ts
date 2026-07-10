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

/**
 * Sumidero de coste inyectado por config (T0.12): el executor de demo llama a esto
 * cuando su config lleva `costCents`, para registrar el cargo en `cost_entry`. Se
 * inyecta (no se importa `recordCost` directo) para no acoplar el executor al pool
 * de Drizzle: el composition root (createBoss) cablea `(input) => recordCost(db, input)`.
 * El shape es el `RecordCostInput` de @ugc/db reducido a lo que el demo conoce
 * (sin refs: el ExecutorContext no expone stepId/projectId — quedan null).
 */
export type DemoCostRecorder = (input: {
  provider: 'fal' | 'anthropic' | 'firecrawl' | 'other';
  amountCents: number;
  quantity?: number;
  unit?: string;
}) => Promise<unknown>;

export interface DemoExecutorDeps {
  /** Decisor de fallo, resuelto por el composition root (nunca opcional). */
  shouldFail: DemoFailDecider;
  /** Registrador de coste, cableado por el composition root (nunca opcional). */
  recordCost: DemoCostRecorder;
}

/**
 * Construye el executor de demo. Una sola implementación cubre `demo.sleep`,
 * `demo.fail` y `demo.hang`: el comportamiento lo fija la `config` del step, no el
 * node_key (así un mismo run mezcla nodos que duermen, fallan y se cuelgan).
 */
export function makeDemoExecutor({ shouldFail, recordCost }: DemoExecutorDeps): StepExecutor {
  return async ({ config, signal }) => {
    // La config puede venir null (nodo sin params) → objeto vacío = comportamiento
    // neutro (termina de inmediato). Un shape inválido LANZA: es un bug de la
    // definición del DAG, no algo que reintentar en silencio.
    const parsed = DemoConfigSchema.safeParse(config ?? {});
    if (!parsed.success) {
      throw new Error(`config de executor de demo inválida: ${parsed.error.message}`);
    }
    const { sleepMs, failRate, hang, costCents, costProvider, costQuantity, costUnit } =
      parsed.data;

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

    // Coste inyectado (T0.12): se registra SOLO tras pasar el gate de fallo — es el
    // path de ÉXITO. Un throw de fail arriba nunca llega aquí, así que un nodo que
    // falla no registra coste (y en retry, al no volver a fallar, registra UNA vez).
    // DEUDA CONOCIDA: un nodo que combine `failRate<1` con `costCents` podría, en un
    // intento exitoso tras fallos, registrar una única vez (correcto); pero un
    // `failRate` que a veces pasa y a veces no NO es determinista — la inyección del
    // verifier usa nodos sin failRate (coste puro), así que registra exactamente una
    // vez por run. No se blinda contra el doble-conteo teórico (YAGNI en F0).
    if (costCents !== undefined && costCents > 0) {
      await recordCost({
        provider: costProvider ?? 'other',
        amountCents: costCents,
        quantity: costQuantity,
        unit: costUnit,
      });
    }
  };
}
