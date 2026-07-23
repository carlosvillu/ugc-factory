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
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { newUlid } from '@ugc/core/contracts';
import type { BatchPlan, QaReport } from '@ugc/core/contracts';
import type { AdObjective, RecipeTier } from '@ugc/core/library';
import type { Db } from '../client';
import { adBatch, adVariant, type AdBatch, type AdVariant } from '../schema/batch';
import { hookLine, persona, promptTemplate } from '../schema/gallery';
import { asset, type Asset } from '../schema/generation';
import { createAsset } from './asset.repo';

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

/** Una variante por id; `undefined` si no existe (T4.11). La necesita `buildVariantGenerationPlan`
 *  (@ugc/services) para ensamblar el plan de generación de UNA variante `scripted` sin recorrer todo
 *  su lote — tiene el `variantId` directo (de las variantes `scripted` que CP3 aprobó). */
export async function getVariant(db: Db, id: string): Promise<AdVariant | undefined> {
  const [row] = await db.select().from(adVariant).where(eq(adVariant.id, id));
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

/** Los valores del enum `audio_source` (§7.2 N7e, migración 0021): de dónde viene el audio de fondo de
 *  la variante. `ai_bed` = bed generado por N7e; `own_license`/`native_trending` los pondría F5/F6. */
export type AudioSource = (typeof adVariant.audioSource.enumValues)[number];

/**
 * Marca el `audio_source` de una variante (T4.11): el efecto de dominio de N7e escribe `'ai_bed'` cuando
 * genera el bed de música (Verificación de T4.11, movida desde T4.9). Idempotente: reescribir el mismo
 * valor es inocuo (un retry del step no corrompe nada). Devuelve `true` si la fila existía.
 */
export async function setVariantAudioSource(
  db: Db,
  variantId: string,
  audioSource: AudioSource,
): Promise<boolean> {
  const updated = await db
    .update(adVariant)
    .set({ audioSource })
    .where(eq(adVariant.id, variantId))
    .returning({ id: adVariant.id });
  return updated.length > 0;
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

// ── PASE FINAL: persistencia del máster + thumbnail + qa_report (T5.5, §9.7 N8/N9 / §12) ────────────
//
// El módulo `composeVariant` (@ugc/services) es bytes-in/bytes-out: NO escribe en la BD. Esta función es su
// PERSISTENCIA — el gemelo de `finalizeGeneration` para el pase final. El caller (executor N8/N9, fuera del
// alcance de T5.5) ya subió los bytes del máster y del thumbnail al StorageAdapter y pasa aquí sus
// `storageKey`/`bytes`/`checksum` (lo que devolvió `storage.put`). Esta función:
//   1. crea la fila `asset` del MÁSTER (`kind:'final_video'`) con LINAJE `parent_asset_ids` = los assets
//      origen del que deriva (los clips + voces + bed de los segmentos) — el linaje que T5.7 exige del
//      máster hasta el hook. Precedente: `finalizeGeneration` crea la fila con checksum, no un update suelto.
//   2. crea la fila `asset` del THUMBNAIL (`kind:'thumbnail'`), con `parent_asset_ids:[masterId]` (deriva
//      del máster).
//   3. actualiza `ad_variant.{master_asset_id, thumbnail_asset_id, qa_report, score}`.
// TODO en UNA transacción: o quedan las dos filas `asset` + el update de la variante, o nada (un máster
// registrado en la variante que apunta a un asset inexistente sería un estado roto).

export interface FinalizeVariantMasterInput {
  variantId: string;
  /** El máster firmado ya subido a storage (`storage.put` devolvió estos campos). */
  master: {
    storageKey: string;
    mime: string;
    bytes: number;
    checksum: string;
    width?: number;
    height?: number;
    durationS?: number;
  };
  /** El thumbnail ya subido a storage. */
  thumbnail: {
    storageKey: string;
    mime: string;
    bytes: number;
    checksum: string;
    width?: number;
    height?: number;
  };
  /** LINAJE del máster: los ids de los assets ORIGEN de los que deriva (los clips de vídeo + voces + bed de
   *  los segmentos del `composition_spec`). T5.7 recorre este linaje del máster hasta el hook. */
  parentAssetIds: string[];
  /** El `qa_report` (validado por `QaReportSchema` de core; el repo persiste lo que el servicio validó). */
  qaReport: QaReport;
}

export interface FinalizeVariantMasterResult {
  master: Asset;
  thumbnail: Asset;
  variant: AdVariant;
}

/**
 * Persiste el resultado del pase final de una variante: la fila `asset` del máster (con linaje) + la del
 * thumbnail + el update de `ad_variant.{master_asset_id, thumbnail_asset_id, qa_report, score}`. TODO en una
 * transacción. El `score` sale del `qa_report` (§12: entero 0–100). LANZA si la variante no existe.
 */
export async function finalizeVariantMaster(
  db: Db,
  input: FinalizeVariantMasterInput,
): Promise<FinalizeVariantMasterResult> {
  return db.transaction(async (tx) => {
    // `createAsset` es el único punto de creación de assets (asset.repo.ts): reusarlo dentro de la tx (Db =
    // DbClient | DbTx) evita re-implementar el insert+guard dos veces. Drizzle omite los campos `undefined`,
    // así que las dimensiones nullable se pasan directas (sin spread condicional).
    const master = await createAsset(tx, {
      kind: 'final_video',
      storageKey: input.master.storageKey,
      mime: input.master.mime,
      bytes: input.master.bytes,
      checksum: input.master.checksum,
      width: input.master.width,
      height: input.master.height,
      durationS: input.master.durationS,
      // El LINAJE: los assets origen del máster (§12 `asset.parent_asset_ids`). T5.7 lo recorre.
      parentAssetIds: input.parentAssetIds,
    });

    const thumbnail = await createAsset(tx, {
      kind: 'thumbnail',
      storageKey: input.thumbnail.storageKey,
      mime: input.thumbnail.mime,
      bytes: input.thumbnail.bytes,
      checksum: input.thumbnail.checksum,
      width: input.thumbnail.width,
      height: input.thumbnail.height,
      // El thumbnail deriva del máster.
      parentAssetIds: [master.id],
    });

    const [variant] = await tx
      .update(adVariant)
      .set({
        masterAssetId: master.id,
        thumbnailAssetId: thumbnail.id,
        qaReport: input.qaReport,
        score: input.qaReport.score,
      })
      .where(eq(adVariant.id, input.variantId))
      .returning();
    if (!variant)
      throw new Error(`finalizeVariantMaster: no existe la variante ${input.variantId}`);

    return { master, thumbnail, variant };
  });
}

// ── CP4: veredicto humano de QA sobre la variante (T5.5c, §9.0 / §12) ────────────────────────────────
//
// El WRITER de `ad_variant.status` a `approved`/`rejected` — la contraparte de `applyScriptVerdicts` (que
// escribe `scripted`) para el checkpoint de QA. Hasta T5.5c solo `scripted` tenía writer; el resto del
// enum (`approved`/`rejected`/`published`) esperaba a su fase. CP4 estrena `approved`/`rejected`: el humano
// aprueba o rechaza el máster de la variante en el panel de QA (N9 pausó en `waiting_approval`).
//
// NO abre transacción propia: lo INVOCA el efecto de dominio de CP4 (`server/qa-checkpoint.ts`) DENTRO de
// la tx de la transición del checkpoint (el `db` que recibe ES la tx). Así el status de la variante y la
// transición del step (`approve`→succeeded / `reject`→rejected) commitean juntos o nada — el mismo
// invariante de atomicidad que CP1/CP3 (si el status se escribiera fuera de la tx y la transición fallara,
// la variante quedaría `approved` sobre un step que sigue en `waiting_approval`).

/** El veredicto humano de CP4 sobre una variante: aprobada (máster publicable) o rechazada (descartada). */
type QaVerdictStatus = 'approved' | 'rejected';

/**
 * Fija `ad_variant.status` al veredicto de QA de CP4 (`approved`/`rejected`). Un solo UPDATE dentro de la
 * tx del caller (sin transacción propia — es una escritura atómica). LANZA si la variante no existe (el
 * caller apunta a una variante que no es de este run: es más honesto fallar que no-opear en silencio).
 * Devuelve la fila actualizada.
 */
export async function setVariantQaVerdict(
  db: Db,
  variantId: string,
  status: QaVerdictStatus,
): Promise<AdVariant> {
  const [variant] = await db
    .update(adVariant)
    .set({ status })
    .where(eq(adVariant.id, variantId))
    .returning();
  if (!variant) {
    throw new Error(`setVariantQaVerdict: no existe la variante ${variantId}`);
  }
  return variant;
}

// ── READ-MODELS DE LA BIBLIOTECA `/library` (T5.7, §9.7 N10) ─────────────────────────────────────────
//
// Dos lecturas para la página de vídeos terminados: la LISTA filtrable de variantes aprobadas, y el LINAJE
// COMPLETO de una (del máster hasta el hook line y el `template@version` EXACTOS). Query builder con join
// (no relational queries): los punteros a la librería (`hook_line_id`/`persona_id`/`prompt_template_id`) son
// NULLABLES (una variante con hook del brief no referencia `hook_line`), así que se usa `leftJoin` — un inner
// join perdería variantes y el linaje debe TOLERAR el null, no lanzar. El `destination` (§14) sale del jsonb
// `ad_batch.matrix` (modelado mínimo de T5.7): `matrix->>'destination'`, COALESCE a 'organic' para legacy.

/** El destino del lote (§14) desde el jsonb `ad_batch.matrix`, con COALESCE a 'organic' para las matrices
 *  legacy (sin la clave). Compartido por los DOS read-models de la biblioteca (lista + linaje): la clave
 *  jsonb y el default viven en UN solo sitio y no pueden divergir. */
const destinationExpr = () => sql<string>`COALESCE(${adBatch.matrix}->>'destination', 'organic')`;

/** Una fila de la LISTA de `/library`: los campos ligeros de la tarjeta + lo que la lista filtra. */
export interface LibraryVariantRow {
  id: string;
  filenameCode: string;
  angleName: string;
  language: string;
  status: string;
  durationTarget: number;
  platformTargets: string[];
  masterAssetId: string | null;
  thumbnailAssetId: string | null;
  score: number | null;
  objective: string;
  destination: string;
}

export interface ListLibraryVariantsFilters {
  /** Objetivo del lote (`hook_test` | `conversion` | `story`). */
  objective?: string;
  /** Idioma de la variante. */
  language?: string;
  /** Una plataforma presente en `platform_targets` (`@>` sobre el array). */
  platform?: string;
}

/**
 * Las variantes de la BIBLIOTECA: SOLO las `approved` (§9.7 N10: «por variante aprobada» — las que tienen
 * máster descargable), filtradas por objetivo/idioma/plataforma. Orden por `created_at` desc (lo último
 * aprobado primero), estable por id.
 */
export async function listLibraryVariants(
  db: Db,
  filters: ListLibraryVariantsFilters = {},
): Promise<LibraryVariantRow[]> {
  const conditions = [eq(adVariant.status, 'approved')];
  if (filters.objective !== undefined) {
    conditions.push(eq(adBatch.objective, filters.objective as AdObjective));
  }
  if (filters.language !== undefined) {
    conditions.push(eq(adVariant.language, filters.language));
  }
  if (filters.platform !== undefined) {
    // `@>` (contiene) sobre `platform_targets`. El valor viaja PARAMETRIZADO como array de un elemento
    // (nunca interpolado en el SQL) — sin superficie de inyección.
    conditions.push(sql`${adVariant.platformTargets} @> ARRAY[${filters.platform}]::text[]`);
  }

  return db
    .select({
      id: adVariant.id,
      filenameCode: adVariant.filenameCode,
      angleName: adVariant.angleName,
      language: adVariant.language,
      status: adVariant.status,
      durationTarget: adVariant.durationTarget,
      platformTargets: adVariant.platformTargets,
      masterAssetId: adVariant.masterAssetId,
      thumbnailAssetId: adVariant.thumbnailAssetId,
      score: adVariant.score,
      objective: adBatch.objective,
      destination: destinationExpr(),
    })
    .from(adVariant)
    .innerJoin(adBatch, eq(adVariant.batchId, adBatch.id))
    .where(and(...conditions))
    .orderBy(desc(adVariant.createdAt), desc(adVariant.id));
}

/**
 * El LINAJE COMPLETO de una variante (§12, panel 4c del mockup). Del máster hasta el hook line y el
 * `template@version` EXACTOS, pasando por persona y objetivo/destino del lote. Todos los punteros a la
 * librería son NULLABLES (leftJoin): una variante con hook del BRIEF trae `hook: null` — el linaje lo
 * refleja, NO lanza. `undefined` si la variante no existe.
 *
 * `templateVersion` es la versión EXACTA que se usó (columna de la variante, no la última del template): la
 * identidad reproducible es `template@version` (§10.1), fijada por el compositor al planificar.
 */
export interface VariantLineage {
  variant: {
    id: string;
    filenameCode: string;
    angleName: string;
    framework: string;
    language: string;
    durationTarget: number;
    platformTargets: string[];
    status: string;
    audioSource: string | null;
    score: number | null;
    masterAssetId: string | null;
    thumbnailAssetId: string | null;
  };
  /** El hook line (de la librería) o `null` si el hook vino del brief (`hook_line_id` null). */
  hook: { id: string; text: string; angle: string } | null;
  /** La persona (avatar) o `null` si la variante no fijó persona. */
  persona: { id: string; name: string } | null;
  /** El template + su versión EXACTA (`slug@version`), o `null` si no se registró template. */
  template: { id: string; slug: string; title: string; version: number } | null;
  /** El máster final (duración/dimensiones para el linaje), o `null` si aún no se compuso. */
  master: {
    id: string;
    durationS: number | null;
    width: number | null;
    height: number | null;
  } | null;
  /** El lote: su objetivo, destino (§14) y el brief del que nace (para el brand_name del bundle). */
  batch: { id: string; briefId: string; objective: string; destination: string };
}

export async function getVariantLineage(
  db: Db,
  variantId: string,
): Promise<VariantLineage | undefined> {
  const [row] = await db
    .select({
      variantId: adVariant.id,
      filenameCode: adVariant.filenameCode,
      angleName: adVariant.angleName,
      framework: adVariant.framework,
      language: adVariant.language,
      durationTarget: adVariant.durationTarget,
      platformTargets: adVariant.platformTargets,
      status: adVariant.status,
      audioSource: adVariant.audioSource,
      score: adVariant.score,
      masterAssetId: adVariant.masterAssetId,
      thumbnailAssetId: adVariant.thumbnailAssetId,
      templateVersion: adVariant.templateVersion,
      hookId: hookLine.id,
      hookText: hookLine.text,
      hookAngle: hookLine.angle,
      personaId: persona.id,
      personaName: persona.name,
      templateId: promptTemplate.id,
      templateSlug: promptTemplate.slug,
      templateTitle: promptTemplate.title,
      masterId: asset.id,
      masterDurationS: asset.durationS,
      masterWidth: asset.width,
      masterHeight: asset.height,
      batchId: adBatch.id,
      briefId: adBatch.briefId,
      objective: adBatch.objective,
      destination: destinationExpr(),
    })
    .from(adVariant)
    .innerJoin(adBatch, eq(adVariant.batchId, adBatch.id))
    .leftJoin(hookLine, eq(adVariant.hookLineId, hookLine.id))
    .leftJoin(persona, eq(adVariant.personaId, persona.id))
    .leftJoin(promptTemplate, eq(adVariant.promptTemplateId, promptTemplate.id))
    .leftJoin(asset, eq(adVariant.masterAssetId, asset.id))
    .where(eq(adVariant.id, variantId));

  if (row === undefined) return undefined;

  return {
    variant: {
      id: row.variantId,
      filenameCode: row.filenameCode,
      angleName: row.angleName,
      framework: row.framework,
      language: row.language,
      durationTarget: row.durationTarget,
      platformTargets: row.platformTargets,
      status: row.status,
      audioSource: row.audioSource,
      score: row.score,
      masterAssetId: row.masterAssetId,
      thumbnailAssetId: row.thumbnailAssetId,
    },
    hook:
      row.hookId !== null && row.hookText !== null && row.hookAngle !== null
        ? { id: row.hookId, text: row.hookText, angle: row.hookAngle }
        : null,
    persona:
      row.personaId !== null && row.personaName !== null
        ? { id: row.personaId, name: row.personaName }
        : null,
    // El template exige AMBOS: la fila del template (slug/title por el join) Y la versión EXACTA de la
    // variante (columna). Sin versión no hay identidad reproducible `template@version` → null.
    template:
      row.templateId !== null &&
      row.templateSlug !== null &&
      row.templateTitle !== null &&
      row.templateVersion !== null
        ? {
            id: row.templateId,
            slug: row.templateSlug,
            title: row.templateTitle,
            version: row.templateVersion,
          }
        : null,
    master:
      row.masterId !== null
        ? {
            id: row.masterId,
            durationS: row.masterDurationS,
            width: row.masterWidth,
            height: row.masterHeight,
          }
        : null,
    batch: {
      id: row.batchId,
      briefId: row.briefId,
      objective: row.objective,
      destination: row.destination,
    },
  };
}
