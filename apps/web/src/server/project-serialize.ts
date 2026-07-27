// Serializa una fila `project` de la BD (Date → ISO) al shape del contrato `Project`
// de core (T5.10). Compartido por los handlers de `/api/projects` (list/create/update):
// JSON no tiene Date, y el contrato exige `createdAt`/`updatedAt` como string ISO.
import { ProjectSchema, type Project as ProjectContract } from '@ugc/core/contracts';
import type { Project as ProjectRow } from '@ugc/db';

// Termina en `ProjectSchema.parse(...)` (igual que su hermano `toPersonaResponse`): POST 201 y
// PATCH devuelven este objeto CRUDO (list/detail sí re-parsean con su schema), así que sin este
// parse una deriva repo↔contrato llegaría al navegador en vez de fallar en test (regla 5a).
export function serializeProject(row: ProjectRow): ProjectContract {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    defaultLocale: row.defaultLocale,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
