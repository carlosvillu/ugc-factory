// Repo del agregado `generation` (db.md §4, T4.1): funciones por caso de uso con el
// executor como PRIMER argumento. Cubre el ciclo de vida §9.6 que el servicio de
// generación orquesta: crear la INTENCIÓN (`submitting`) antes del submit, estampar el
// `request_id`/`status_url`/`response_url` que fal devuelve (`submitted`), y liquidar el
// resultado (`completed`/`failed`).
//
// El estado canónico de la generación vive AQUÍ, no en el queue de fal (backend §2). El
// servicio persiste-primero; estas funciones son las escrituras deterministas que lo
// hacen reconciliable (T4.3 releerá `status_url` de estas filas sin re-submit).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { RECONCILABLE_STATUSES } from '@ugc/core/generation';
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

// ── Caché SCOPED de previews de voz (T4.6, §8.3) ────────────────────────────────
// Patrón lookup-then-insert de `url_analysis.repo` sobre el índice único PARCIAL
// `generation_voice_preview_content_hash_key` (unicidad de `content_hash` SOLO entre
// `voice_preview=true`). NO toca la unicidad global de `content_hash` (eso es T4.10).

/**
 * Lookup de la caché de un preview de voz PREVIO por su `content_hash` (T4.6). La caché es
 * lookup-then-insert a nivel de aplicación (NO un constraint que rompa la inserción): el servicio
 * llama a esto ANTES de generar y, si hay fila `completed`, reutiliza su asset SIN una segunda
 * llamada a fal ni un segundo `cost_entry` — así "N reproducciones, 0 coste". Gateado por
 * `voice_preview=true` (el índice parcial garantiza ≤1 fila por hash entre previews). `undefined` si
 * no hay caché (es una muestra nueva a generar).
 */
export async function getVoicePreviewGenerationByContentHash(
  db: Db,
  contentHash: string,
): Promise<Generation | undefined> {
  const [row] = await db
    .select()
    .from(generation)
    .where(and(eq(generation.contentHash, contentHash), eq(generation.voicePreview, true)))
    // El índice único parcial garantiza ≤1 fila; `limit(1)` por higiene (determinista).
    .limit(1);
  return row;
}

/**
 * Inserta la INTENCIÓN de un preview de voz en `submitting` SI NO EXISTE ya una fila preview con el
 * mismo `content_hash` — `ON CONFLICT DO NOTHING` contra el índice único parcial
 * `generation_voice_preview_content_hash_key`. Es la escritura ATÓMICA de la caché (§8.3): dos clicks
 * concurrentes del MISMO ▶ NO crean dos generaciones (ni dos `cost_entry`) — la segunda choca y el
 * INSERT no devuelve fila. `voice_preview` se fuerza a `true` aquí (es la clave del scope). Retorno:
 *  - la fila creada, si ESTE insert ganó la carrera (created → el caller sigue con submit→poll→…);
 *  - `undefined`, si otra transacción ya la insertó (el caller re-SELECTa y reutiliza su asset).
 */
export async function insertVoicePreviewGenerationIfAbsent(
  db: Db,
  values: NewGeneration,
): Promise<Generation | undefined> {
  const [row] = await db
    .insert(generation)
    .values({ ...values, voicePreview: true })
    // Target del índice único PARCIAL: la columna + el MISMO predicado literal que el índice. El
    // predicado DEBE ser un literal (no un parámetro `$1`): el arbiter de Postgres compara el
    // predicado del ON CONFLICT con el del índice y un parámetro no casa (42P10) — por eso `sql` con
    // el literal exacto de `generation_voice_preview_content_hash_key` (mismo criterio que
    // `insertManualUrlAnalysisIfAbsent`).
    .onConflictDoNothing({
      target: generation.contentHash,
      where: sql`${generation.voicePreview} = true`,
    })
    .returning();
  // `undefined` cuando hubo conflicto (otra tx insertó primero): NO es un error.
  return row;
}

// ── Dedup GLOBAL de producción (T4.10, §9.6) ────────────────────────────────────
// La ECONOMÍA Hook×Body×CTA: un lote de N variantes del mismo ángulo comparte body y CTA, así que sus
// generaciones tienen el MISMO `content_hash` y se reutiliza el asset de la primera (las demás no
// submitean ni gastan). Espeja el par de la caché de previews (`getVoicePreviewGenerationByContentHash`
// + `insertVoicePreviewGenerationIfAbsent`) pero sobre el índice único parcial GLOBAL de producción
// (`generation_production_content_hash_key`: `voice_preview = false` AND status NOT IN ('failed',
// 'cancelled')). NO toca la caché scoped de previews (índice disjunto).

/**
 * Lookup del dedup de PRODUCCIÓN por `content_hash` (T4.10): la generación `completed` NO-preview con ese
 * hash cuyo asset se puede reutilizar. `undefined` si no hay ninguna (es una generación nueva a producir).
 * Es el lookup OPTIMISTA de la ruta caliente (sin `FOR UPDATE`): el servicio lo llama ANTES de crear la
 * fila `submitting` y, si hay hit, reutiliza el asset SIN llamar a fal ni escribir `cost_entry`. Filtra
 * `voice_preview = false` (una muestra de preview NO es un asset de producción reutilizable) y
 * `status = 'completed'` (solo un asset ya materializado sirve). El índice parcial garantiza ≤1 fila viva
 * por hash, pero puede coexistir con filas `failed` del mismo hash (retries): por eso se filtra por
 * `completed` explícitamente y se hace `limit(1)` por higiene determinista.
 */
export async function getCompletedGenerationByContentHash(
  db: Db,
  contentHash: string,
): Promise<Generation | undefined> {
  const [row] = await db
    .select()
    .from(generation)
    .where(
      and(
        eq(generation.contentHash, contentHash),
        eq(generation.voicePreview, false),
        eq(generation.status, 'completed'),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Inserta la INTENCIÓN de una generación de PRODUCCIÓN en `submitting` SI NO EXISTE ya una fila
 * viva-o-exitosa con el mismo `content_hash` — `ON CONFLICT DO NOTHING` contra el índice único parcial
 * `generation_production_content_hash_key`. Es la escritura ATÓMICA del dedup (§9.6): dos generaciones
 * idénticas concurrentes (mismo hash, p.ej. el body de dos variantes del mismo ángulo lanzadas a la vez)
 * NO crean dos filas `submitting` → solo UNA submitea a fal (la otra choca y el INSERT no devuelve fila).
 * `voice_preview` se fuerza a `false` (el scope de este índice; un preview usa `insertVoicePreviewGeneration
 * IfAbsent`). Retorno:
 *  - la fila creada, si ESTE insert ganó la carrera (el caller sigue con submit→poll→liquidación);
 *  - `undefined`, si ya existe una fila viva-o-completed con ese hash (el caller re-lee: si hay una
 *    `completed` reutiliza su asset; si aún está en vuelo, lanza para que el cliente reintente).
 * Un retry de una fila `failed`/`cancelled` NO choca (esos estados quedan FUERA del predicado del índice):
 * su `submitting` se inserta y devuelve fila, como debe.
 */
export async function insertProductionGenerationIfAbsent(
  db: Db,
  values: NewGeneration,
): Promise<Generation | undefined> {
  const [row] = await db
    .insert(generation)
    .values({ ...values, voicePreview: false })
    // Target del índice único PARCIAL: la columna + el MISMO predicado LITERAL que el índice
    // (`generation_production_content_hash_key`). El predicado DEBE ser un literal, no un parámetro `$1`:
    // el arbiter de Postgres compara el predicado del ON CONFLICT con el del índice y un parámetro no casa
    // (42P10). Incluye `voice_preview = false` para que el arbiter elija ESTE índice y no el de previews
    // (los dos índices parciales sobre `content_hash` son disjuntos por este conjunto). Mismo criterio que
    // `insertVoicePreviewGenerationIfAbsent` / `insertManualUrlAnalysisIfAbsent`.
    .onConflictDoNothing({
      target: generation.contentHash,
      where: sql`${generation.voicePreview} = false and ${generation.status} not in ('failed', 'cancelled')`,
    })
    .returning();
  // `undefined` cuando hubo conflicto (otra tx ya tiene una fila viva-o-completed): NO es un error.
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

/**
 * `SELECT … FOR UPDATE` sobre la fila `generation` (T4.2, §9.0): la bloquea hasta el commit y
 * devuelve su estado BAJO el lock. Es la primitiva que SERIALIZA dos liquidaciones concurrentes de
 * la MISMA generación (webhook-handler de web vs consumer del worker, o dos jobs `output.download`
 * solapados por redelivery): el finalize la llama al abrir su transacción, re-chequea `completed`
 * bajo el lock, y el perdedor de la carrera sale sin re-insertar asset/cost. Sin este lock, dos
 * finalizes leen `!= completed` a la vez y ambos escriben un `cost_entry` → DOBLE-COBRO. `undefined`
 * si la fila no existe. DEBE llamarse dentro de una `db.transaction` (el lock vive hasta el commit).
 */
export async function getGenerationForUpdate(tx: Db, id: string): Promise<Generation | undefined> {
  const [row] = await tx.select().from(generation).where(eq(generation.id, id)).for('update');
  return row;
}

/**
 * Lee una generación por su `fal_request_id` (T4.2, §9.6): la CLAVE de idempotencia del webhook.
 * El handler del webhook de fal releela por este id para decidir si ya está `completed` (no-op) o
 * si debe avanzar. La columna es UNIQUE (índice `generation_fal_request_id_key`), así que a lo sumo
 * hay una fila; `undefined` si fal manda un `request_id` que no conocemos (webhook espurio/tardío).
 */
export async function getGenerationByFalRequestId(
  db: Db,
  falRequestId: string,
): Promise<Generation | undefined> {
  const [row] = await db.select().from(generation).where(eq(generation.falRequestId, falRequestId));
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

/**
 * CLAIM condicional de una generación para reconciliar (T4.3, §9.0, backend §3): aplica el `patch`
 * SOLO si la fila SIGUE en uno de los `fromStatuses` (los reconciliables observados al listar). Es la
 * revalidación-bajo-condición que evita el DOBLE-COBRO por carrera: entre que el sweeper LISTA una
 * fila `submitted` y que su `checkStatus` resuelve, OTRO actor (el webhook + su `output.download`)
 * puede haberla llevado a `completed` (y escrito su `cost_entry`). Un `updateGeneration` incondicional
 * REGRESARÍA ese `completed` a `in_progress`, re-encolaría una 2ª descarga y el FOR UPDATE de finalize
 * —que solo frena si la fila YA está `completed`— dejaría pasar un 2º `cost_entry`. El `WHERE status
 * IN (...)` hace que el UPDATE NO toque una fila que ya salió de los estados reconciliables: devuelve
 * `false` (0 filas afectadas) y reconcile NO encola/expira. Espeja la revalidación que `transition()`
 * hace con FOR UPDATE para los steps (un UPDATE condicional es la versión atómica sin lock explícito:
 * Postgres re-evalúa el WHERE bajo el lock de fila del propio UPDATE).
 *
 * Devuelve `true` si la fila se actualizó (el claim tomó efecto), `false` si otro actor ya la sacó de
 * los `fromStatuses` (no-op seguro).
 */
export async function claimGenerationForReconcile(
  db: Db,
  id: string,
  patch: GenerationPatch,
  fromStatuses: readonly Generation['status'][],
): Promise<boolean> {
  const rows = await db
    .update(generation)
    .set(patch)
    .where(and(eq(generation.id, id), inArray(generation.status, fromStatuses)))
    .returning({ id: generation.id });
  return rows.length > 0;
}

/** Lista las generaciones RECONCILIABLES (§9.6, T4.3): las que el sweeper re-chequea cada tick —
 *  `submitting` (crash-mid-submit, se expira por edad), `submitted`/`in_queue` (se pollea el
 *  `status_url` guardado) y `in_progress` (descarga encolada: se re-encola por deadline si la descarga
 *  se perdió — NO es terminal, ver la sub-lógica de `reconcileGeneration`). El conjunto lo define core
 *  (`RECONCILABLE_STATUSES`) y se reusa aquí para no derivar. Ordenadas por id (orden determinista,
 *  como `findExpiredRunningStepIds`). NO incluye los terminales `completed`/`failed`/`cancelled`. */
export async function listReconcilableGenerations(db: Db): Promise<Generation[]> {
  return db
    .select()
    .from(generation)
    .where(inArray(generation.status, [...RECONCILABLE_STATUSES]))
    .orderBy(generation.id);
}
