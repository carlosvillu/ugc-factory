// Puertos del orquestador (backend/references/architecture.md §2). Un puerto vive
// junto al módulo que lo consume: `transition()` (§9.0, transition.ts) los usa
// para tocar la BD y la cola SIN saber que Drizzle o pg-boss existen. Las
// IMPLEMENTACIONES viven en `packages/db` (adaptadores tx-scoped). Frontera dura
// de core (SKILL.md backend, principio 1): este fichero NUNCA importa drizzle ni
// pg-boss.
import type { EnqueueRequest } from '../jobs';
import type { StepStatus } from './transitions';

/**
 * Encola un job para su ejecución. En T0.6 la implementación (apps/worker) hace
 * `boss.send()` con el pool propio de pg-boss. En T0.7a `transition()` lo usa con
 * un adaptador tx-scoped (`fromDrizzle`) para que el INSERT del job comparta la
 * transacción de la transición de estado (jobs.md §5) — por eso el puerto NO abre
 * ni posee su propia conexión: recibe pg-boss (o la tx) desde el composition
 * root, dejando ese seam abierto sin construirlo aquí.
 */
export interface JobQueue {
  enqueue(req: EnqueueRequest): Promise<void>;
}

/**
 * La forma de un `step_run` que el orquestador necesita LEER para decidir (§7.1
 * + resolución de deps). Es un subconjunto del shape de persistencia (db.md §2):
 * db mapea su fila a esto; core no ve columnas que no usa. Los tipos de estado
 * son los de la máquina pura (transitions.ts), no strings de la BD.
 */
export interface StepRow {
  id: string;
  runId: string;
  nodeKey: string;
  status: StepStatus;
  dependsOn: string[];
  // Contador de reintentos y su tope (§7.1). El consumer los lee BAJO el lock
  // (vienen de findForUpdate) para gatear `retry_count < max_retries` antes de
  // disparar el evento `retry` — agotado ⇒ el step queda `failed` terminal
  // (T0.7b). Leerlos bajo el lock, no en una query aparte, es lo que hace la
  // decisión coherente con la transición.
  retryCount: number;
  maxRetries: number;
  // Config general per-step del nodo (T0.7b): parámetros del executor
  // (`sleep_ms`, `fail_rate`, `hang` para los de demo). El consumer se la pasa al
  // executor. `null` si el nodo no tiene parámetros. Shape opaco para core: lo
  // interpreta cada executor.
  config: unknown;
}

/**
 * Cambios que `transition()` escribe sobre un step. Todos opcionales salvo
 * `status`: el orquestador fija timestamps (`startedAt`/`finishedAt`) según la
 * transición, y db traduce el patch a un UPDATE.
 *
 * Tres estados por campo, deliberadamente distintos: `undefined` = no tocar la
 * columna; un `Date` = escribir ese instante; `null` = poner la columna a NULL.
 * `finishedAt: null` es load-bearing: el retry (failed→queued) debe LIMPIAR el
 * `finished_at` que fijó el `fail`, o durante el reintento quedaría
 * `finished_at < started_at` (incoherente). `startedAt` no necesita null: el
 * `start` posterior lo sobrescribe.
 */
export interface StepPatch {
  status: StepStatus;
  startedAt?: Date;
  finishedAt?: Date | null;
  /**
   * Incremento ATÓMICO de `retry_count` (T0.7b). El consumer, tras un fallo de
   * executor y bajo el lock de la fila, decide reintentar (failed→queued vía
   * `retry`) e incrementar el contador EN EL MISMO UPDATE. Es un `boolean`, no un
   * número, a propósito: el adapter lo traduce a `retry_count = retry_count + 1`
   * en SQL, de modo que el incremento ocurre en la BD bajo el lock (sin
   * leer-en-JS-y-reescribir, que abriría una ventana de lost-update). `undefined`
   * / `false` = no tocar el contador.
   */
  incrementRetryCount?: boolean;
}

/**
 * Acceso a `step_run` bajo el patrón transaccional (§9.0, db.md §6). El store es
 * SIEMPRE tx-scoped: lo construye `WithTransaction` con la tx abierta, así
 * `findForUpdate` toma el lock de fila y `update` escribe en la MISMA tx.
 */
export interface StepStore {
  /**
   * `SELECT … FOR UPDATE` sobre la fila: la bloquea hasta el commit y devuelve su
   * estado BAJO el lock. `null` si no existe. Es la disciplina anti-carrera:
   * webhook (web) y consumer (worker) que llegan a la vez se serializan aquí, y
   * el perdedor re-lee el estado ya cambiado (db.md §6).
   */
  findForUpdate(id: string): Promise<StepRow | null>;
  /** Aplica el patch (UPDATE) a la fila ya lockeada. */
  update(id: string, patch: StepPatch): Promise<void>;
  /**
   * Steps del MISMO run que dependen de `stepId` vía `depends_on` (aguas abajo),
   * BLOQUEADOS con `SELECT … FOR UPDATE` y en orden determinista por id.
   *
   * El `FOR UPDATE` sobre los dependientes NO es opcional: es lo que evita un
   * lost-wakeup cuando dos deps de un mismo step completan a la vez. Escenario:
   * stepB depende de stepA1 Y stepA2; `transition(stepA1,'succeed')` y
   * `transition(stepA2,'succeed')` corren concurrentes y cada una lockea SOLO su
   * propia fila (distintas, sin contención). Bajo READ COMMITTED cada una vería
   * la hermana aún pending (la otra tx sin commit) y NO promovería a stepB →
   * stepB varado en `awaiting_deps` para siempre. Lockeando el dependiente, las
   * dos completadoras se serializan en el lock de stepB: la segunda re-lee el
   * estado ya committeado de la hermana y encola EXACTAMENTE una vez. Es la misma
   * propiedad de db.md §6, aplicada al borde aguas abajo del grafo.
   *
   * Orden por id + DAG + lockear el step que dispara ANTES que sus dependientes ⇒
   * sin deadlock 40P01 (db.md §6).
   */
  findDependents(stepId: string): Promise<StepRow[]>;
  /**
   * Para cada id, ¿está el step en `succeeded`? Resuelve si las OTRAS deps de un
   * dependiente ya están satisfechas antes de promoverlo a `pending`.
   */
  succeededStatus(ids: string[]): Promise<Record<string, boolean>>;
}

/**
 * Emite `NOTIFY pipeline_events, '<run_id>'` (db.md §6, paso 5). Tx-scoped: el
 * NOTIFY va DENTRO de la tx y Postgres lo entrega solo en COMMIT — un rollback
 * lo silencia sin código de compensación. El consumidor del canal es el cliente
 * SSE (T0.10); aquí solo se emite.
 */
export interface RunNotifier {
  notify(runId: string): Promise<void>;
}

/**
 * Los stores tx-scoped que `WithTransaction` entrega al callback del
 * orquestador: todos comparten la MISMA transacción Drizzle. Crece con el
 * orquestador (runs, generations…) — se añade el store aquí y en el adaptador,
 * en el mismo PR (db.md §5).
 */
export interface TxStores {
  steps: StepStore;
  jobs: JobQueue;
  events: RunNotifier;
  runs: RunStore;
}

/**
 * Filas a insertar al crear un run (T0.7b). `RunStore` las persiste en la MISMA
 * transacción que el encolado de los roots (createRun.ts), de modo que un crash
 * entre el INSERT y el encolado no deja un run varado. Shapes mínimos: solo lo
 * que el orquestador escribe; db mapea a sus columnas.
 */
export interface NewRunRow {
  id: string;
  projectId: string;
}
export interface NewStepRow {
  id: string;
  runId: string;
  nodeKey: string;
  status: StepStatus; // 'pending' (root) | 'awaiting_deps' (dependiente)
  dependsOn: string[]; // ULIDs de los steps de los que depende (ya resueltos)
  config: unknown; // parámetros del executor (step_run.config), o null
}

/**
 * Persiste el run y sus steps al crear un run (T0.7b). Tx-scoped como el resto de
 * stores: el INSERT comparte la transacción con el encolado atómico de los roots.
 */
export interface RunStore {
  insertRun(run: NewRunRow): Promise<void>;
  insertSteps(steps: NewStepRow[]): Promise<void>;
}

/**
 * Abre UNA transacción y ejecuta `fn` con los stores tx-scoped, devolviendo su
 * resultado; si `fn` lanza, la tx hace ROLLBACK (des-encola el job, silencia el
 * NOTIFY — la atomicidad que elimina las carreras webhook/consumer, §9.0). La
 * implementación (db.md §5) envuelve `db.transaction()`; core la invoca sin
 * saberlo.
 */
export type WithTransaction = <T>(fn: (stores: TxStores) => Promise<T>) => Promise<T>;
