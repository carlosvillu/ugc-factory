// Repo del agregado `step_run` (db.md §4): funciones por caso de uso con el
// executor (`Db`) como PRIMER argumento, para correr igual sobre la conexión o
// dentro de la tx del orquestador. En T0.7a solo lo que `transition()` (§9.0)
// necesita: lock de fila, update, dependientes lockeados y check de succeeded.
// El resto (creación de step, snapshot del run) llega con sus consumidores.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { stepRun } from '../schema/pipeline';
import type { StepRow, StepPatch, NewSupersedingStepRow } from '@ugc/core/orchestrator';

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
      // Incremento ATÓMICO de retry_count (T0.7b): `retry_count = retry_count + 1`
      // en el propio UPDATE, bajo el lock que ya tiene findForUpdate. No se lee en
      // JS ni se reescribe un valor concreto → cero ventana de lost-update. El
      // cast asegura que Drizzle acepte la expresión SQL en el `.set` tipado.
      ...(patch.incrementRetryCount === true && {
        retryCount: sql<number>`${stepRun.retryCount} + 1`,
      }),
      // `outputRefs` editado en un checkpoint (T0.8): `undefined` = no tocar;
      // cualquier otro valor (incluido null) se escribe. Mismo criterio que
      // finishedAt.
      ...(patch.outputRefs !== undefined && { outputRefs: patch.outputRefs }),
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
