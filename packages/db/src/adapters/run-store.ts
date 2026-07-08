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
      await db.insert(pipelineRun).values({ id: run.id, projectId: run.projectId });
    },
    async insertSteps(steps: NewStepRow[]): Promise<void> {
      if (steps.length === 0) return;
      await db.insert(stepRun).values(
        steps.map((s) => ({
          id: s.id,
          runId: s.runId,
          nodeKey: s.nodeKey,
          status: s.status,
          dependsOn: s.dependsOn,
          // `config` es jsonb nullable; core pasa `null` cuando el nodo no lleva
          // parámetros. Drizzle serializa el objeto tal cual.
          config: s.config,
        })),
      );
    },
  };
}
