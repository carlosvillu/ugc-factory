// Repo del agregado `pipeline_run` (db.md §4). En T0.8, solo la lectura simple que
// el consumer genérico necesita para decidir si un checkpoint pausa: el
// `autopilot` del run. Crece con sus consumidores (snapshot del run para el SSE en
// T0.10, etc.).
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { pipelineRun, type PipelineRun } from '../schema/pipeline';

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

// Proyección del run que la página `/runs/[id]` consume por REST (T0.11): el SSE
// alimenta los STEPS; el REST alimenta el objeto RUN (autopilot para el toggle de
// cabecera, kind/status/id para la cabecera). NO es la fila entera de persistencia
// —solo lo que la UI pinta— pero como todos los campos son escalares baratos se
// devuelve la fila `$inferSelect` completa; el handler serializa lo que necesita.
export interface RunView {
  id: string;
  projectId: string;
  kind: PipelineRun['kind'];
  autopilot: boolean;
  status: PipelineRun['status'];
  startedAt: Date | null;
  finishedAt: Date | null;
  totalCostEstimated: number | null;
  totalCostActual: number | null;
}

const runViewColumns = {
  id: pipelineRun.id,
  projectId: pipelineRun.projectId,
  kind: pipelineRun.kind,
  autopilot: pipelineRun.autopilot,
  status: pipelineRun.status,
  startedAt: pipelineRun.startedAt,
  finishedAt: pipelineRun.finishedAt,
  totalCostEstimated: pipelineRun.totalCostEstimated,
  totalCostActual: pipelineRun.totalCostActual,
} as const;

/**
 * Lee el objeto run para la página `/runs/[id]` (T0.11). `undefined` si no existe
 * (el handler lo mapea a 404). Lectura simple sin lock.
 */
export async function findRun(db: Db, runId: string): Promise<RunView | undefined> {
  const [row] = await db.select(runViewColumns).from(pipelineRun).where(eq(pipelineRun.id, runId));
  return row;
}

/**
 * Muta `pipeline_run.autopilot` (T0.11, toggle de cabecera). En T0.8 el autopilot
 * era inmutable tras la creación; el canvas exige poder activarlo/desactivarlo en
 * vivo (Verificación: "activar el toggle autopilot y ver un run completar sin
 * pausas"). `shouldPause` (checkpoint.ts) relee `findRunAutopilot` en cada decisión
 * de pausa, así que este UPDATE afecta a los checkpoints AÚN NO alcanzados —
 * exactamente la semántica que la Verificación observa. Devuelve el nº de filas
 * afectadas (0 = run inexistente → el handler mapea a 404). Lectura del contrato:
 * el override per-nodo `checkpointConfig.alwaysPause` sigue GANANDO (checkpoint.ts).
 */
export async function updateRunAutopilot(
  db: Db,
  runId: string,
  autopilot: boolean,
): Promise<number> {
  const rows = await db
    .update(pipelineRun)
    .set({ autopilot })
    .where(eq(pipelineRun.id, runId))
    .returning({ id: pipelineRun.id });
  return rows.length;
}
