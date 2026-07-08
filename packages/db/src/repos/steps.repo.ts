// Repo del agregado `step_run` (db.md §4): funciones por caso de uso con el
// executor (`Db`) como PRIMER argumento, para correr igual sobre la conexión o
// dentro de la tx del orquestador. En T0.7a solo lo que `transition()` (§9.0)
// necesita: lock de fila, update, dependientes lockeados y check de succeeded.
// El resto (creación de step, snapshot del run) llega con sus consumidores.
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { stepRun } from '../schema/pipeline';
import type { StepRow, StepPatch } from '@ugc/core/orchestrator';

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
}): StepRow {
  return {
    id: row.id,
    runId: row.runId,
    nodeKey: row.nodeKey,
    status: row.status,
    dependsOn: row.dependsOn,
  };
}

/**
 * `SELECT … FOR UPDATE` sobre la fila del step: la bloquea hasta el commit y
 * devuelve su estado BAJO el lock (db.md §6, paso 1). `undefined` si no existe.
 */
export async function findStepForUpdate(db: Db, id: string): Promise<StepRow | undefined> {
  const [row] = await db
    .select({
      id: stepRun.id,
      runId: stepRun.runId,
      nodeKey: stepRun.nodeKey,
      status: stepRun.status,
      dependsOn: stepRun.dependsOn,
    })
    .from(stepRun)
    .where(eq(stepRun.id, id))
    .for('update');
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
    .select({
      id: stepRun.id,
      runId: stepRun.runId,
      nodeKey: stepRun.nodeKey,
      status: stepRun.status,
      dependsOn: stepRun.dependsOn,
    })
    .from(stepRun)
    // depends_on @> ARRAY[stepId]: la fila contiene stepId entre sus deps.
    .where(sql`${stepRun.dependsOn} @> ARRAY[${stepId}]::text[]`)
    .orderBy(stepRun.id) // orden determinista → sin deadlock 40P01 (db.md §6)
    .for('update');
  return rows.map(toStepRow);
}

/**
 * Para cada id, ¿está el step en `succeeded`? Devuelve un mapa id→bool. Lectura
 * simple (corre DESPUÉS de que el dependiente esté lockeado por findDependents,
 * db.md §6). Ids ausentes de la BD ⇒ false.
 */
export async function succeededStatus(db: Db, ids: string[]): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = Object.fromEntries(ids.map((id) => [id, false]));
  if (ids.length === 0) return result;
  const rows = await db
    .select({ id: stepRun.id, status: stepRun.status })
    .from(stepRun)
    .where(inArray(stepRun.id, ids));
  for (const row of rows) result[row.id] = row.status === 'succeeded';
  return result;
}
