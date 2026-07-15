// Repo de LECTURA de la galería + versionado de templates (T3.8; db.md §4: funciones por caso de
// uso con el executor como PRIMER argumento). Complementa a `gallery-seed.repo.ts` (que SIEMBRA):
// esto es lo que consume `/gallery` en runtime.
//
// Casos de uso que existen HOY (y solo esos):
//   · LISTA facetada (`listTemplates`): filtra por subconjuntos de facetas sirviendo los GIN de
//     T3.1 con `@>` (contains), y calcula los conteos por valor de cada faceta para el rail.
//   · FICHA (`getTemplateWithVersions`): un template + sus `prompt_version` (más nueva primero).
//   · EDICIÓN → v2 (`createTemplateVersion`): §10.1 `prompt_version` es INMUTABLE. Guardar una
//     edición NO muta v1: materializa la versión ACTUAL como snapshot si aún no existe (el seed
//     de T3.7 no crea versiones: `head_version` arranca en 0), inserta la editada como la
//     siguiente versión, y actualiza `template.body`/`head_version`. Todo en UNA transacción.
//   · TRANSICIÓN de estado (`setTemplateStatus`): draft→review→published (§10.2).
import { and, arrayContains, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  guardPack,
  promptTemplate,
  promptVersion,
  type GuardPack,
  type NewPromptTemplate,
  type PromptTemplate,
  type PromptVersion,
} from '../schema/gallery';

/** El estado del template (`prompt_status` enum §10.2), tomado del inferido de la fila para no
 *  duplicar la lista de valores. El endpoint valida el string contra `PromptStatusSchema` de core
 *  ANTES de llamar aquí, así que el repo recibe el tipo estrecho. */
type TemplateStatus = PromptTemplate['status'];

/** Las cinco facetas ortogonales (§10.1) por las que se filtra y se cuenta. El orden es el del
 *  rail del mockup 5a. Interno al repo (el rail de la UI se ordena en el componente). */
const FACET_COLUMNS = ['formats', 'hookAngles', 'verticals', 'platforms', 'aesthetics'] as const;
type FacetColumn = (typeof FACET_COLUMNS)[number];

/** Un conteo `{ value, count }` (`beauty · 12`) para el rail. Interno: el contrato público de la
 *  respuesta es `FacetCount` de `@ugc/core/gallery`. */
interface FacetCountRow {
  value: string;
  count: number;
}

/** El filtro de la búsqueda facetada: un subconjunto de valores por faceta (todas AND entre sí,
 *  `@>` dentro de cada faceta: la fila debe CONTENER todos los valores pedidos) + estado. */
export interface TemplateFilter {
  formats?: string[];
  hookAngles?: string[];
  verticals?: string[];
  platforms?: string[];
  aesthetics?: string[];
  status?: TemplateStatus;
}

/** El resultado de la lista: las filas que casan + los conteos GLOBALES por faceta (todo el
 *  catálogo, no combinatorios) + los conteos por estado + el total de coincidencias. */
export interface ListTemplatesResult {
  templates: PromptTemplate[];
  facets: Record<FacetColumn, FacetCountRow[]>;
  statusCounts: FacetCountRow[];
  total: number;
}

// Mapeo faceta → columna Drizzle (para el `@>`). El nombre de propiedad es el que la API expone;
// la columna es la del schema.
const FACET_COLUMN_MAP = {
  formats: promptTemplate.formats,
  hookAngles: promptTemplate.hookAngles,
  verticals: promptTemplate.verticals,
  platforms: promptTemplate.platforms,
  aesthetics: promptTemplate.aesthetics,
} as const;

/**
 * La LISTA facetada. Construye el WHERE con `@>` por cada faceta pedida (sirviendo el GIN de T3.1)
 * y `=` para el estado, todo AND. Los conteos son GLOBALES por valor (un `unnest` + `GROUP BY`
 * sobre TODO el catálogo), no combinatorios: el rail dice «cuántos hay de cada valor», que es lo
 * que el mockup 5a pinta (`published 38 · draft 12`, `beauty`, `before-after`…).
 *
 * Orden estable de las tarjetas por `featured DESC, slug ASC` (los featured arriba, luego
 * alfabético) — reproducible entre cargas.
 */
export async function listTemplates(
  db: Db,
  filter: TemplateFilter = {},
): Promise<ListTemplatesResult> {
  const conds = [];
  for (const facet of FACET_COLUMNS) {
    const values = filter[facet];
    if (values && values.length > 0) {
      // `@>` (contains): la fila debe CONTENER todos los valores pedidos de esa faceta.
      conds.push(arrayContains(FACET_COLUMN_MAP[facet], values));
    }
  }
  if (filter.status) conds.push(eq(promptTemplate.status, filter.status));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const templates = await db
    .select()
    .from(promptTemplate)
    .where(where)
    .orderBy(desc(promptTemplate.featured), promptTemplate.slug);

  // Conteos por faceta: un `unnest` del text[] + GROUP BY, GLOBAL (sin el WHERE del filtro). Se
  // corren en paralelo — son cinco lecturas independientes de la misma tabla.
  const facetEntries = await Promise.all(
    FACET_COLUMNS.map(async (facet) => {
      // El nombre SQL (`snake_case`) sale de la propia columna Drizzle (`.name`) — una sola verdad
      // con `FACET_COLUMN_MAP`, sin una lista paralela que derive. Sigue siendo un conjunto CERRADO
      // (las cinco facetas), no entrada de usuario: el `sql.raw` de `countFacetValues` es seguro.
      const rows = await countFacetValues(db, FACET_COLUMN_MAP[facet].name);
      return [facet, rows] as const;
    }),
  );
  const facets = Object.fromEntries(facetEntries) as Record<FacetColumn, FacetCountRow[]>;

  const statusCounts = await countStatuses(db);

  return { templates, facets, statusCounts, total: templates.length };
}

/** Conteo por valor de una faceta text[] (GLOBAL). `column` es uno del conjunto cerrado
 *  `FACET_SQL_COLUMN` — nunca entrada de usuario. Orden por conteo desc, luego valor. */
async function countFacetValues(db: Db, column: string): Promise<FacetCountRow[]> {
  const result = await db.execute<{ value: string; count: string }>(sql`
    SELECT v AS value, COUNT(*)::int AS count
    FROM prompt_template, unnest(${sql.raw(column)}) AS v
    GROUP BY v
    ORDER BY count DESC, v ASC
  `);
  return result.rows.map((r) => ({ value: r.value, count: Number(r.count) }));
}

/** Conteo por estado (draft/review/published/deprecated). */
async function countStatuses(db: Db): Promise<FacetCountRow[]> {
  const result = await db.execute<{ value: string; count: string }>(sql`
    SELECT status AS value, COUNT(*)::int AS count
    FROM prompt_template
    GROUP BY status
    ORDER BY count DESC, status ASC
  `);
  return result.rows.map((r) => ({ value: r.value, count: Number(r.count) }));
}

/** Crea un template (el botón «+ Nuevo template» del mockup 5a). El UNIQUE de `slug` rechaza el
 *  duplicado (23505) — el endpoint lo traduce a un error de campo. Nace en `draft` (default). */
export async function createTemplate(db: Db, values: NewPromptTemplate): Promise<PromptTemplate> {
  const [row] = await db.insert(promptTemplate).values(values).returning();
  if (!row) throw new Error('createTemplate: INSERT no devolvió fila');
  return row;
}

/** Un template por id; `undefined` si no existe. Interno: la ficha usa `getTemplateWithVersions`. */
async function getTemplate(db: Db, id: string): Promise<PromptTemplate | undefined> {
  const [row] = await db.select().from(promptTemplate).where(eq(promptTemplate.id, id));
  return row;
}

/** La ficha: el template + sus versiones (más nueva primero). `undefined` si el template no
 *  existe. Las versiones pueden ser 0 (un template sembrado que nunca se editó: `head_version=0`). */
export async function getTemplateWithVersions(
  db: Db,
  id: string,
): Promise<{ template: PromptTemplate; versions: PromptVersion[] } | undefined> {
  const template = await getTemplate(db, id);
  if (!template) return undefined;
  const versions = await db
    .select()
    .from(promptVersion)
    .where(eq(promptVersion.templateId, id))
    .orderBy(desc(promptVersion.version));
  return { template, versions };
}

/** Lo que la edición aporta: el body nuevo (obligatorio) + campos opcionales de la versión. */
export interface TemplateVersionInput {
  body: string;
  beats?: unknown;
  guardPackKeys?: string[];
  changelog?: string;
}

/**
 * Crea una nueva versión del template a partir de una edición (§10.1: `prompt_version` INMUTABLE).
 *
 * EL PROBLEMA que resuelve (verificado: el seed de T3.7 NO crea versiones — `head_version`
 * arranca en 0): la Verificación pide «guardar crea v2 con diff visible contra v1», pero un
 * template recién sembrado no tiene NINGUNA versión materializada. Para que una sola edición
 * produzca un diff REAL v1↔v2:
 *
 *   1. Si el template no tiene versiones aún, se MATERIALIZA la actual (el body/beats/guards que
 *      el seed autoró) como v1 — es contenido genuino, no un placeholder, así que el diff es
 *      honesto. Si ya tiene versiones (una edición posterior), este paso se salta.
 *   2. Se inserta la edición como la SIGUIENTE versión (v2, v3…).
 *   3. Se actualiza `template.body`/`beats`/`guardPackKeys`/`head_version` a lo editado (el
 *      template "vive" en su cabeza; las versiones son la historia inmutable).
 *
 * Todo en UNA transacción con `FOR UPDATE` sobre el template: dos guardados concurrentes no
 * pueden asignar el mismo número de versión ni pisar la cabeza. Devuelve el par (v_anterior,
 * v_nueva) para que el cliente renderice el diff sin un segundo GET. `undefined` si el id no
 * existe (el endpoint → 404).
 */
export async function createTemplateVersion(
  db: Db,
  id: string,
  input: TemplateVersionInput,
): Promise<
  { previous: PromptVersion; created: PromptVersion; template: PromptTemplate } | undefined
> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(promptTemplate)
      .where(eq(promptTemplate.id, id))
      .for('update');
    if (!template) return undefined;

    // ¿Ya hay versiones? La más nueva es la base del diff.
    const [head] = await tx
      .select()
      .from(promptVersion)
      .where(eq(promptVersion.templateId, id))
      .orderBy(desc(promptVersion.version))
      .limit(1);

    let previous: PromptVersion;
    if (!head) {
      // Sin historia: materializa la versión ACTUAL (la sembrada) como v1. Snapshot del template
      // TAL CUAL está antes de esta edición — el "antes" honesto del diff.
      const [v1] = await tx
        .insert(promptVersion)
        .values({
          templateId: id,
          version: 1,
          body: template.body,
          beats: template.beats,
          guardPackKeys: template.guardPackKeys,
          changelog: 'Versión inicial (materializada al primer editar)',
        })
        .returning();
      if (!v1) throw new Error('createTemplateVersion: no se materializó v1');
      previous = v1;
    } else {
      previous = head;
    }

    const nextVersion = previous.version + 1;
    const [created] = await tx
      .insert(promptVersion)
      .values({
        templateId: id,
        version: nextVersion,
        body: input.body,
        beats: input.beats ?? template.beats,
        guardPackKeys: input.guardPackKeys ?? template.guardPackKeys,
        changelog: input.changelog,
      })
      .returning();
    if (!created) throw new Error('createTemplateVersion: no se insertó la nueva versión');

    // La cabeza del template pasa a ser lo editado. `head_version` = la nueva versión.
    const [updated] = await tx
      .update(promptTemplate)
      .set({
        body: input.body,
        beats: input.beats ?? template.beats,
        guardPackKeys: input.guardPackKeys ?? template.guardPackKeys,
        headVersion: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(promptTemplate.id, id))
      .returning();
    if (!updated) throw new Error('createTemplateVersion: no se actualizó el template');

    return { previous, created, template: updated };
  });
}

/** Todos los guard packs sembrados (§9.5). Los lee la ficha para resolver, con `resolveGuardPacks`
 *  de core, qué packs aplican al template (por sus facetas vertical/platform). */
export async function listGuardPacks(db: Db): Promise<GuardPack[]> {
  return db.select().from(guardPack);
}

/** Cambia el estado del template (§10.2 draft→review→published). `undefined` si no existe.
 *  La validez de la transición la gobierna el contrato §10.2; aquí solo se persiste. */
export async function setTemplateStatus(
  db: Db,
  id: string,
  status: TemplateStatus,
): Promise<PromptTemplate | undefined> {
  const [row] = await db
    .update(promptTemplate)
    .set({ status, updatedAt: new Date() })
    .where(eq(promptTemplate.id, id))
    .returning();
  return row;
}
