// Repo del agregado `ad_batch` + `ad_variant` (T2.3, CP2: «confirmación que crea las `ad_variant`
// en `planned`»). db.md §4: funciones por caso de uso, executor como PRIMER argumento.
//
// ── LA OPERACIÓN ES UNA SOLA, Y ES TRANSACCIONAL ────────────────────────────────────────────
// Crear el lote son DOS escrituras que no valen nada por separado: la fila `ad_batch` (con su
// matriz y su coste estimado) y las N filas `ad_variant` en `planned`. Un lote sin variantes es
// un lote fantasma que la UI enseñaría vacío; unas variantes sin lote no pueden existir (FK). Y
// hay un tercer motivo, el decisivo: **el `filename_code` es UNIQUE GLOBAL** (§12), así que la
// N-ésima variante puede chocar — y si eso pasa, lo correcto es que NO quede ni el lote.
//
// ── EL `filename_code` Y SU DISCRIMINANTE ───────────────────────────────────────────────────
// El id del lote es el `batchDiscriminator` de `composeMatrix`, y por eso esta función **genera
// el ULID del lote ANTES de componer**: sin conocer el id no se puede componer un plan
// insertable, y sin componer con el id dos lotes de la misma config colisionan en el UNIQUE. El
// caller pasa un `composePlan(batchId)` — la matriz se compone DENTRO, con el id ya en la mano.
//
// ── EL `hook_line_id` SE RESUELVE POR SU CLAVE NATURAL ──────────────────────────────────────
// `PlannedHook` NO trae id de BD (core no conoce la BD): trae `text` + `source`. Los de `source:
// 'library'` se resuelven con el UNIQUE natural **(language, text)** —el mismo que usa el seed de
// T2.1— en UNA query para todo el lote (nada de N+1), y los de `source: 'brief'` van a NULL (§12
// lo marca `hook_line_id?`: no hay fila que referenciar). El contrato de `PlannedHookSchema`
// explica por qué NO hay índice posicional: un índice al array de la llamada, guardado en un
// documento que sobrevive a la llamada, apuntaría a otra línea EN SILENCIO.
import { eq, inArray } from 'drizzle-orm';
import { newUlid } from '@ugc/core/contracts';
import type { BatchPlan } from '@ugc/core/contracts';
import type { AdObjective, RecipeTier } from '@ugc/core/library';
import type { Db } from '../client';
import { adBatch, adVariant, type AdBatch, type AdVariant } from '../schema/batch';
import { hookLine, persona } from '../schema/gallery';

export interface CreateBatchInput {
  projectId: string;
  briefId: string;
  tier: RecipeTier;
  objective: AdObjective;
  languages: string[];
  /** Coste estimado del lote en CÉNTIMOS (`ad_batch.cost_estimated_cents`). Es el MÁXIMO de la
   *  horquilla del estimador: lo que se autoriza a gastar es el techo de lo que se enseñó, no su
   *  suelo — presupuestar por el mínimo sería prometer un lote más barato de lo que puede salir. */
  costEstimatedCents: number;
  /**
   * Compone el `BatchPlan` DEFINITIVO con el id del lote ya asignado. Es una función y no un
   * plan ya hecho porque el `filename_code` DEPENDE del id (ver la cabecera): recibir el plan
   * hecho obligaría al caller a componerlo sin discriminante, que es justo lo que revienta.
   */
  composePlan: (batchId: string) => BatchPlan;
}

export interface CreatedBatch {
  batch: AdBatch;
  variants: AdVariant[];
}

/**
 * Crea el lote y sus variantes en `planned`, en UNA transacción. Devuelve las filas creadas.
 *
 * La `persona` de cada variante se resuelve por NOMBRE (que es lo que el plan lleva: `personaName`,
 * el UNIQUE natural de `persona`) y en UNA query, igual que los hooks.
 */
export async function createBatchWithVariants(
  db: Db,
  input: CreateBatchInput,
): Promise<CreatedBatch> {
  // El id se genera AQUÍ (no lo delega al default de la columna) porque la matriz lo necesita
  // para componer los `filename_code` — y esa matriz es la que se inserta en la MISMA fila.
  const batchId = newUlid();
  const plan = input.composePlan(batchId);

  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(adBatch)
      .values({
        id: batchId,
        projectId: input.projectId,
        briefId: input.briefId,
        matrix: plan,
        tier: input.tier,
        objective: input.objective,
        languages: input.languages,
        costEstimatedCents: input.costEstimatedCents,
        status: 'planned',
      })
      .returning();
    if (!batch) throw new Error('createBatchWithVariants: el INSERT del lote no devolvió fila');

    const hookIds = await resolveLibraryHookIds(tx, plan);
    const personaIds = await resolvePersonaIds(tx, plan);

    const variants = await tx
      .insert(adVariant)
      .values(
        plan.variants.map((v) => ({
          batchId,
          angleName: v.angleName,
          framework: v.framework,
          // Solo los hooks de LIBRERÍA llevan FK; los del brief no tienen fila que referenciar.
          hookLineId:
            v.hook.source === 'library'
              ? resolvedOrThrow(hookIds, naturalKey(v.language, v.hook.text), 'hook de librería')
              : null,
          personaId:
            v.personaName === null ? null : resolvedOrThrow(personaIds, v.personaName, 'persona'),
          language: v.language,
          durationTarget: v.durationTargetSeconds,
          filenameCode: v.filenameCode,
          status: 'planned' as const,
        })),
      )
      .returning();

    return { batch, variants };
  });
}

/**
 * La clave natural de `hook_line`: (language, text) — el mismo UNIQUE que usa el seed de T2.1.
 *
 * El separador es NUL, y se escribe como ESCAPE (`\u0000`) y no como el byte crudo: crudo es
 * invisible en el editor y en los diffs, y un carácter de control escondido en el fuente es una
 * sesión de depuración absurda esperando a pasar. Se usa NUL porque es el único carácter que NO
 * puede aparecer dentro de un `text` ni de un `language`: con un separador «normal» (un espacio,
 * un `:`) dos pares distintos podrían colapsar en la MISMA clave — y una variante acabaría con la
 * FK de OTRA línea de librería.
 */
function naturalKey(language: string, text: string): string {
  return `${language}\u0000${text}`;
}

/**
 * El id de `key` en `resolved`, o REVIENTA. El `?? null` que había aquí era un bug de dinero:
 *
 * `hook_line_id` y `persona_id` son NULLABLE, pero su NULL ya SIGNIFICA algo — «este hook viene del
 * brief, no de la librería» y «esta variante no fija cara». Escribir NULL cuando la resolución
 * FALLA no es un default: es **drift** (el plan compuesto dice una cosa, la fila dice otra) escrito
 * con el MISMO valor que una decisión legítima del modelo, y por tanto indistinguible de ella. Sus
 * dos consecuencias son silenciosas y caras: una línea de librería sin su FK pierde la trazabilidad
 * de la que F7 realimenta `perf`/`usage_count`; y un lote que el usuario aprobó CON una cara sale
 * con variantes SIN cara, sin un solo error por ningún lado.
 *
 * Estamos DENTRO de la transacción del gasto y ANTES de gastar un céntimo: abortar es barato y deja
 * la BD intacta. Escribir una fila que miente, no. Si esto salta es un bug (el plan y la librería se
 * compusieron contra estados distintos de la BD, o alguien borró la fila entre componer y
 * confirmar), y el mensaje dice EXACTAMENTE qué no resolvió.
 *
 * OJO: esto NO contradice el `ON DELETE set null` de la FK. Ese NULL es para una persona borrada
 * DESPUÉS (borrar una persona no borra los anuncios que hizo). El de aquí sería una persona que
 * nunca resolvió AL CREAR. Mismo valor, dos sucesos distintos: solo el primero es legítimo.
 */
function resolvedOrThrow(resolved: Map<string, string>, key: string, kind: string): string {
  const id = resolved.get(key);
  if (id === undefined) {
    // El NUL de la clave natural es ilegible en un mensaje de error: se enseña como " / ".
    const readable = key.replace('\u0000', ' / ');
    throw new Error(
      `createBatchWithVariants: el plan referencia un ${kind} que no existe en la BD ` +
        `(${readable}). El lote NO se ha creado: escribir la variante con la FK a NULL habría ` +
        `sido indistinguible de una variante legítima sin ${kind}.`,
    );
  }
  return id;
}

/**
 * Los ids de las líneas de LIBRERÍA del plan, en UNA query (nada de un SELECT por variante).
 *
 * El `IN` va sobre los TEXTOS y el par se re-comprueba en memoria: un `OR (language=$1 AND
 * text=$2)` repetido N veces sería la query correcta pero ilegible y con N parámetros; con el
 * `IN` sobre textos —que son pocos y distintos— la fila que vuelva se indexa por su par completo,
 * así que una línea con el mismo texto en OTRO idioma no se puede colar.
 */
async function resolveLibraryHookIds(db: Db, plan: BatchPlan): Promise<Map<string, string>> {
  const texts = [
    ...new Set(plan.variants.filter((v) => v.hook.source === 'library').map((v) => v.hook.text)),
  ];
  if (texts.length === 0) return new Map();

  const rows = await db
    .select({ id: hookLine.id, text: hookLine.text, language: hookLine.language })
    .from(hookLine)
    .where(inArray(hookLine.text, texts));

  return new Map(rows.map((r) => [naturalKey(r.language, r.text), r.id]));
}

/** Los ids de las personas del plan, por su NOMBRE (el UNIQUE natural de `persona`). Una query. */
async function resolvePersonaIds(db: Db, plan: BatchPlan): Promise<Map<string, string>> {
  const names = [
    ...new Set(plan.variants.map((v) => v.personaName).filter((n): n is string => n !== null)),
  ];
  if (names.length === 0) return new Map();

  const rows = await db
    .select({ id: persona.id, name: persona.name })
    .from(persona)
    .where(inArray(persona.name, names));

  return new Map(rows.map((r) => [r.name, r.id]));
}

/**
 * El lote por id (T2.6): el executor de N5 lo necesita para sacar la matriz (`BatchPlan`) y el
 * `brief_id` del lote que la aprobación de CP2 creó. A diferencia de N4 —que arranca de una
 * dependencia (N3) resuelta por el orquestador—, N5 corre en un run NUEVO sin dependencias: el único
 * puntero que tiene al trabajo es el `batchId` de su config, y de él saca todo lo demás.
 */
export async function getBatch(db: Db, batchId: string): Promise<AdBatch | undefined> {
  const [row] = await db.select().from(adBatch).where(eq(adBatch.id, batchId));
  return row;
}

/** Las variantes de un lote, en orden estable por `filename_code` (lo que CP2 enseña tras crear
 *  el lote y lo que T2.4 recorre para escribir los guiones). */
export async function listBatchVariants(db: Db, batchId: string): Promise<AdVariant[]> {
  return db
    .select()
    .from(adVariant)
    .where(eq(adVariant.batchId, batchId))
    .orderBy(adVariant.filenameCode);
}

/**
 * Los lotes de un brief (T2.3: la Verificación pregunta «¿qué lote creó este checkpoint?», y la
 * pantalla del lote de F2/F5 los listará). Orden estable por id (ULID ⇒ cronológico).
 *
 * NOTA sobre la doble confirmación: no hay —ni puede haber— un UNIQUE «un lote por brief» (un
 * brief SÍ puede tener varios lotes legítimos, con configs distintas). La barrera contra el doble
 * clic es doble y ya existe: la transición del step (el segundo POST da 409, el step ya no está en
 * `waiting_approval`) y, por debajo, el UNIQUE GLOBAL de `filename_code`, contra el que el segundo
 * INSERT de la MISMA matriz revienta.
 */
export async function findBatchesByBrief(db: Db, briefId: string): Promise<AdBatch[]> {
  return db.select().from(adBatch).where(eq(adBatch.briefId, briefId)).orderBy(adBatch.id);
}
