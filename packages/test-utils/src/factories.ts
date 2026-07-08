// Factories de datos de prueba (db-integration.md §9 checklist): construyen
// filas válidas con overrides, para que cuando el schema evolucione se arregle la
// factory y no cincuenta tests. Crece tarea a tarea (makeBrief, makeVariant… con
// sus tablas).
import type { NewProject } from '@ugc/db';

export function makeProject(overrides: Partial<NewProject> = {}): NewProject {
  return {
    name: 'Proyecto de prueba',
    ...overrides,
  };
}
