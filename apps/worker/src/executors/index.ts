// Registro de executors por `node_key` (jobs.md §4): el consumer genérico de
// `step.execute` resuelve aquí el executor a ejecutar. En F0 solo los de demo
// (una única implementación parametrizada por config); N1…N11 y N7a…N7e se añaden
// por fase con sus tareas.
import type { StepExecutor } from '@ugc/core/orchestrator';
import { type DemoFailDecider, makeDemoExecutor } from './demo';

export interface ExecutorRegistryDeps {
  /** Decisor de fallo de los executors de demo, resuelto por bootstrap. */
  demoShouldFail: DemoFailDecider;
}

/**
 * Construye el mapa `node_key → executor`. Los node_keys de demo comparten una
 * implementación (el comportamiento —dormir, fallar, colgarse— lo fija
 * `step_run.config`, no el key): así un DAG puede mezclar los tres modos sobre el
 * mismo executor. Un `node_key` sin executor registrado es un error de config
 * (executor desconocido) que el consumer lleva a `failed` terminal.
 */
export function makeExecutorRegistry({
  demoShouldFail,
}: ExecutorRegistryDeps): Record<string, StepExecutor> {
  const demo = makeDemoExecutor({ shouldFail: demoShouldFail });
  return {
    'demo.sleep': demo,
    'demo.fail': demo,
    // `demo.hang` (T0.9): el executor no retorna nunca (espera al abort) — es el
    // andamiaje que la Verificación del sweeper necesita para provocar un step
    // colgado en `running` que `timeout_at` + el sweep llevan a `expired`.
    'demo.hang': demo,
    // node_keys del DAG de demo (demo-dag.ts): distintos por nodo para que el
    // singletonKey `${runId}:${nodeKey}` no colisione dentro de un run. Los tres
    // usan el mismo executor (el comportamiento lo fija la config del step).
    'demo.sleep.N0': demo,
    'demo.sleep.N1': demo,
    'demo.sleep.N2': demo,
  };
}
