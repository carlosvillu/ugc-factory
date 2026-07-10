// Adaptador del puerto `StepStore` de core (db.md §5): envuelve steps.repo. La
// dirección manda — el adaptador habla los TIPOS de core (StepRow, null), no
// expone filas Drizzle. Funciona igual con conexión o tx: los repos aceptan `Db`.
import type { StepStore } from '@ugc/core/orchestrator';
import type { Db } from '../client';
import * as steps from '../repos/steps.repo';

export function makeStepStore(db: Db): StepStore {
  return {
    // El puerto habla `null`, el repo `undefined`: se convierte aquí.
    findForUpdate: async (id) => (await steps.findStepForUpdate(db, id)) ?? null,
    update: (id, patch) => steps.updateStep(db, id, patch),
    findDependents: (stepId) => steps.findDependents(db, stepId),
    resolvedStatus: (ids) => steps.resolvedStatus(db, ids),
    findStepAndClosureForUpdate: (stepId) => steps.findStepAndClosureForUpdate(db, stepId),
    findCancellableByRun: (runId) => steps.findCancellableByRun(db, runId),
    insertSuperseding: (row) => steps.insertSuperseding(db, row),
  };
}
