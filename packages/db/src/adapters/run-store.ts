// Adaptador del puerto `RunStore` de core (T0.7b): persiste el `pipeline_run` y
// sus `step_run` al crear un run. Tx-scoped como el resto de stores del
// orquestador (lo construye `makeWithTransaction` con la tx abierta): el INSERT
// comparte la transacción con el encolado atómico de los roots (create-run.ts).
// Habla los TIPOS de core (NewRunRow/NewStepRow), no filas Drizzle.
import type { NewRunRow, NewStepRow, RunStore } from '@ugc/core/orchestrator';
import type { Db } from '../client';
import { pipelineRun, stepRun } from '../schema/pipeline';

export function makeRunStore(db: Db): RunStore {
  return {
    async insertRun(run: NewRunRow): Promise<void> {
      // `autopilot` (T0.8): la define POST /api/runs; default false.
      await db.insert(pipelineRun).values({
        id: run.id,
        projectId: run.projectId,
        autopilot: run.autopilot,
        // §12: `kind` — solo se fija si core lo trae (omitido ⇒ Drizzle no toca la columna: default 'full').
        // La regeneración parcial (T5.8) lo trae ('regen'). `pipeline_run.batch_id` NO se puebla aquí: nadie
        // lo lee (el linaje al lote se alcanza vía `step_run.variant_id → ad_variant.batch_id`).
        ...(run.kind !== undefined ? { kind: run.kind } : {}),
      });
    },
    async insertSteps(steps: NewStepRow[]): Promise<void> {
      if (steps.length === 0) return;
      await db.insert(stepRun).values(
        steps.map((s) => ({
          id: s.id,
          runId: s.runId,
          nodeKey: s.nodeKey,
          // §12: la variante del step (N6/N7 por-variante, T4.11); omitido ⇒ columna NULL.
          ...(s.variantId !== undefined ? { variantId: s.variantId } : {}),
          status: s.status,
          dependsOn: s.dependsOn,
          // `config` es jsonb nullable; core pasa `null` cuando el nodo no lleva
          // parámetros. Drizzle serializa el objeto tal cual.
          config: s.config,
          // §7.1.b (T0.8): banderas de checkpoint tomadas de la definición del DAG.
          isCheckpoint: s.isCheckpoint,
          checkpointConfig: s.checkpointConfig,
          // Override del tope de reintentos (T4.11): solo se pasa si core lo trae; omitido ⇒
          // Drizzle no fija la columna y aplica su default (3). Los N7 lo suben para la dedup
          // concurrente (ver NewStepRow.maxRetries / RunNodeSchema.maxRetries).
          ...(s.maxRetries !== undefined ? { maxRetries: s.maxRetries } : {}),
        })),
      );
    },
  };
}
