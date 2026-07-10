// Repo del agregado `project` (db.md §4): funciones por caso de uso con el
// executor como PRIMER argumento, para correr igual sobre la conexión o dentro
// de una tx. En T0.3 solo create/get (Entrega T0.3: "repos tipados mínimos");
// list/update/archive llegan con sus consumidores. Nada de generic
// repository/active record (db.md §4).
import { asc, eq, sql } from 'drizzle-orm';
import type { Db, DbClient } from '../client';
import { project, type NewProject, type Project } from '../schema/project';

// Clave del advisory lock de `ensureDefaultProject` (propia; distinta de la de
// migraciones): serializa el find-or-create para que dos cargas concurrentes de
// `/analyses/new` no creen dos proyectos por defecto (la ventana SELECT→INSERT).
const DEFAULT_PROJECT_LOCK_KEY = 810_611;

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

/**
 * Devuelve un project por defecto sobre el que trabajar, creándolo si aún no existe
 * ninguno (T1.6): la app es mono-usuario y la gestión de proyectos (crear/listar/
 * archivar) es una tarea posterior; hasta entonces el intake cuelga de un proyecto
 * por defecto. Determinista: el más antiguo por id (ULID ordenable) si hay varios.
 * Recibe `DbClient` (no `Db`): abre su propia transacción para el advisory lock, así
 * que no puede correr dentro de una tx ajena.
 */
export async function ensureDefaultProject(db: DbClient): Promise<Project> {
  // Advisory lock transaccional: serializa find-or-create para que dos cargas
  // concurrentes no inserten dos proyectos (la ventana SELECT→INSERT). El lock se
  // libera solo al COMMIT de la tx — por eso todo va dentro de una transacción.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${DEFAULT_PROJECT_LOCK_KEY})`);
    const [existing] = await tx.select().from(project).orderBy(asc(project.id)).limit(1);
    if (existing) return existing;
    const [created] = await tx.insert(project).values({ name: 'Mi proyecto' }).returning();
    if (!created) throw new Error('ensureDefaultProject: INSERT no devolvió fila');
    return created;
  });
}
