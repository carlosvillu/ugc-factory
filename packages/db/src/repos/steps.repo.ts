// Repo del agregado `step_run` (db.md §4): funciones por caso de uso con el
// executor (`Db`) como PRIMER argumento, para correr igual sobre la conexión o
// dentro de la tx del orquestador. En T0.7a solo lo que `transition()` (§9.0)
// necesita: lock de fila, update, dependientes lockeados y check de succeeded.
// El resto (creación de step, snapshot del run) llega con sus consumidores.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { stepRun } from '../schema/pipeline';
import type {
  StepRow,
  StepPatch,
  NewSupersedingStepRow,
  StepSnapshot,
  StepChangedEvent,
} from '@ugc/core/orchestrator';

// Proyección mínima que el orquestador consume (StepRow del puerto). Se mapea
// aquí, no en core: db traduce su fila al contrato (db.md §5). El `status` se tipa
// con la UNIÓN DE LITERALES de core (StepRow['status']), no `string`: como el
// select viene de `stepRun.status` (enum Drizzle, misma unión de literales), no
// hace falta cast — y si el enum de la BD y el de core divergieran, fallaría el
// typecheck AQUÍ en vez de silenciarlo.
function toStepRow(row: {
  id: string;
  runId: string;
  nodeKey: string;
  status: StepRow['status'];
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  config: unknown;
  isCheckpoint: boolean;
  checkpointConfig: unknown;
  outputRefs: unknown;
}): StepRow {
  return {
    id: row.id,
    runId: row.runId,
    nodeKey: row.nodeKey,
    status: row.status,
    dependsOn: row.dependsOn,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    config: row.config,
    isCheckpoint: row.isCheckpoint,
    checkpointConfig: row.checkpointConfig,
    outputRefs: row.outputRefs,
  };
}

// Proyección compartida por los tres SELECT (findForUpdate/findDependents/…): la
// forma de StepRow del puerto. Centralizada para que un campo nuevo se añada una
// sola vez.
const stepRowColumns = {
  id: stepRun.id,
  runId: stepRun.runId,
  nodeKey: stepRun.nodeKey,
  status: stepRun.status,
  dependsOn: stepRun.dependsOn,
  retryCount: stepRun.retryCount,
  maxRetries: stepRun.maxRetries,
  config: stepRun.config,
  isCheckpoint: stepRun.isCheckpoint,
  checkpointConfig: stepRun.checkpointConfig,
  outputRefs: stepRun.outputRefs,
} as const;

/**
 * `SELECT … FOR UPDATE` sobre la fila del step: la bloquea hasta el commit y
 * devuelve su estado BAJO el lock (db.md §6, paso 1). `undefined` si no existe.
 */
export async function findStepForUpdate(db: Db, id: string): Promise<StepRow | undefined> {
  const [row] = await db
    .select(stepRowColumns)
    .from(stepRun)
    .where(eq(stepRun.id, id))
    .for('update');
  return row ? toStepRow(row) : undefined;
}

/**
 * Lectura simple (sin lock) de un step por id: `undefined` si no existe. La usa
 * el consumer genérico (T0.7b) para obtener `config`/`retry_count`/`max_retries`
 * tras arrancar el step — la revalidación bajo lock la hace `transition()`; esto
 * solo lee datos para pasar al executor y decidir el retry.
 */
export async function findStep(db: Db, id: string): Promise<StepRow | undefined> {
  const [row] = await db.select(stepRowColumns).from(stepRun).where(eq(stepRun.id, id));
  return row ? toStepRow(row) : undefined;
}

/**
 * Lectura del step PARA LA UI (T1.16): el artefacto Y el error, ENTEROS. La consume
 * `GET /api/steps/:id`, que alimenta el editor de CP1 y los visores modales del inspector.
 *
 * POR QUÉ NO ES `findStep`. `findStep` devuelve `StepRow`, que es el PUERTO del orquestador
 * (`@ugc/core/orchestrator`): la forma que el motor necesita para DECIDIR (estado, deps,
 * contadores de retry, config). Meterle `error` —un dato que solo existe para que un humano
 * lea qué pasó— contaminaría un contrato de dominio con una necesidad de pantalla. Esta es
 * una lectura de PRESENTACIÓN, hermana de `readRunSnapshot`/`readChangedSteps` (que también
 * viven aparte del puerto porque sirven al stream, no al motor).
 *
 * Y NO ES el `StepSnapshot` del SSE: ese RECORTA `output_refs` y `error` a 200 caracteres a
 * propósito (el frame del stream no es sitio para un jsonb de KB). Aquí van SIN recortar —
 * es exactamente lo que el endpoint existe para servir. Un `PermanentStepError` real de N3
 * arrastra el volcado de issues de Zod: cortado a 200 caracteres, el usuario ve el prefijo y
 * CERO issues, justo en el fallo que más necesita entender.
 */
export interface StepDetailRow {
  id: string;
  runId: string;
  nodeKey: string;
  status: StepRow['status'];
  isCheckpoint: boolean;
  /** El artefacto COMPLETO (jsonb opaco). `null` si el step aún no produjo nada. */
  outputRefs: unknown;
  /** El error COMPLETO tal cual se persistió (`{message}` del consumer). `null` si no falló. */
  error: unknown;
}

export async function findStepDetail(db: Db, id: string): Promise<StepDetailRow | undefined> {
  const [row] = await db
    .select({
      id: stepRun.id,
      runId: stepRun.runId,
      nodeKey: stepRun.nodeKey,
      status: stepRun.status,
      isCheckpoint: stepRun.isCheckpoint,
      outputRefs: stepRun.outputRefs,
      error: stepRun.error,
    })
    .from(stepRun)
    .where(eq(stepRun.id, id));
  return row ?? undefined;
}

/**
 * Steps por sus ULIDs EXACTOS, sin lock (T1.10a). La usa el consumer de `step.execute`
 * para resolver las DEPENDENCIAS de un step: `StepRow.dependsOn` ya trae los ids exactos
 * de sus predecesores, así que se leen por id y punto.
 *
 * POR ULID, NUNCA por `node_key`: `node_key` NO es único dentro de un run. La invalidación
 * (T0.8, `insertSuperseding`) crea una fila NUEVA con el MISMO `node_key` que la que
 * supersede — de modo que buscar "el step N1 de este run" por su clave devolvería una fila
 * al azar (esta query no tiene ORDER BY, y Postgres no promete orden) y un re-run podría
 * leer el artefacto de una fila `superseded` (datos viejos) sin lanzar un solo error.
 * `dependsOn` es inmune: el supersede lo REMAPEA a los ids nuevos (ver `insertSuperseding`).
 *
 * Lectura simple, igual criterio que `findStep`: no hay decisión de estado que proteger con
 * FOR UPDATE, solo datos ya persistidos por transiciones anteriores (que sí tomaron su lock
 * en su momento).
 */
export async function findStepsByIds(db: Db, ids: string[]): Promise<StepRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.select(stepRowColumns).from(stepRun).where(inArray(stepRun.id, ids));
  return rows.map(toStepRow);
}

/** Aplica el patch a la fila ya lockeada (UPDATE, db.md §6 paso 3). */
export async function updateStep(db: Db, id: string, patch: StepPatch): Promise<void> {
  await db
    .update(stepRun)
    .set({
      status: patch.status,
      ...(patch.startedAt !== undefined && { startedAt: patch.startedAt }),
      // finishedAt distingue tres casos (StepPatch): undefined = no tocar; un
      // Date = escribirlo; null = poner la columna a NULL (retry). El guard
      // `!== undefined` deja pasar el null → Drizzle escribe NULL.
      ...(patch.finishedAt !== undefined && { finishedAt: patch.finishedAt }),
      // `timeout_at` (T0.9): se fija en el `start` (queued→running). `undefined` =
      // no tocar; un Date se escribe. El sweeper (claimExpirableSteps) lo compara
      // contra now() de Postgres.
      ...(patch.timeoutAt !== undefined && { timeoutAt: patch.timeoutAt }),
      // Incremento ATÓMICO de retry_count (T0.7b): `retry_count = retry_count + 1`
      // en el propio UPDATE, bajo el lock que ya tiene findForUpdate. No se lee en
      // JS ni se reescribe un valor concreto → cero ventana de lost-update. El
      // cast asegura que Drizzle acepte la expresión SQL en el `.set` tipado.
      ...(patch.incrementRetryCount === true && {
        retryCount: sql<number>`${stepRun.retryCount} + 1`,
      }),
      // Reset de retry_count a 0 (T0.9, retry MANUAL): un intento nuevo aunque los
      // automáticos estuvieran agotados. Mutuamente excluyente con el incremento
      // (el orquestador nunca fija ambos en el mismo patch).
      ...(patch.resetRetryCount === true && { retryCount: 0 }),
      // Patch de `config` (T0.9, retry manual): mergea/reemplaza la config antes de
      // re-encolar (p. ej. fail_rate 1→0). undefined = no tocar; cualquier valor
      // (incluido null) se escribe.
      ...(patch.config !== undefined && { config: patch.config }),
      // `outputRefs` editado en un checkpoint (T0.8): `undefined` = no tocar;
      // cualquier otro valor (incluido null) se escribe. Mismo criterio que
      // finishedAt.
      ...(patch.outputRefs !== undefined && { outputRefs: patch.outputRefs }),
      // `error` del step (T0.11): el `fail` lo escribe (mensaje del executor), el
      // `retry` lo limpia a null. `undefined` = no tocar; cualquier valor (incluido
      // null) se escribe. Mismo criterio de tres-estados que outputRefs/finishedAt.
      ...(patch.error !== undefined && { error: patch.error }),
    })
    .where(eq(stepRun.id, id));
}

/**
 * Steps del MISMO run que dependen de `stepId` (aguas abajo), LOCKEADOS con
 * `FOR UPDATE` y en orden por id. El lock es load-bearing: evita el lost-wakeup
 * cuando dos deps de un mismo step completan a la vez (ver el contrato del puerto
 * StepStore.findDependents). `depends_on` es un `text[]`: el operador `= ANY`
 * (`@>` sobre el array) selecciona las filas que contienen `stepId`.
 */
export async function findDependents(db: Db, stepId: string): Promise<StepRow[]> {
  const rows = await db
    .select(stepRowColumns)
    .from(stepRun)
    // depends_on @> ARRAY[stepId]: la fila contiene stepId entre sus deps.
    .where(sql`${stepRun.dependsOn} @> ARRAY[${stepId}]::text[]`)
    .orderBy(stepRun.id) // orden determinista → sin deadlock 40P01 (db.md §6)
    .for('update');
  return rows.map(toStepRow);
}

/**
 * Para cada id, ¿está el step RESUELTO (dep satisfecha)? Devuelve un mapa id→bool.
 * Una dep se satisface con `succeeded` O con `skipped` (T0.8): un nodo saltado
 * cuenta como dep cumplida, o sus dependientes quedarían varados en
 * `awaiting_deps` para siempre. Lectura simple (corre DESPUÉS de que el
 * dependiente esté lockeado por findDependents, db.md §6). Ids ausentes ⇒ false.
 */
export async function resolvedStatus(db: Db, ids: string[]): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = Object.fromEntries(ids.map((id) => [id, false]));
  if (ids.length === 0) return result;
  const rows = await db
    .select({ id: stepRun.id, status: stepRun.status })
    .from(stepRun)
    .where(inArray(stepRun.id, ids));
  for (const row of rows) result[row.id] = row.status === 'succeeded' || row.status === 'skipped';
  return result;
}

/**
 * Bloquea `{stepId} ∪ (cierre transitivo aguas abajo)` en UNA query, `FOR UPDATE`
 * en orden por id (T0.8, FIX deadlock). Es la adquisición de locks que `editStep`
 * hace ANTES de cualquier transición: si lockeara E (el step editado) primero y el
 * cierre después, E podría quedar delante de un descendiente con id menor (los
 * ULID los genera `createRun` en orden de DEFINICIÓN, NO topológico), invirtiendo
 * el orden respecto a `cancelRun` (que lockea todo el run estricto por id) →
 * deadlock 40P01. Lockear E junto a su cierre en orden de id monótono elimina el
 * ciclo: ambas operaciones adquieren los locks del run en el mismo orden.
 *
 * Devuelve las filas lockeadas (incluye E). El closure se deriva restándole E.
 */
export async function findStepAndClosureForUpdate(db: Db, stepId: string): Promise<StepRow[]> {
  const rows = await db
    .select(stepRowColumns)
    .from(stepRun)
    .where(
      sql`${stepRun.id} IN (
        WITH RECURSIVE closure AS (
          -- Semilla: el propio step editado.
          SELECT s.id, s.run_id
          FROM step_run s
          WHERE s.id = ${stepId}
          UNION
          -- Recursión: hijos de los ya alcanzados (mismo run).
          SELECT s.id, s.run_id
          FROM step_run s
          JOIN closure c ON s.depends_on @> ARRAY[c.id]::text[]
          WHERE s.run_id = c.run_id
        )
        SELECT id FROM closure
      )`,
    )
    .orderBy(stepRun.id)
    .for('update');
  return rows.map(toStepRow);
}

/**
 * Steps NO-terminales del run (T0.8, cancel): los que admiten el evento `cancel`
 * según §7.1 (awaiting_deps, pending, queued, submitting, running,
 * waiting_approval, failed). LOCKEADOS `FOR UPDATE` en orden por id (previene
 * deadlock 40P01 con transiciones concurrentes). El barrido de `cancelRun` los
 * cancela todos en una tx para detener el run entero.
 */
const CANCELLABLE_STATES = [
  'awaiting_deps',
  'pending',
  'queued',
  'submitting',
  'running',
  'waiting_approval',
  'failed',
] as const;

export async function findCancellableByRun(db: Db, runId: string): Promise<StepRow[]> {
  const rows = await db
    .select(stepRowColumns)
    .from(stepRun)
    .where(and(eq(stepRun.runId, runId), inArray(stepRun.status, [...CANCELLABLE_STATES])))
    .orderBy(stepRun.id)
    .for('update');
  return rows.map(toStepRow);
}

/**
 * Ids de los steps COLGADOS que el sweeper debe expirar (T0.9, jobs.md §8):
 * `status='running' AND timeout_at IS NOT NULL AND timeout_at < now()`.
 *
 * El filtro `status='running'` es LOAD-BEARING: un `waiting_approval` (checkpoint
 * esperando decisión humana) conserva el `timeout_at` que fijó su `start` y NO
 * debe expirar — solo se barren los `running`. La comparación usa el `now()` de
 * Postgres (el mismo reloj que la BD, coherente con el `new Date()` que fijó
 * `timeout_at` en el host self-hosted).
 *
 * Solo devuelve ids (no lockea): el lock real lo toma `transition('expire')` por
 * fila vía `findForUpdate`. `ORDER BY id` da orden determinista de proceso — el
 * caller aplica las transiciones en ese orden (previene deadlock 40P01, db.md §6).
 * El índice parcial `step_run_sweep_idx` (sobre `timeout_at IS NOT NULL`) sirve
 * esta query.
 */
export async function findExpiredRunningStepIds(db: Db, limit = 100): Promise<string[]> {
  const rows = await db
    .select({ id: stepRun.id })
    .from(stepRun)
    .where(
      and(
        eq(stepRun.status, 'running'),
        sql`${stepRun.timeoutAt} IS NOT NULL`,
        sql`${stepRun.timeoutAt} < now()`,
      ),
    )
    .orderBy(stepRun.id)
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Invalidación (§7.1.c): inserta la fila NUEVA que supersede a otra (mismo
 * node_key, supersedes_id apuntando a la anterior). JAMÁS resetea la antigua —
 * eso lo hace el evento `supersede` por separado. Copia las banderas de checkpoint
 * para re-ejecutar idéntico.
 */
export async function insertSuperseding(db: Db, row: NewSupersedingStepRow): Promise<void> {
  await db.insert(stepRun).values({
    id: row.id,
    runId: row.runId,
    nodeKey: row.nodeKey,
    status: row.status,
    dependsOn: row.dependsOn,
    supersedesId: row.supersedesId,
    config: row.config,
    isCheckpoint: row.isCheckpoint,
    checkpointConfig: row.checkpointConfig,
  });
}

// ── Lecturas para el stream SSE (T0.10, §9.0) ────────────────────────────────
// El snapshot y los deltas leen la MISMA proyección observable de un step (la
// forma `StepSnapshot`/`StepChangedEvent` de core): identidad + estado + coste +
// un excerpt del output. NO es la fila entera de persistencia (`output_refs` puede
// ser un jsonb enorme; no viaja por SSE). Columnas mínimas → índice
// `step_run_run_id_idx` sirve la query.

// Longitud máxima del excerpt de output que viaja por el stream: un recorte, no el
// jsonb entero (un vídeo de cientos de MB reventaría el frame SSE). El cliente usa
// el excerpt solo como señal "hay output"; el artefacto completo se sirve por el
// endpoint de download.
const OUTPUT_EXCERPT_MAX = 200;

// Columnas de la proyección SSE. ENRIQUECIDAS en T0.11: el canvas React Flow
// necesita `dependsOn` (edges), `isCheckpoint` (pulso) y `startedAt`/`finishedAt`
// (duración) además del coste split. Todas YA existen en `step_run` (T0.7a/T0.9);
// solo se proyectan aquí. El índice `step_run_run_id_idx` sigue sirviendo la query.
const sseColumns = {
  id: stepRun.id,
  nodeKey: stepRun.nodeKey,
  status: stepRun.status,
  dependsOn: stepRun.dependsOn,
  isCheckpoint: stepRun.isCheckpoint,
  costActual: stepRun.costActual,
  costEstimated: stepRun.costEstimated,
  startedAt: stepRun.startedAt,
  finishedAt: stepRun.finishedAt,
  outputRefs: stepRun.outputRefs,
  error: stepRun.error,
} as const;

interface SseRow {
  id: string;
  nodeKey: string;
  status: StepSnapshot['status'];
  dependsOn: string[];
  isCheckpoint: boolean;
  costActual: number | null;
  costEstimated: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  outputRefs: unknown;
  error: unknown;
}

// `cost` observable = coste REAL si ya se conoce, si no el ESTIMADO (céntimos,
// entero). `null` cuando no hay ninguno (step aún sin ejecutar). Un solo criterio,
// compartido por snapshot y delta.
function costOf(row: SseRow): number | null {
  return row.costActual ?? row.costEstimated ?? null;
}

// Duración observable en ms (T0.11): un step ya terminado da `finished - started`;
// uno EN CURSO (started sin finished) da `now - started` (la duración crece en cada
// re-lectura → el nodo la ve avanzar en vivo). `null` si el step no ha arrancado.
// El reloj es el del proceso web (mismo host self-hosted que fijó started_at); en
// F0 mono-host no hay skew relevante.
function durationOf(row: SseRow): number | null {
  if (row.startedAt === null) return null;
  const end = row.finishedAt ?? new Date();
  const ms = end.getTime() - row.startedAt.getTime();
  return ms >= 0 ? ms : 0;
}

// Recorte estable de `output_refs`: serializa a JSON y trunca. `null` cuando no hay
// output. NO intenta interpretar el shape (opaco hasta F2): solo da al cliente una
// señal "hay artefacto" sin arrastrar el jsonb completo por el stream.
function excerptOf(refs: unknown): string | null {
  if (refs == null) return null;
  const s = typeof refs === 'string' ? refs : JSON.stringify(refs);
  return s.length > OUTPUT_EXCERPT_MAX ? s.slice(0, OUTPUT_EXCERPT_MAX) : s;
}

// Recorte del `step_run.error` para el visor de logs del panel (T0.11). El error se
// persiste como `{ message: string }` (consumer, step-execute.ts): extrae el mensaje
// PELADO para que el visor muestre "demo executor: fallo inyectado" y no
// `{"message":"…"}` con llaves JSON (la Verificación pide "ver el error"). Si el
// shape no es el esperado, cae al serializado genérico de `excerptOf`.
function errorExcerptOf(error: unknown): string | null {
  if (error == null) return null;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const msg = error.message;
    return msg.length > OUTPUT_EXCERPT_MAX ? msg.slice(0, OUTPUT_EXCERPT_MAX) : msg;
  }
  return excerptOf(error);
}

function toStepSnapshot(row: SseRow): StepSnapshot {
  return {
    id: row.id,
    nodeKey: row.nodeKey,
    status: row.status,
    cost: costOf(row),
    outputExcerpt: excerptOf(row.outputRefs),
    dependsOn: row.dependsOn,
    isCheckpoint: row.isCheckpoint,
    costEstimated: row.costEstimated,
    costActual: row.costActual,
    durationMs: durationOf(row),
    errorExcerpt: errorExcerptOf(row.error),
  };
}

async function readSseRows(db: Db, runId: string): Promise<SseRow[]> {
  return db.select(sseColumns).from(stepRun).where(eq(stepRun.runId, runId)).orderBy(stepRun.id);
}

/**
 * Foto COMPLETA del run para el evento `snapshot` (T0.10): TODOS sus steps en la
 * forma observable, ordenados por id. Se emite al conectar y en cada reconexión con
 * `Last-Event-ID` (re-snapshot del estado ACTUAL). NO computa `run.status` derivado
 * (deuda diferida de T0.8): la verdad son los estados de STEP.
 */
export async function readRunSnapshot(
  db: Db,
  runId: string,
): Promise<{ runId: string; steps: StepSnapshot[] }> {
  const rows = await readSseRows(db, runId);
  return { runId, steps: rows.map(toStepSnapshot) };
}

/**
 * Deltas `step_changed` para el stream (T0.10). El NOTIFY solo transporta `run_id`
 * (§9.0) — NO dice qué step cambió. Decisión deliberada de F0 (simplest-correct):
 * RELEE todos los steps del run y emite el estado ACTUAL de cada uno; el cliente
 * aplica idempotentemente sobre el mapa sembrado por el snapshot. No se construye un
 * diff contra un estado previo en el closure (sería estado mutable frágil por
 * conexión); el re-envío del estado presente es correcto porque el delta describe el
 * AHORA, no una transición.
 */
export async function readChangedSteps(db: Db, runId: string): Promise<StepChangedEvent[]> {
  const rows = await readSseRows(db, runId);
  // Reusa la proyección observable de `toStepSnapshot` (un solo sitio que define la
  // forma de un step en el stream) y solo re-etiqueta `id`→`stepId` + añade el
  // discriminante. Sin esto, un campo nuevo en el snapshot se caería del delta y el
  // mapa del cliente divergiría entre la foto sembrada y los deltas aplicados.
  return rows.map((row) => {
    const { id, ...rest } = toStepSnapshot(row);
    return { event: 'step_changed' as const, stepId: id, ...rest };
  });
}
