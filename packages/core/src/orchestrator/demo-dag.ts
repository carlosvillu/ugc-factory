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
import type { RunDefinitionInput } from './run-definition';

/** Construye la definición del DAG de demo para un project dado. `sleepMs`
 *  configurable (default 0) para tests deterministas / verificación observable. */
export function demoRunDefinition(projectId: string, sleepMs = 0): RunDefinitionInput {
  // node_key DISTINTO por nodo (N0/N1/N2), no el mismo 'demo.sleep' para los tres:
  // el `singletonKey` de encolado es `${runId}:${nodeKey}` (anti doble-encolado),
  // así que dos steps del MISMO run con el mismo node_key colisionarían en la cola
  // (policy `short` = 1 job por key) y el segundo no se encolaría. En el pipeline
  // real cada node_key es único por run; el DAG de demo respeta ese invariante. Los
  // tres resuelven al mismo executor de demo (registrado bajo N0/N1/N2).
  return {
    projectId,
    autopilot: false,
    nodes: [
      { key: 'N0', nodeKey: 'demo.sleep.N0', dependsOn: [], config: { sleepMs } },
      { key: 'N1', nodeKey: 'demo.sleep.N1', dependsOn: ['N0'], config: { sleepMs } },
      { key: 'N2', nodeKey: 'demo.sleep.N2', dependsOn: ['N1'], config: { sleepMs } },
    ],
  };
}

/**
 * DAG de demo CON CHECKPOINT (T0.8): la misma cadena N0→N1→N2, pero N1 es un
 * checkpoint. Al terminar el trabajo de N1, el step NO pasa a `succeeded` sino a
 * `waiting_approval` (pausa esperando aprobación), a menos que el run esté en
 * autopilot. Es el DAG que la Verificación de T0.8 usa para ejercitar
 * pausa/approve/edit/skip/cancel/autopilot.
 *
 * `opts`:
 *  - `autopilot`: el run arranca en autopilot (N1 NO pausa salvo `alwaysPause`).
 *  - `alwaysPauseN1`: marca N1 con el override "parar SIEMPRE aquí" (gana sobre
 *    autopilot: N1 pausa aunque autopilot esté on).
 */
export function demoCheckpointRunDefinition(
  projectId: string,
  opts: { sleepMs?: number; autopilot?: boolean; alwaysPauseN1?: boolean } = {},
): RunDefinitionInput {
  const { sleepMs = 0, autopilot = false, alwaysPauseN1 = false } = opts;
  return {
    projectId,
    autopilot,
    nodes: [
      { key: 'N0', nodeKey: 'demo.sleep.N0', dependsOn: [], config: { sleepMs } },
      {
        key: 'N1',
        nodeKey: 'demo.sleep.N1',
        dependsOn: ['N0'],
        config: { sleepMs },
        isCheckpoint: true,
        checkpointConfig: alwaysPauseN1 ? { alwaysPause: true } : null,
      },
      { key: 'N2', nodeKey: 'demo.sleep.N2', dependsOn: ['N1'], config: { sleepMs } },
    ],
  };
}

/**
 * DAG de demo del CANVAS (T0.11): la cadena N0→N1→N2→N3→N4→N5, diseñada para que
 * los 7 comportamientos de la Verificación de T0.11 sean TODOS alcanzables desde la
 * UI en un solo run:
 *  - **N0** (root, sleep): arranca solo → se ve el paso running→succeeded en vivo.
 *  - **N1** (checkpoint NORMAL): pausa en `waiting_approval` esperando approve/
 *    edit/reject desde el panel. Con autopilot ON, este NO pausa (bypass).
 *  - **N2** (sleep): un nodo intermedio más para que el grafo tenga cuerpo.
 *  - **N3** (checkpoint con `alwaysPause`): el candado "parar SIEMPRE aquí" — pausa
 *    AUNQUE autopilot esté ON. Es el par de N1 que prueba "autopilot respeta el
 *    candado": con autopilot, N1 se salta pero N3 pausa.
 *  - **N4** (`failRate=1`): FALLA siempre en el 1er intento → error en el visor de
 *    logs → retry (con patch `failRate=0`) → succeeded.
 *  - **N5** (skippable): depende de N4; mientras N4 no succeeda, N5 está en
 *    `awaiting_deps` (skip es legal desde ahí, transitions.ts) → skip desde el panel.
 *
 * `sleepMs` configurable (default 0) para verificación observable (sleeps largos
 * dan tiempo a ver `running`) o tests deterministas (0). `autopilot` arranca el run
 * en autopilot (N1 se salta, N3 respeta el candado). `maxRetries` per-nodo se deja
 * al default (3): el retry manual resetea el contador igual.
 */
export function demoCanvasRunDefinition(
  projectId: string,
  opts: { sleepMs?: number; autopilot?: boolean } = {},
): RunDefinitionInput {
  const { sleepMs = 0, autopilot = false } = opts;
  return {
    projectId,
    autopilot,
    nodes: [
      { key: 'N0', nodeKey: 'demo.canvas.N0', dependsOn: [], config: { sleepMs } },
      {
        key: 'N1',
        nodeKey: 'demo.canvas.N1',
        dependsOn: ['N0'],
        config: { sleepMs },
        isCheckpoint: true,
        checkpointConfig: null, // checkpoint normal: pausa salvo autopilot
      },
      { key: 'N2', nodeKey: 'demo.canvas.N2', dependsOn: ['N1'], config: { sleepMs } },
      {
        key: 'N3',
        nodeKey: 'demo.canvas.N3',
        dependsOn: ['N2'],
        config: { sleepMs },
        isCheckpoint: true,
        checkpointConfig: { alwaysPause: true }, // el candado: pausa AUNQUE autopilot
      },
      {
        key: 'N4',
        nodeKey: 'demo.canvas.N4',
        dependsOn: ['N3'],
        config: { sleepMs, failRate: 1 }, // falla siempre → error + retry
      },
      // N5 depende de N4: mientras N4 no succeeda, N5 está en `awaiting_deps`
      // (skippable desde el panel, transitions.ts). Es el nodo skippable.
      { key: 'N5', nodeKey: 'demo.canvas.N5', dependsOn: ['N4'], config: { sleepMs } },
    ],
  };
}
