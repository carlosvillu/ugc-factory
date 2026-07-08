// Repo del agregado `project` (db.md §4): funciones por caso de uso con el
// executor como PRIMER argumento, para correr igual sobre la conexión o dentro
// de una tx. En T0.3 solo create/get (Entrega T0.3: "repos tipados mínimos");
// list/update/archive llegan con sus consumidores. Nada de generic
// repository/active record (db.md §4).
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { project, type NewProject, type Project } from '../schema/project';

/**
 * Inserta un project y devuelve la fila completa (con defaults e ids aplicados
 * por la BD). `RETURNING` garantiza que lo devuelto es exactamente lo persistido.
 */
export async function createProject(db: Db, values: NewProject): Promise<Project> {
  const [row] = await db.insert(project).values(values).returning();
  if (!row) throw new Error('createProject: INSERT no devolvió fila');
  return row;
}

/** Lee un project por id; `undefined` si no existe. */
export async function getProject(db: Db, id: string): Promise<Project | undefined> {
  const [row] = await db.select().from(project).where(eq(project.id, id));
  return row;
}
