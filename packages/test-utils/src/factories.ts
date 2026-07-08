// Factories de datos de prueba (db-integration.md §9 checklist): construyen
// filas válidas con overrides, para que cuando el schema evolucione se arregle la
// factory y no cincuenta tests. Crece tarea a tarea (makeBrief, makeVariant… con
// sus tablas).
import { newUlid } from '@ugc/core/contracts';
import type { NewPipelineRun, NewProject, NewStepRun } from '@ugc/db';

export function makeProject(overrides: Partial<NewProject> = {}): NewProject {
  return {
    name: 'Proyecto de prueba',
    ...overrides,
  };
}

/**
 * Fila válida de `pipeline_run` con overrides. Requiere un `projectId` real
 * (FK a project): el test crea el project antes y lo pasa. Los tests del
 * orquestador (T0.7a) insertan estos fixtures con Drizzle raw — la creación de
 * run vía API/servicio es T0.7b, fuera de alcance.
 */
export function makePipelineRun(
  overrides: Partial<NewPipelineRun> & Pick<NewPipelineRun, 'projectId'>,
): NewPipelineRun {
  return {
    id: newUlid(),
    kind: 'full',
    status: 'pending',
    ...overrides,
  };
}

/**
 * Fila válida de `step_run` con overrides. Requiere un `runId` real (FK a
 * pipeline_run). `id` se genera aquí para poder referenciarlo en `dependsOn` de
 * otros steps antes del INSERT (ULIDs disponibles pre-insert, db.md §1).
 */
export function makeStepRun(
  overrides: Partial<NewStepRun> & Pick<NewStepRun, 'runId'>,
): NewStepRun {
  return {
    id: newUlid(),
    nodeKey: 'N0',
    status: 'pending',
    dependsOn: [],
    ...overrides,
  };
}
