// Registro de executors por `node_key` (jobs.md §4): el consumer genérico de
// `step.execute` resuelve aquí el executor a ejecutar. En F0 solo los de demo
// (una única implementación parametrizada por config); N1…N11 y N7a…N7e se añaden
// por fase con sus tareas.
import type { StepExecutor } from '@ugc/core/orchestrator';
import { type DemoCostRecorder, type DemoFailDecider, makeDemoExecutor } from './demo';
import {
  type AnalysisExecutorDeps,
  makeN1Executor,
  makeN2Executor,
  makeN3Executor,
} from './analysis';
import { makeN4Executor } from './strategy';
import { makeN5Executor } from './write-scripts';

export interface ExecutorRegistryDeps {
  /** Decisor de fallo de los executors de demo, resuelto por bootstrap. */
  demoShouldFail: DemoFailDecider;
  /** Registrador de coste de los executors de demo (T0.12), cableado por createBoss. */
  demoRecordCost: DemoCostRecorder;
  /** Deps de los nodos REALES del análisis (T1.10a): BD, storage, secretos y los
   *  overrides de base URL de los clientes externos (el stack E2E los apunta a su fake). */
  analysis: AnalysisExecutorDeps;
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
  demoRecordCost,
  analysis,
}: ExecutorRegistryDeps): Record<string, StepExecutor> {
  const demo = makeDemoExecutor({ shouldFail: demoShouldFail, recordCost: demoRecordCost });
  return {
    // Nodos REALES del DAG de análisis (T1.10a, analysis-dag.ts). Un node_key por nodo:
    // el singletonKey `${runId}:${nodeKey}` exige que sean únicos dentro del run.
    N1: makeN1Executor(analysis),
    N2: makeN2Executor(analysis),
    N3: makeN3Executor(analysis),
    // N4 · ESTRATEGIA DEL LOTE (T2.3): determinista y $0 (§7.2). Solo necesita la BD —ni red, ni
    // secretos, ni storage—, así que toma el `db` de las deps del análisis en vez de estrenar un
    // grupo de deps de un solo campo. Cuando F2 traiga N5 (que sí paga Sonnet), ese grupo nacerá
    // con su primera dep de verdad.
    N4: makeN4Executor({ db: analysis.db }),
    // N5 · GUIONIZACIÓN (T2.6): PAGA Sonnet 5, así que necesita BD + secretos + el override de base
    // URL del cliente de Anthropic (que el stack E2E apunta a su fake). `WriteScriptsExecutorDeps` es
    // un SUBCONJUNTO de `AnalysisExecutorDeps`, así que se le pasa el grupo del análisis TAL CUAL —
    // el patrón que N4 abrió reusando `analysis.db`. Pasar el objeto entero (no desestructurar) es
    // deliberado: `secretsKey` es un GETTER perezoso (un worker sin APP_MASTER_KEY arranca igual y
    // solo revienta el nodo que la use); leerlo aquí lo forzaría en el boot y rompería esa promesa.
    N5: makeN5Executor(analysis),
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
    // node_keys del DAG de demo del canvas (T0.11, demoCanvasRunDefinition):
    // N0→N1(checkpoint)→N2→N3(alwaysPause)→N4(failRate=1)→N5(skippable). Todos
    // usan el mismo executor de demo; el comportamiento lo fija la config del step
    // (sleepMs, failRate). Distintos por nodo para no colisionar en el singletonKey.
    'demo.canvas.N0': demo,
    'demo.canvas.N1': demo,
    'demo.canvas.N2': demo,
    'demo.canvas.N3': demo,
    'demo.canvas.N4': demo,
    'demo.canvas.N5': demo,
  };
}
