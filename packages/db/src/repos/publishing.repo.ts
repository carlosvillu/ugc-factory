// Repo de PUBLICACIÓN (T6.2, §15.4 / §preámbulo F6): lee/escribe el estado de publicación de una variante
// (`variant_publishing`) — el marcado del checklist §15.4 y el estado del checkpoint CP5. Trabajo NUEVO de
// F6: el bundle (T5.7) emitía los pasos, pero marcarlos «hechos» no se persistía en ningún sitio.
//
// GET-OR-CREATE por `variant_id` (UNIQUE): la primera lectura de una variante que aún no tiene fila devuelve
// el estado por defecto (`{}` marcas, CP5 off, flujo `ready`) SIN crear la fila; las escrituras (marcar un
// ítem, activar CP5, mover el flujo) hacen upsert. El upsert por `variant_id` da la idempotencia del marcado
// (marcar el mismo ítem dos veces = mismo mapa jsonb).
import { eq, sql } from 'drizzle-orm';

import {
  ChecklistMarksSchema,
  type ChecklistMarks,
  type PublishFlowState,
} from '@ugc/core/contracts';

import type { Db } from '../client';
import { variantPublishing, type VariantPublishing } from '../schema/publishing';

/** El estado de publicación de una variante, ya en el shape que la API/UI consume. `marks` va PARSEADO
 *  contra `ChecklistMarksSchema` (jsonb opaco → mapa tipado). */
export interface PublishingRow {
  variantId: string;
  marks: ChecklistMarks;
  cp5Enabled: boolean;
  flowState: PublishFlowState;
}

/** El estado por defecto de una variante SIN fila (nada marcado, CP5 off, flujo `ready`). */
function defaultRow(variantId: string): PublishingRow {
  return { variantId, marks: {}, cp5Enabled: false, flowState: 'ready' };
}

/** Mapea la fila cruda al shape tipado, parseando el jsonb de marcas. Una marca corrupta en BD se descarta
 *  ruidosamente (el parse falla) en vez de colar un `done` inventado — pero como el mapa es `record<bool>`
 *  y se escribe siempre desde este repo, en la práctica siempre parsea. */
function toRow(row: VariantPublishing): PublishingRow {
  return {
    variantId: row.variantId,
    marks: ChecklistMarksSchema.parse(row.checklistMarks),
    cp5Enabled: row.cp5Enabled,
    // `row.flowState` YA es la unión del pgEnum (`ready`|`waiting_confirmation`|`confirmed`) = PublishFlowState.
    flowState: row.flowState,
  };
}

/**
 * Un upsert por `variant_id`: inserta `values`, o si la fila ya existe aplica `set` (siempre con `updatedAt`).
 * Devuelve el estado resultante tipado. `.returning()` SIEMPRE da una fila (inserta o actualiza exactamente
 * una); 0 filas es un fallo de invariante que debe explotar, no un `!` silencioso. Los tres escritores
 * públicos (marca, CP5, flujo) son wrappers de una línea sobre esto — comparten todo salvo el payload.
 */
async function upsertPublishing(
  db: Db,
  values: typeof variantPublishing.$inferInsert,
  set: Record<string, unknown>,
): Promise<PublishingRow> {
  const rows = await db
    .insert(variantPublishing)
    .values(values)
    .onConflictDoUpdate({
      target: variantPublishing.variantId,
      set: { ...set, updatedAt: new Date() },
    })
    .returning();
  const [row] = rows;
  if (row === undefined) {
    throw new Error('variant_publishing: el upsert no devolvió ninguna fila');
  }
  return toRow(row);
}

/**
 * LEE el estado de publicación de una variante. Si aún no tiene fila (nunca se marcó nada ni se tocó CP5),
 * devuelve el DEFAULT sin crearla — leer no debe escribir. `undefined` NO se devuelve: una variante
 * aprobada siempre tiene un estado de publicación conceptual (aunque su fila no exista todavía).
 */
export async function getPublishingState(db: Db, variantId: string): Promise<PublishingRow> {
  const [row] = await db
    .select()
    .from(variantPublishing)
    .where(eq(variantPublishing.variantId, variantId));
  return row ? toRow(row) : defaultRow(variantId);
}

/**
 * MARCA (o desmarca) UN ítem del checklist. Upsert por `variant_id`: si la fila no existe se crea con la
 * marca; si existe, se FUSIONA la marca en el jsonb (`|| jsonb_build_object` preserva las otras). Idempotente
 * por construcción (marcar el mismo ítem al mismo valor = mismo mapa). Devuelve el estado resultante.
 */
export async function markChecklistItem(
  db: Db,
  variantId: string,
  itemId: string,
  done: boolean,
): Promise<PublishingRow> {
  const patch = sql`jsonb_build_object(${itemId}::text, ${done}::boolean)`;
  // Fusiona la marca nueva sobre las existentes (`||` es merge de jsonb, la clave derecha gana).
  return upsertPublishing(
    db,
    { variantId, checklistMarks: patch },
    { checklistMarks: sql`${variantPublishing.checklistMarks} || ${patch}` },
  );
}

/**
 * ACTIVA/DESACTIVA CP5 (el checkpoint opcional del flujo de publicación). Upsert por `variant_id`. NO toca
 * el `flow_state` ni las marcas. Devuelve el estado resultante.
 */
export async function setCp5Enabled(
  db: Db,
  variantId: string,
  cp5Enabled: boolean,
): Promise<PublishingRow> {
  return upsertPublishing(db, { variantId, cp5Enabled }, { cp5Enabled });
}

/**
 * FIJA el estado del flujo de publicación (`ready`/`waiting_confirmation`/`confirmed`). El caller ya calculó
 * el siguiente estado con `nextPublishState` de core (la máquina de estados vive en core, PURA); este repo
 * solo lo PERSISTE. Upsert por `variant_id`. Devuelve el estado resultante.
 */
export async function setPublishFlowState(
  db: Db,
  variantId: string,
  flowState: PublishFlowState,
): Promise<PublishingRow> {
  return upsertPublishing(db, { variantId, flowState }, { flowState });
}
