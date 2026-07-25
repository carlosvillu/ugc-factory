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
import { makeN6Executor } from './compile-prompt';
import { type GenerationExecutorDeps, makeN7aExecutor } from './generation';
import { makeN7bExecutor } from './generate-voice';
import { makeN7cExecutor } from './generate-avatar';
import { makeN7dExecutor } from './generate-broll';
import { makeN7fExecutor } from './generate-cta';
import { makeN7eExecutor } from './generate-music';
import { makeN8Executor } from './compose-variant';
import { makeN9Executor } from './qa-verdict';

export interface ExecutorRegistryDeps {
  /** Decisor de fallo de los executors de demo, resuelto por bootstrap. */
  demoShouldFail: DemoFailDecider;
  /** Registrador de coste de los executors de demo (T0.12), cableado por createBoss. */
  demoRecordCost: DemoCostRecorder;
  /** Deps de los nodos REALES del análisis (T1.10a): BD, storage, secretos y los
   *  overrides de base URL de los clientes externos (el stack E2E los apunta a su fake). */
  analysis: AnalysisExecutorDeps;
  /** Deps de los executors de GENERACIÓN (T4.4, N7a): BD + storage + la fal-key. `falKey` es un THUNK
   *  async que la resuelve de `app_setting` (cifrada, misma fuente que web) EN CADA STEP: un worker sin
   *  key configurada arranca y sirve todo lo demás, y el step de generación que la necesita falla
   *  PERMANENTE —con mensaje accionable (Ajustes → fal)— hasta que se configure. */
  generation: GenerationExecutorDeps;
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
  generation,
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
    // N6 · COMPILADOR DE PROMPTS (T3.5 esqueleto → T4.11 flujo LIVE): determinista y $0 (§9.3, como N4).
    // El motor de compilación vive completo en `@ugc/core/gallery` (golden files); este executor RESUELVE
    // LAS FUENTES. T4.11 le da la BD (`analysis.db`, patrón de N4/N5) para ENSAMBLAR el `N6Sources` de la
    // variante (brief+persona+guion+facetas) cuando corre como RAÍZ del sub-DAG de generación — la costura
    // stepless de T3.5 (fuentes por dep) se conserva y precede a la BD.
    // T5.12: además del `db`, el LOGGER (reusa el del grupo `generation`) para que la degradación de
    // faceta —category libre del LLM que ningún template reconoce— salga por el log estructurado en vez
    // de quedarse muda. ⚠ `generation.logger` es OPCIONAL en el tipo: si el composition root no lo
    // cablea, esto es un no-op SILENCIOSO (fue exactamente el bug que destapó el verifier de T5.12 —
    // el comentario anterior afirmaba que boss.ts ya lo pasaba, y era FALSO). Lo que garantiza que
    // llegue de verdad es `boss-wiring.test.ts`, que monta la composición REAL.
    N6: makeN6Executor({
      db: analysis.db,
      ...(generation.logger !== undefined ? { logger: generation.logger } : {}),
    }),
    // N7a · PRODUCT SHOTS, ruta packshot-IA (T4.4, §7.2). PAGA fal (text-to-image flux-2): estrena el
    // grupo de deps `generation` (BD + storage + FAL_KEY perezosa). T4.11 lo cablea como nodo del DAG
    // (step_run_id/variant_id); en T4.4 corre STEPLESS (el smoke conduce `ai_packshot` sin step).
    N7a: makeN7aExecutor(generation),
    // N7b · TTS + WORD TIMESTAMPS (T4.5, §7.2 N7b + §13.1). PAGA fal (cadena TTS→ASR): reusa el mismo
    // grupo de deps `generation` (BD + storage + FAL_KEY perezosa). T4.11 lo cablea como nodo del DAG;
    // en T4.5 corre STEPLESS (el smoke conduce la cadena sin step). ⚠ T4.11 debe hacer el sweeper/
    // `output.download` kind-aware ANTES de cablearlo (una generación de audio recogida por la vía de
    // imagen del sweeper explotaría — marcadores en output-download.ts + reconcile.ts).
    N7b: makeN7bExecutor(generation),
    // N7c · CLIP DE AVATAR, tiers image+audio (T4.7, §7.2 N7c). PAGA fal (Kling Std / OmniHuman Premium):
    // reusa el mismo grupo de deps `generation` (BD + storage + FAL_KEY perezosa). T4.11 lo cablea como
    // nodo del DAG; en T4.7 corre STEPLESS (el smoke conduce el clip sin step). ⚠ T4.11 debe hacer el
    // sweeper/`output.download` kind-aware ANTES de cablearlo (una generación de VÍDEO recogida por la
    // vía de imagen del sweeper explotaría — marcadores en output-download.ts + reconcile.ts).
    N7c: makeN7cExecutor(generation),
    // N7d · B-ROLL POR ESCENA (T4.8, §7.2 N7d + §7.5). PAGA fal (Veo 3.1 i2v/R2V por segundo): reusa el
    // mismo grupo de deps `generation` (BD + storage + FAL_KEY perezosa). Genera 1 clip por escena de
    // BODY (troceando escenas > maxDuration), b-roll SILENCIOSO (la voz es de N7b). T4.11 lo cablea como
    // nodo del DAG; en T4.8 corre STEPLESS (el smoke conduce los clips sin step). ⚠ T4.11 debe hacer el
    // sweeper/`output.download` kind-aware ANTES de cablearlo (una generación de VÍDEO recogida por la
    // vía de imagen del sweeper explotaría — marcadores en output-download.ts + reconcile.ts).
    N7d: makeN7dExecutor(generation),
    // N7f · CLIP DE CTA (T5.5a, §7.5 «la CTA es product shot animado»). PAGA fal (Veo 3.1 i2v por
    // segundo): reusa el grupo de deps `generation` Y el servicio `runGenerateBroll` con
    // `assetKind:'cta_clip'` (la CTA animada es i2v de un keyframe, idéntica al b-roll). Genera el clip
    // de la escena `cta` animando el keyframe de product shot de N7a; clip SILENCIOSO (la voz es de N7b).
    N7f: makeN7fExecutor(generation),
    // N7e · BED MUSICAL IA (T4.9, §7.2 N7e). PAGA fal (ace-step por segundo, $0,0002/s): reusa el mismo
    // grupo de deps `generation` (BD + storage + FAL_KEY perezosa). Genera UN bed instrumental por MOOD
    // (`tags`) y DURACIÓN para poner debajo del voiceover (§14); no itera escenas (uno cubre la variante).
    // T4.11 lo cablea como nodo del DAG (y marca `audio_source=ai_bed` en la variante); en T4.9 corre
    // STEPLESS (el smoke conduce el bed sin step). ⚠ T4.11 debe hacer el sweeper/`output.download`
    // kind-aware ANTES de cablearlo (una generación de AUDIO recogida por la vía de imagen del sweeper
    // explotaría — deuda compartida con N7b/N7d).
    N7e: makeN7eExecutor(generation),
    // N8 · COMPOSICIÓN (T5.5d, §9.7): ensambla la CompositionSpec desde los N7 y encadena el render local
    // (fitter→normalize→concat+mix→pase final+C2PA+QA→persistencia). NO paga fal → $0 runtime: solo necesita
    // BD + storage (reusa el grupo `generation`, como N4 reusa `analysis.db`). Los ports de captions los
    // importa el executor directo (funciones puras); C2PA/loudness caen a subproceso real por default (el
    // test los stubea). Sin fal-key: no la toca.
    N8: makeN8Executor({ db: generation.db, storage: generation.storage }),
    // N9 · QA + CHECKPOINT CP4 (T5.5c, §9.7 N9 / §9.0): emite el veredicto de QA de la variante leyendo el
    // `qa_report` que N8 persistió (NO re-mide → $0 runtime) y PAUSA el run en `waiting_approval` (el flag
    // `alwaysPause` del nodo lo fuerza aunque el run esté en autopilot). No necesita deps de infra (ni fal,
    // ni BD, ni storage): solo lee su dep N8 resuelta y emite → factory sin argumentos.
    N9: makeN9Executor(),
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
