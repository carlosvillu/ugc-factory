// Repo del agregado `product_brief` (T1.10b; db.md §4: funciones por caso de uso con el
// executor Drizzle como PRIMER argumento — mismo patrón que url-analysis.repo/spend.repo).
//
// ESTRENA la persistencia del brief: hasta T1.10a el ProductBrief vivía SOLO inline en el
// `output_refs` de N3. Aquí pasa a tener fila propia, y con ella el VERSIONADO que exige la
// Verificación (v1 IA → v2 editado en CP1 → v3 editado standalone).
//
// LA INVARIANTE (la parte sutil; no la reinventes en el caller): `product_brief.version` es un
// CONTADOR POR `url_analysis_id`, INDEPENDIENTE del ciclo de vida de los steps. El supersede de
// T0.8 versiona STEPS; esto versiona BRIEFS. Se cruzan solo en que un `editStep` sobre CP1
// PROVOCA un bump — no en que uno derive del otro. Por eso el bump vive aquí (una función), y la
// llaman los TRES caminos:
//   - v1: N3 al terminar la síntesis          → `createBriefVersion` (status draft, edited=false)
//   - v2: CP1 (edición dentro del run)        → `createBriefVersion` (approved, edited=true)
//   - v3: PATCH /api/briefs/:id (sin run)     → `createBriefVersion` (approved, edited=true)
//
// ATOMICIDAD (el detalle, en el docstring de `createBriefVersion`): el bump se SERIALIZA con un
// advisory lock por `url_analysis_id` — el LOCK da la secuencia; el UNIQUE
// `product_brief_analysis_version_key` (schema/project.ts) da la IMPOSIBILIDAD del duplicado. No
// hay reintentos: se probaron y eran flaky (thundering herd), ver el docstring.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  productBrief,
  urlAnalysis,
  type NewProductBrief,
  type ProductBrief,
} from '../schema/project';

/**
 * Namespace del advisory lock del bump (el primer `int4` de `pg_advisory_xact_lock(a, b)`). Un
 * número arbitrario pero FIJO: aísla estos locks de cualquier otro uso de advisory locks en la
 * BD (hoy `MIGRATION_LOCK_KEY`), de modo que dos subsistemas no puedan bloquearse entre sí por
 * coincidir el hash de sus claves.
 */
const BRIEF_VERSION_LOCK_NAMESPACE = 0x62_72_66_31; // 'brf1'

/** Datos de una NUEVA versión del brief. `version` NO viaja aquí: lo calcula el repo (es
 *  justo lo que no puede decidir el caller sin abrir una carrera). */
export interface CreateBriefVersionInput {
  urlAnalysisId: string;
  /** El ProductBrief del Apéndice A (jsonb opaco en BD; su shape lo valida Zod en core). */
  data: unknown;
  language: string;
  /** `true` si esta versión sale de una edición HUMANA (CP1 o standalone); `false` para el
   *  brief que produce la IA en N3. Es el `edited_by_user` de §12. */
  editedByUser: boolean;
  status: NewProductBrief['status'];
  /**
   * El `step_run` que PRODUJO esta versión, si la produjo una máquina (N3). Se OMITE en las
   * ediciones humanas (CP1, PATCH standalone): ahí no hay step que la produjera y `NULL` es la
   * verdad. Es la clave de idempotencia de N3 — ver `findBriefByOriginStep`.
   */
  originStepRunId?: string;
}

/**
 * Inserta la SIGUIENTE versión del brief de un `url_analysis` (bump atómico).
 *
 * CÓMO SE SERIALIZA (y por qué NO se hace con reintentos optimistas):
 *
 * El bump `version = MAX(version)+1` es un read-modify-write, y bajo READ COMMITTED dos
 * transacciones concurrentes leen el MISMO `MAX` y calculan el MISMO número. La primera versión
 * de esto lo resolvía con un retry ante el 23505 del UNIQUE — y era FLAKY: con N escritores, los
 * perdedores vuelven a leer el MAX A LA VEZ y vuelven a chocar entre ellos (thundering herd), así
 * que ningún presupuesto de reintentos es "suficiente"; solo hace el fallo más raro. Un contador
 * que a veces se salta un número no es un contador.
 *
 * Aquí se SERIALIZA de verdad: `pg_advisory_xact_lock(ns, hash(url_analysis_id))` dentro de una
 * transacción. Los escritores del MISMO análisis se ponen en cola en el lock (no compiten); los
 * de análisis DISTINTOS no se estorban (la clave es el análisis). El lock es de TRANSACCIÓN
 * (`_xact_`): se suelta solo en el commit/rollback — no hay forma de olvidarse de liberarlo.
 *
 * El UNIQUE `(url_analysis_id, version)` SIGUE SIENDO NECESARIO y no es redundante: es la barrera
 * ESTRUCTURAL que garantiza la invariante aunque alguien inserte por otro camino (una migración,
 * un script, un repo futuro que olvide el lock). El lock da la SECUENCIA; el UNIQUE la
 * IMPOSIBILIDAD del duplicado.
 */
export async function createBriefVersion(
  db: Db,
  input: CreateBriefVersionInput,
): Promise<ProductBrief> {
  return db.transaction(async (tx) => {
    // Cola de escritores POR ANÁLISIS. `hashtext` mapea el ULID a un int4 (lo que exige la
    // firma de dos argumentos); una colisión de hash entre dos análisis distintos solo los
    // serializaría de más — nunca produce una versión incorrecta.
    await tx.execute(
      sql`select pg_advisory_xact_lock(${BRIEF_VERSION_LOCK_NAMESPACE}, hashtext(${input.urlAnalysisId}))`,
    );

    const [row] = await tx
      .insert(productBrief)
      .values({
        urlAnalysisId: input.urlAnalysisId,
        // El bump, EN SQL, ya bajo el lock: nadie más puede estar leyendo este MAX ahora mismo.
        version: sql<number>`(
            select coalesce(max(pb.version), 0) + 1
            from ${productBrief} pb
            where pb.url_analysis_id = ${input.urlAnalysisId}
          )`,
        data: input.data,
        language: input.language,
        editedByUser: input.editedByUser,
        status: input.status,
        originStepRunId: input.originStepRunId ?? null,
      })
      .returning();
    if (!row) throw new Error('createBriefVersion: el INSERT no devolvió fila');
    return row;
  });
}

/**
 * El brief que produjo UN step concreto, o `undefined` si ese step aún no ha producido ninguno.
 *
 * ES LA CLAVE DE IDEMPOTENCIA DE N3, Y ES UNA SALVAGUARDA DE DINERO. N3 paga ~$0,20 de Sonnet 5
 * y luego persiste el brief; si esa persistencia falla por algo TRANSITORIO, el step reintenta y
 * —sin esto— re-ejecutaría la síntesis ENTERA y volvería a pagar. Un retry CONSERVA el
 * `step_run.id` (`failStep` reusa la fila: failed→queued + `retry_count++`), así que el step
 * puede preguntar "¿ya produje yo mi brief?" y reusarlo sin pasar por caja.
 *
 * Se apoya en el UNIQUE parcial `product_brief_origin_step_key`: como máximo UNA fila por step.
 */
export async function findBriefByOriginStep(
  db: Db,
  stepRunId: string,
): Promise<ProductBrief | undefined> {
  const [row] = await db
    .select()
    .from(productBrief)
    .where(eq(productBrief.originStepRunId, stepRunId));
  return row;
}

/** Lee un brief por su id; `undefined` si no existe. */
export async function getBrief(db: Db, id: string): Promise<ProductBrief | undefined> {
  const [row] = await db.select().from(productBrief).where(eq(productBrief.id, id));
  return row;
}

/**
 * El brief + el PROYECTO al que pertenece (T2.3): lo que CP2 necesita para crear el lote
 * (`ad_batch.project_id` es NOT NULL).
 *
 * El proyecto NO está en `product_brief` —cuelga de `url_analysis`, que es quien lo referencia—,
 * así que es un JOIN, no una columna. Se hace en SQL y en UNA query (en vez de leer el brief,
 * mirar su `url_analysis_id` y hacer un segundo SELECT): dos viajes para un dato que la BD sabe
 * unir es exactamente el N+1 en miniatura que db.md §7 pide evitar.
 */
export async function getBriefWithProject(
  db: Db,
  id: string,
): Promise<{ brief: ProductBrief; projectId: string } | undefined> {
  const [row] = await db
    .select({ brief: productBrief, projectId: urlAnalysis.projectId })
    .from(productBrief)
    .innerJoin(urlAnalysis, eq(productBrief.urlAnalysisId, urlAnalysis.id))
    .where(eq(productBrief.id, id));
  return row;
}

/**
 * La versión MÁS RECIENTE del brief de un análisis (mayor `version`), o `undefined` si el
 * análisis todavía no tiene brief. Es lo que el editor de CP1 y el endpoint standalone leen:
 * "el brief actual de este producto" es siempre el último, no el primero.
 */
export async function getLatestBriefByAnalysis(
  db: Db,
  urlAnalysisId: string,
): Promise<ProductBrief | undefined> {
  const [row] = await db
    .select()
    .from(productBrief)
    .where(eq(productBrief.urlAnalysisId, urlAnalysisId))
    .orderBy(desc(productBrief.version))
    .limit(1);
  return row;
}

/**
 * Marca APROBADO un brief concreto (CP1 aprobado SIN editar: §12 `status: draft → approved`).
 * NO crea versión nueva — aprobar tal cual lo que propuso la IA no es una edición, y crear un
 * v2 idéntico al v1 con `edited_by_user:true` MENTIRÍA sobre quién escribió ese contenido (el
 * campo existe justo para medir cuánto corrige el humano a la IA, §19.1).
 *
 * Idempotente y acotado: solo toca la fila indicada, y solo si sigue en `draft`. Devuelve la
 * fila resultante (o `undefined` si el id no existe).
 */
export async function approveBrief(db: Db, id: string): Promise<ProductBrief | undefined> {
  const [row] = await db
    .update(productBrief)
    .set({ status: 'approved', updatedAt: new Date() })
    .where(and(eq(productBrief.id, id), eq(productBrief.status, 'draft')))
    .returning();
  // Ya estaba `approved` (re-aprobación): el UPDATE no toca fila, pero la fila existe y el
  // caller debe verla igualmente. Se relee.
  return row ?? (await getBrief(db, id));
}
