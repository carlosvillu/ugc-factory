// DAG de demo de F0 (T0.7b): una CADENA de 3 nodos con dependencias reales —
// N0 (root, arranca `pending`→`queued`) → N1 (depende de N0, arranca
// `awaiting_deps`) → N2 (depende de N1, `awaiting_deps`). La cadena es deliberada:
// la Entrega exige que EXISTAN ambos estados iniciales (`pending` Y
// `awaiting_deps`), lo que 3 roots independientes no darían. Los 3 nodos usan el
// executor `demo.sleep` (un sleep corto) para que la Verificación observe el paso
// ordenado pending→queued→running→succeeded con timestamps coherentes.
//
// Es el DAG que `POST /api/runs` recibe en la Verificación y el script de 20
// concurrentes. Vive en core (no en un fixture de test) porque es harness de
// producto de F0, no de test.
import type { RunDefinition } from './run-definition';

/** Construye la definición del DAG de demo para un project dado. `sleepMs`
 *  configurable (default 0) para tests deterministas / verificación observable. */
export function demoRunDefinition(projectId: string, sleepMs = 0): RunDefinition {
  // node_key DISTINTO por nodo (N0/N1/N2), no el mismo 'demo.sleep' para los tres:
  // el `singletonKey` de encolado es `${runId}:${nodeKey}` (anti doble-encolado),
  // así que dos steps del MISMO run con el mismo node_key colisionarían en la cola
  // (policy `short` = 1 job por key) y el segundo no se encolaría. En el pipeline
  // real cada node_key es único por run; el DAG de demo respeta ese invariante. Los
  // tres resuelven al mismo executor de demo (registrado bajo N0/N1/N2).
  return {
    projectId,
    nodes: [
      { key: 'N0', nodeKey: 'demo.sleep.N0', dependsOn: [], config: { sleepMs } },
      { key: 'N1', nodeKey: 'demo.sleep.N1', dependsOn: ['N0'], config: { sleepMs } },
      { key: 'N2', nodeKey: 'demo.sleep.N2', dependsOn: ['N1'], config: { sleepMs } },
    ],
  };
}
