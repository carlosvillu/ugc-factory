// Repo del agregado `generation` (db.md §4, T4.1): funciones por caso de uso con el
// executor como PRIMER argumento. Cubre el ciclo de vida §9.6 que el servicio de
// generación orquesta: crear la INTENCIÓN (`submitting`) antes del submit, estampar el
// `request_id`/`status_url`/`response_url` que fal devuelve (`submitted`), y liquidar el
// resultado (`completed`/`failed`).
//
// El estado canónico de la generación vive AQUÍ, no en el queue de fal (backend §2). El
// servicio persiste-primero; estas funciones son las escrituras deterministas que lo
// hacen reconciliable (T4.3 releerá `status_url` de estas filas sin re-submit).
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { generation, type Generation, type NewGeneration } from '../schema/generation';

/**
 * Inserta la INTENCIÓN de una generación en estado `submitting` (§9.6): la fila existe
 * ANTES de llamar a fal. Si un crash ocurre entre este INSERT y el submit, queda una fila
 * `submitting` sin `fal_request_id` — huérfana pero VISIBLE, que es justo lo que T4.3
 * reconcilia (a diferencia de un job facturándose en fal sin rastro nuestro).
 */
export async function createGeneration(db: Db, values: NewGeneration): Promise<Generation> {
  const [row] = await db.insert(generation).values(values).returning();
  if (!row) throw new Error('createGeneration: INSERT no devolvió fila');
  return row;
}

/** Los campos que una transición de estado de la generación puede tocar. Todos opcionales:
 *  cada transición estampa solo lo suyo (submit → request_id/urls/status; result →
 *  status/payload/coste/timestamps). `updated_at` lo refresca el `$onUpdateFn` del schema. */
export type GenerationPatch = Partial<
  Pick<
    NewGeneration,
    | 'status'
    | 'falRequestId'
    | 'statusUrl'
    | 'responseUrl'
    | 'falStatusPayload'
    | 'costActual'
    | 'durationS'
    | 'startedAt'
    | 'completedAt'
  >
>;

/**
 * Aplica un patch a una generación y devuelve la fila actualizada. Lo usa el servicio para
 * avanzar la máquina de estados de §9.6 (submitting→submitted→…→completed). `RETURNING`
 * garantiza que lo devuelto es lo persistido.
 */
export async function updateGeneration(
  db: Db,
  id: string,
  patch: GenerationPatch,
): Promise<Generation> {
  const [row] = await db.update(generation).set(patch).where(eq(generation.id, id)).returning();
  if (!row) throw new Error(`updateGeneration: no existe la generación ${id}`);
  return row;
}

/** Lee una generación por id; `undefined` si no existe. */
export async function getGeneration(db: Db, id: string): Promise<Generation | undefined> {
  const [row] = await db.select().from(generation).where(eq(generation.id, id));
  return row;
}

/** Todas las generaciones en un estado dado (T4.1: comprobar las `submitting` huérfanas tras un
 *  submit fallido; base de la reconciliación que T4.3 hará sobre `submitted`/`in_queue`). */
export async function listGenerationsByStatus(
  db: Db,
  status: Generation['status'],
): Promise<Generation[]> {
  return db.select().from(generation).where(eq(generation.status, status));
}
