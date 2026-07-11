// Contrato del executor de un nodo (T0.7b): lo que el consumer genérico de
// `step.execute` (apps/worker) invoca tras poner el step en `running`. El
// executor hace el TRABAJO del nodo (llamada a fal, FFmpeg, o —en F0— nada más
// que dormir/fallar/colgarse); NO toca el estado del step: eso lo hace el
// consumer vía `transition()`. Un throw del executor = fallo del step; un retorno
// = éxito.
//
// Vive en core (contrato) para que la definición del DAG y los tests lo
// compartan; las IMPLEMENTACIONES (demo y, más tarde, los nodos reales) viven en
// apps/worker (jobs.md §4). El shape de `config` es opaco aquí: cada executor
// parsea el suyo.
import { z } from 'zod';
import type { StepStatus } from './transitions';

/**
 * Fallo PERMANENTE de un executor: el trabajo NO se va a arreglar reintentándolo, así
 * que el consumer lo lleva a `failed` TERMINAL con `transition('fail')` en vez de pasar
 * por `failStep` (que gatearía `retry_count` y lo reencolaría hasta agotar
 * `max_retries`). Es el MISMO criterio —y el mismo camino— que el consumer ya aplica al
 * "executor desconocido" (step-execute.ts): reintentar lo irreparable solo quema
 * recursos.
 *
 * POR QUÉ EXISTE (T1.10a): en un nodo de PAGO reintentar un fallo determinista quema
 * DINERO REAL. N3 (síntesis con Sonnet 5, ~$0,20/llamada) puede terminar en `refused` o
 * `parse_error`: son decisiones del modelo sobre un contenido DADO, así que las 3
 * vueltas de retry producirían el MISMO fallo y cobrarían 3 veces (~$0,60 tirados para
 * acabar igualmente en `failed`). Coherente con T1.8, donde el sintetizador ya reintenta
 * SOLO el `parse_error` internamente y NUNCA el `refused`, por esta misma razón.
 *
 * La regla para elegir:
 *  - TRANSITORIO (throw normal ⇒ retry): timeout de red, 5xx del proveedor, BD caída.
 *    Otra vuelta tiene una posibilidad REAL de ir bien.
 *  - PERMANENTE (esta clase ⇒ sin retry): la entrada es la que es y el resultado será el
 *    mismo — config inválida, refusal del modelo, contrato incumplido. Otra vuelta paga
 *    otra vez para fallar igual.
 */
export class PermanentStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentStepError';
  }
}

/** Lo que recibe un executor: la config per-step (de `step_run.config`) y una
 *  señal de aborto (shutdown/expiración del job — la propaga el consumer).
 *
 *  T1.10a — extensión ADITIVA (todos los campos nuevos OPCIONALES, así los
 *  executors de demo de F0 y cualquier caller/test existente que construya
 *  `{ config, signal }` a mano siguen compilando sin tocarlos):
 *  - `runId`/`stepId` (ULIDs): para que un executor real (N1/N2/N3) identifique su
 *    propio step y pueda resolver los outputs de sus DEPENDENCIAS (leer
 *    `dependsOn`/`outputRefs` de los steps predecesores del mismo run — p. ej. N3
 *    necesita el RawContent de N1 y el VisualAnalysis de N2). SIEMPRE presentes en
 *    producción (el consumer los pasa); ausentes solo en callers de test antiguos.
 *  - `collectOutput`: canal de SALIDA del executor hacia el consumer — simétrico a
 *    cómo el consumer captura el `throw` del executor para `failStep(...,{error})`.
 *    Como `StepExecutor` sigue siendo `Promise<void>` (no se cambia su firma), un
 *    executor que produce un artefacto (RawContent/VisualAnalysis/ProductBrief) lo
 *    entrega llamando a `collectOutput(refs)` antes de retornar; el consumer lo pasa
 *    a `transition('succeed', {outputRefs})` en la MISMA transición que el éxito
 *    (ports.ts StepPatch.outputRefs). Los executors de demo nunca lo llaman.
 *  - `markInapplicable`: el executor declara que su nodo NO APLICA en este run (PRD
 *    §7.1: "skipped (nodo no aplicable, p. ej. N2 sin imágenes)"; §7.2, ficha de N2:
 *    "si no hay ninguna → skipped"). Lo llama y RETORNA con normalidad — no lanza,
 *    porque no es un fallo. El executor NO aplica la transición él mismo: mantiene el
 *    invariante de T0.7b ("el executor NO toca el estado del step") y deja que el
 *    CONSUMER elija el evento de cierre — `skip_inapplicable` en vez de `succeed`—,
 *    exactamente igual que ya elige `reach_checkpoint` vs `succeed` para un
 *    checkpoint. Si además llama a `collectOutput`, ese motivo se persiste en
 *    `output_refs` (el panel explica POR QUÉ se saltó el nodo).
 *  - `deps`: los steps de los que ESTE step depende, YA RESUELTOS por el consumer, con su
 *    `outputRefs`. El executor no vuelve a la BD ni sabe cómo se llaman sus vecinos.
 *
 *    RESUELTOS POR ULID, NO POR `node_key` — y esto no es un detalle: `node_key` NO es único
 *    dentro de un run. La invalidación de un checkpoint (T0.8, `insertSuperseding`) crea una
 *    fila NUEVA con el MISMO `node_key` que la que supersede. Un executor que buscara "el
 *    step N1 de mi run" por su clave podría leer el artefacto de una fila `superseded`
 *    (datos viejos) sin lanzar un error — silencioso. `StepRow.dependsOn` trae los ULIDs
 *    EXACTOS de los predecesores y el supersede los REMAPEA, así que resolver por ahí es
 *    correcto por construcción. Además escala a F2–F4, donde una variante por fila de la
 *    matriz significa decenas de nodos hermanos sin un `node_key` singular que buscar. */
export interface ExecutorContext {
  config: unknown;
  signal?: AbortSignal;
  runId?: string;
  stepId?: string;
  collectOutput?: (outputRefs: unknown) => void;
  markInapplicable?: () => void;
  deps?: ExecutorDep[];
}

/** Una dependencia YA resuelta de un step: su identidad, su estado terminal y el artefacto
 *  que dejó. `outputRefs` es `unknown` (jsonb opaco): quien lo consume lo valida contra su
 *  schema (contracts/step-outputs.ts). */
export interface ExecutorDep {
  stepId: string;
  nodeKey: string;
  status: StepStatus;
  outputRefs: unknown;
}

/** Un executor: ejecuta el nodo. Retorna (éxito) o lanza (fallo). */
export type StepExecutor = (ctx: ExecutorContext) => Promise<void>;

/**
 * Flags de los executors de DEMO (F0): el harness que las verificaciones de gate
 * de T0.7b/T0.9 necesitan para provocar comportamientos observables sin nodos
 * reales.
 *  - `sleepMs`: duerme N ms antes de terminar (simula trabajo; observa el paso
 *    por `running`).
 *  - `failRate`: probabilidad [0..1] de LANZAR en este intento (ejercita el path
 *    fail→retry→queued y el agotamiento de `retry_count`). Per-INTENTO, no
 *    per-step: un `failRate < 1` converge con reintentos.
 *  - `hang`: si `true`, NO retorna nunca (espera al abort). Andamiaje para el
 *    sweeper de T0.9; en T0.7b nada lo expira todavía.
 */
export const DemoConfigSchema = z.strictObject({
  sleepMs: z.number().int().nonnegative().optional(),
  failRate: z.number().min(0).max(1).optional(),
  hang: z.boolean().optional(),
  // Coste INYECTABLE (T0.12): si un step de demo lleva `costCents` en su config, el
  // executor registra ese cargo en `cost_entry` al terminar con éxito (mismo patrón
  // config-injectable que `failRate`/`sleepMs`). Es el reachability gate del ledger:
  // el verifier lanza 3 runs de demo con SUS importes y `/spend` los suma. `costCents`
  // en céntimos ENTEROS (coherente con el modelo de dinero del proyecto). `costProvider`
  // etiqueta el proveedor (default 'other'); `costQuantity`/`costUnit` describen la
  // facturación (opcionales). El coste se registra SOLO en el path de éxito.
  costCents: z.number().int().nonnegative().optional(),
  costProvider: z.enum(['fal', 'anthropic', 'firecrawl', 'other']).optional(),
  costQuantity: z.number().int().nonnegative().optional(),
  costUnit: z.string().optional(),
  // `timeout_ms` (T0.9): NO es un flag del executor de demo — es el override de
  // timeout que lee el orquestador (timeout.ts) para fijar `timeout_at`. Se
  // declara aquí (ignorado por el executor) para que un step de demo pueda llevar
  // AMBAS cosas en su `config` sin que el strictObject lo rechace: la Verificación
  // de T0.9 configura `demo.hang` con `{ hang: true, timeout_ms: 10000 }`.
  timeout_ms: z.number().int().positive().optional(),
});
export type DemoConfig = z.infer<typeof DemoConfigSchema>;
