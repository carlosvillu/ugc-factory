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
  // §12 (l.495): la variante a la que pertenece este step, cuando el nodo es POR VARIANTE (N6/N7 del
  // DAG de generación, T4.11). `null` para los nodos únicos del run (N1..N5, demo). Es identidad
  // SEPARADA de `node_key` (que se queda limpio `N7c`, reconocible por §12 y por el registro de
  // executors): dos variantes que comparten body/CTA producen dos steps con el MISMO `node_key` en el
  // MISMO run, distinguidos por este `variant_id` (y por él el `singletonKey` de encolado no colisiona).
  variantId: string | null;
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
  // §7.1.b (T0.8): banderas de checkpoint. Al superseder un sub-grafo, la fila
  // nueva copia estas del step original para re-ejecutar idéntico.
  isCheckpoint: boolean;
  checkpointConfig: unknown;
  // Artefactos de salida del step (`output_refs`, jsonb). El diff de auditoría
  // (§19.1) compara el output_refs de la IA (el original) contra el editado.
  outputRefs: unknown;
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
   * `timeout_at` del step (T0.9): el instante tras el cual el sweeper lo lleva a
   * `expired` si sigue `running`. Se fija en el `start` (queued→running) a
   * `now + timeoutFor(nodeKey, config)` (timeout.ts). `undefined` = no tocar la
   * columna; un `Date` = escribirlo. No se limpia en los terminales: un step
   * `expired`/`succeeded` conserva su `timeout_at` histórico, y el sweeper solo
   * mira los `running` (el filtro de estado es load-bearing, jobs.md §8).
   */
  timeoutAt?: Date;
  /**
   * `output_refs` editado (T0.8): un `edit` en checkpoint reemplaza los artefactos
   * de la IA por los del usuario. `undefined` = no tocar; cualquier valor
   * (incluido `null`) se escribe. Solo el path de edición lo usa.
   */
  outputRefs?: unknown;
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
  /**
   * Resetea `retry_count` a 0 (T0.9, retry MANUAL). Un retry disparado por un
   * humano (`POST /api/steps/:id/retry`) concede un intento nuevo aunque los
   * automáticos estuvieran agotados (`retry_count >= max_retries`): la
   * intervención humana suele ir acompañada de un arreglo (cambio de `config`,
   * etc.). El reset ocurre EN EL MISMO UPDATE que el `retry`, bajo el lock. Se
   * excluye mutuamente con `incrementRetryCount` (un UPDATE no hace las dos). `undefined`/`false` = no tocar.
   */
  resetRetryCount?: boolean;
  /**
   * `config` per-step (T0.9): el nuevo valor de `config` a escribir en la fila.
   * A ESTE nivel (el store) REEMPLAZA la config completa — no mergea sobre la jsonb
   * existente. El MERGE de un patch parcial de retry NO vive aquí sino en
   * `retryStep` (retry.ts), que lee la config actual y superpone el patch ANTES de
   * llamar a `update`; el store recibe ya el resultado final. Se escribe en la MISMA
   * tx que el `retry`, antes de re-encolar, de modo que el executor re-lee la config
   * nueva. `undefined` = no tocar; cualquier valor (incluido `null`) reemplaza.
   */
  config?: unknown;
  /**
   * `error` del step (T0.11): el mensaje/detalle del fallo del executor, escrito en
   * el `fail` (running→failed) para que el panel del canvas lo muestre en su visor
   * de logs (Verificación T0.11: "provocar un fallo y ver el error en el visor de
   * logs del nodo"). jsonb opaco (típicamente `{ message: string }`). `undefined` =
   * no tocar; cualquier valor (incluido `null`) se escribe. El `retry` posterior lo
   * limpia (null) para que un reintento exitoso no arrastre el error viejo.
   */
  error?: unknown;
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
   * Para cada id, ¿está el step RESUELTO (dep satisfecha)? Una dep se satisface con
   * `succeeded` O con `skipped` (T0.8): un nodo saltado cuenta como dep cumplida a
   * efectos de habilitar a sus dependientes — si no, un dependiente de un nodo
   * skippeado quedaría varado en `awaiting_deps` para siempre y el run no
   * completaría. Devuelve un mapa id→bool; ids ausentes ⇒ false.
   */
  resolvedStatus(ids: string[]): Promise<Record<string, boolean>>;
  /**
   * Bloquea `{stepId} ∪ (cierre transitivo aguas abajo)` en UNA query, `FOR UPDATE`
   * en orden por id (T0.8). Es la adquisición de locks de `editStep` ANTES de
   * cualquier transición: lockear E junto a su cierre en orden de id monótono evita
   * el deadlock 40P01 con `cancelRun` (que lockea el run entero por id). Incluye a
   * `stepId`.
   */
  findStepAndClosureForUpdate(stepId: string): Promise<StepRow[]>;
  /**
   * Todos los steps NO-terminales del run `runId` (T0.8, cancel): los que admiten
   * `cancel` (awaiting_deps/pending/queued/submitting/running/waiting_approval/
   * failed). LOCKEADOS con `FOR UPDATE` en orden por id. Es el barrido que `cancelRun`
   * aplica para detener un run entero de forma atómica.
   */
  findCancellableByRun(runId: string): Promise<StepRow[]>;
  /**
   * Invalidación (§7.1.c): inserta una fila NUEVA de step_run que SUPERSEDE a otra.
   * `supersedesId` apunta a la fila anterior; JAMÁS se resetea la antigua (eso lo
   * hace el evento `supersede` por separado). Devuelve el id de la nueva fila.
   */
  insertSuperseding(row: NewSupersedingStepRow): Promise<void>;
}

/**
 * Fila nueva creada por la invalidación de sub-grafo (T0.8). Mismo `node_key` que
 * la anterior, `supersedesId` apuntando a ella, `dependsOn` YA remapeado a los
 * nuevos ids del sub-grafo (o a los ids originales para deps fuera del cierre), y
 * el estado inicial recalculado (`pending` si todas sus deps ya están resueltas,
 * `awaiting_deps` si no). Copia `config`/`isCheckpoint`/`checkpointConfig` del
 * step original para que la re-ejecución sea idéntica.
 */
export interface NewSupersedingStepRow {
  id: string;
  runId: string;
  nodeKey: string;
  // §12: la fila que supersede CONSERVA el `variant_id` de la superseded (T4.11): re-ejecutar un N7
  // invalidado de una variante debe seguir siendo esa variante (para el singletonKey y el nodo compuesto
  // del canvas). `undefined` ⇒ columna NULL (nodos únicos del run).
  variantId?: string;
  status: StepStatus; // 'pending' | 'awaiting_deps'
  dependsOn: string[];
  supersedesId: string;
  config: unknown;
  isCheckpoint: boolean;
  checkpointConfig: unknown;
}

/**
 * Lo que la invalidación / los endpoints de checkpoint escriben en `audit_log`
 * (§19.1): el diff artefacto-IA vs artefacto-editado en cada edit/approve/reject.
 * Tx-scoped como el resto de stores: la fila de auditoría se escribe en la MISMA
 * transacción que la transición, o no se escribe (rollback).
 */
export interface AuditEntry {
  /** Quién actuó. Mono-usuario ⇒ valor fijo (`'user'`). */
  actor: string;
  /** Qué acción (`edit` | `approve` | `reject`). */
  action: string;
  /** Entidad afectada (`'step_run'`). */
  entity: string;
  /** Id de la entidad (el step). */
  entityId: string;
  /** Diff en JSONB: el antes (output_refs de la IA) vs el después (editado). */
  diff: unknown;
}

/** Writer de `audit_log` (§19.1): primer writer de la tabla (T0.8). */
export interface AuditStore {
  write(entry: AuditEntry): Promise<void>;
}

/**
 * ROLLUP DEL COSTE REAL (T1.20). El puerto por el que el orquestador recomputa el dinero
 * ya gastado y lo deja escrito en las columnas que la UI lee (`step_run.cost_actual`,
 * `pipeline_run.total_cost_actual`) — SIN saber que existe una tabla `cost_entry`, ni
 * Drizzle, ni SQL. La VERDAD del dinero es siempre el ledger (`cost_entry`, append-only,
 * record-first en los servicios): estas columnas son una PROYECCIÓN recomputable de él.
 *
 * POR QUÉ ES UN PUERTO Y NO UNA LLAMADA DEL CONSUMER (el diseño de T1.20). Antes, el
 * rollup lo invocaba el consumer del worker justo antes de cerrar el step. Eso deja la
 * columna MINTIENDO en todos los caminos de cierre que NO pasan por el consumer: el
 * `fail` con retries agotados, el `expire` del sweeper, el `cancel` de un run, el
 * `reject` de un checkpoint, el `supersede` de una invalidación… Un step que falló
 * HABIENDO GASTADO se quedaba con `cost_actual` NULL (los dos runs muertos del usuario:
 * 16¢ y 13¢ en el ledger, $0,00 en el nodo del canvas). Parchear los caminos uno a uno es
 * enumerar; el embudo único por el que pasan TODOS es `applyTransition`, y ahí es donde el
 * rollup corre ahora — por construcción, no por enumeración.
 *
 * CONTRATO CRÍTICO: **estas operaciones NUNCA lanzan**. El rollup es una proyección
 * recomputable; su fallo es "una columna desactualizada", jamás "dinero perdido" ni una
 * transición perdida. Un throw abortaría la transición (el step no cerraría, el NOTIFY no
 * saldría) — al revés de lo que importa. Y no basta con un try/catch en core: dentro de una
 * transacción de Postgres, un statement que falla ENVENENA la transacción entera (todo lo
 * siguiente da 25P02), así que capturarlo en JS no la salvaría. El aislamiento tiene que ser
 * una propiedad de Postgres —un SAVEPOINT— y por eso vive en el ADAPTADOR (`packages/db`), que
 * es la única capa que puede darla. Core solo declara la garantía y confía en ella.
 *
 * SEGUNDO CONTRATO, y por eso `rollupRun` puede llamarse en CADA cierre sin miedo: el
 * adaptador DEDUPLICA `rollupRun` por transacción (recomputa el agregado de un run UNA vez por
 * tx, aunque se le pida N veces). Core no tiene que llevar esa contabilidad: llama y ya. Por qué
 * es correcto y qué ahorra: cost-store.ts §2, que es donde vive el `Set`.
 */
export interface CostStore {
  /** Recomputa `step_run.cost_actual` del step desde el ledger. Toca solo la fila de `step_run`,
   *  que el llamante YA tiene lockeada. Best-effort: no lanza. */
  rollupStep(stepId: string): Promise<void>;
  /** Recomputa `pipeline_run.total_cost_actual` del run desde el ledger. Best-effort: no lanza.
   *  DEDUPLICADO por transacción en el adaptador: llamarlo N veces con el mismo runId dentro de
   *  una tx ejecuta UN solo UPDATE (los caminos que cierran N steps —cancel, invalidación— lo
   *  invocan una vez por step, y basta con la primera). */
  rollupRun(runId: string): Promise<void>;
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
  /** Writer de audit_log (§19.1, T0.8): diff artefacto-IA vs editado en checkpoints. */
  audit: AuditStore;
  /** Rollup del coste real desde el ledger (T1.20). Corre DENTRO de la transición que
   *  liquida el step; nunca lanza (ver CostStore). */
  costs: CostStore;
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
  // §7.1.b (T0.8): el run arranca en autopilot (sin pausas en checkpoints salvo
  // override per-nodo). Default false. La define `POST /api/runs`.
  autopilot: boolean;
}
export interface NewStepRow {
  id: string;
  runId: string;
  nodeKey: string;
  // §12: la variante del step si el nodo es por-variante (N6/N7, T4.11), o `undefined` (nodo único
  // del run → columna NULL). Ver `StepRow.variantId`.
  variantId?: string;
  status: StepStatus; // 'pending' (root) | 'awaiting_deps' (dependiente)
  dependsOn: string[]; // ULIDs de los steps de los que depende (ya resueltos)
  config: unknown; // parámetros del executor (step_run.config), o null
  // §7.1.b (T0.8): banderas de checkpoint tomadas de la definición del DAG.
  isCheckpoint: boolean;
  checkpointConfig: unknown;
  // Override per-nodo del tope de reintentos (T4.11, MONEY POINT deuda T4.10b). `undefined` ⇒ no
  // se escribe la columna y aplica el default de BD (`step_run.max_retries` = 3). Los nodos N7 lo
  // suben para que el presupuesto de retry de la carrera-perdedora de dedup sobreviva la latencia
  // peor-caso del ganador (Veo, minutos); ver `RunNodeSchema.maxRetries`.
  maxRetries?: number;
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
