// Repo del agregado `pipeline_run` (db.md §4). En T0.8, solo la lectura simple que
// el consumer genérico necesita para decidir si un checkpoint pausa: el
// `autopilot` del run. Crece con sus consumidores (snapshot del run para el SSE en
// T0.10, etc.).
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { pipelineRun } from '../schema/pipeline';

/**
 * `pipeline_run.autopilot` del run (T0.8): lo lee el consumer tras un executor
 * exitoso para decidir si un checkpoint pausa (`shouldPause`). Lectura simple sin
 * lock: `autopilot` es inmutable tras la creación del run. `undefined` si el run
 * no existe.
 */
export async function findRunAutopilot(db: Db, runId: string): Promise<boolean | undefined> {
  const [row] = await db
    .select({ autopilot: pipelineRun.autopilot })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  return row?.autopilot;
}
