// Repo del agregado `persona` (T2.0; db.md §4: funciones por caso de uso con el executor como
// PRIMER argumento, nada de generic repository).
//
// Casos de uso que existen HOY (y solo esos — un repo empieza con la query que necesitas hoy):
//   · CRUD de `/personas`: list / get / create / update / remove.
//   · Imágenes de referencia: añadir el ULID de un asset ya subido (append al array, en ORDEN)
//     y quitarlo.
//   · Candidatas por `avatar_hint`: la lista completa (la REGLA de matching es pura y vive en
//     `@ugc/core/persona`; aquí solo se lee).
//   · Seed IDEMPOTENTE por clave natural (el nombre), mismo patrón que `library.repo.ts` (T2.1):
//     `ON CONFLICT (name) DO UPDATE` con `excluded.*` — el seed es la fuente de verdad de los
//     METADATOS de la persona; la BD, de su HISTORIA (`perf` NUNCA se pisa).
import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client';
import type { SeedConflictPolicy } from './library.repo';
import { asset } from '../schema/generation';
import { persona, type NewPersona, type Persona } from '../schema/gallery';

/** Todas las personas de la librería, orden estable por nombre (lo que pinta `/personas` y lo
 *  que el endpoint de candidatas filtra con la regla pura de core). */
export async function listPersonas(db: Db): Promise<Persona[]> {
  return db.select().from(persona).orderBy(asc(persona.name));
}

/** Una persona por id; `undefined` si no existe (el endpoint lo mapea a 404). */
export async function getPersona(db: Db, id: string): Promise<Persona | undefined> {
  const [row] = await db.select().from(persona).where(eq(persona.id, id));
  return row;
}

/** Crea una persona. El UNIQUE de `name` rechaza el duplicado (23505) — el endpoint lo traduce. */
export async function createPersona(db: Db, values: NewPersona): Promise<Persona> {
  const [row] = await db.insert(persona).values(values).returning();
  if (!row) throw new Error('createPersona: INSERT no devolvió fila');
  return row;
}

/**
 * Actualiza los campos que vengan en `patch` (PATCH parcial). `undefined` si el id no existe.
 *
 * ⚠ EL PATCH VACÍO ES UN NO-OP LEGÍTIMO, NO UN ERROR — y el guard va AQUÍ, no en el handler.
 *
 * El bug (code-review de T2.0): `PersonaPatchSchema` es `.partial()`, así que un body `{}` VALIDA
 * (y `{"foo":1}` también: Zod descarta las claves desconocidas y deja `{}`). Con eso, Drizzle
 * recibía `.set({})` y lanzaba **`No values to set`** — un `Error` genérico, no un `AppError` ⇒
 * el envelope lo rendía como **500**. Camino real del usuario: abrir la ficha y pulsar «Guardar»
 * sin cambiar nada (el formulario manda solo lo que cambió).
 *
 * Se arregla en el REPO y no solo en el route handler porque `updatePersona` es una función
 * exportada: cualquier caller futuro (T2.2, T2.3) tropezaría con la misma mina. Y se devuelve la
 * fila SIN TOCARLA (200 no-op) en vez de un 400, porque «no he cambiado nada» no es un error del
 * usuario: es el resultado que pidió. Tampoco se toca `updatedAt` — no ha pasado nada que fechar.
 */
export async function updatePersona(
  db: Db,
  id: string,
  patch: Partial<NewPersona>,
): Promise<Persona | undefined> {
  // Sin columnas que escribir no hay UPDATE que hacer. Se lee la fila para que el contrato de
  // retorno se mantenga: existe ⇒ la fila; no existe ⇒ `undefined` ⇒ el endpoint da 404.
  if (Object.keys(patch).length === 0) return getPersona(db, id);

  const [row] = await db.update(persona).set(patch).where(eq(persona.id, id)).returning();
  return row;
}

/**
 * Borra una persona Y SUS ASSETS de referencia, en UNA transacción.
 *
 * Por qué los assets se borran aquí a mano y no por FK: `reference_image_ids` es un `text[]`
 * (ver el comentario del schema), así que Postgres no puede cascadear por elemento. La
 * alternativa —dejar las filas `asset` huérfanas— llenaría la tabla de assets que nadie
 * referencia y cuyos ficheros nadie va a borrar nunca. El borrado del FICHERO en el
 * StorageAdapter lo hace el caller (web) con las keys que esta función devuelve: db no conoce
 * el almacén.
 *
 * Las `ad_variant` que usaron la persona NO se borran: su FK es `ON DELETE set null` (decisión
 * de producto de T2.0 — borrar una persona no borra los anuncios que ya hizo).
 *
 * Devuelve las `storage_key` de los assets borrados, o `null` si la persona no existía.
 */
export async function removePersona(db: Db, id: string): Promise<string[] | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(persona).where(eq(persona.id, id)).for('update');
    if (!row) return null;

    const imageIds = row.referenceImageIds;
    let storageKeys: string[] = [];
    if (imageIds.length > 0) {
      const deleted = await tx
        .delete(asset)
        .where(inArray(asset.id, imageIds))
        .returning({ storageKey: asset.storageKey });
      storageKeys = deleted.map((d) => d.storageKey);
    }
    await tx.delete(persona).where(eq(persona.id, id));
    return storageKeys;
  });
}

/**
 * Añade el ULID de un asset ya subido al final de `reference_image_ids` (el ORDEN importa: el
 * primero es el retrato principal del identity lock).
 *
 * `array_append` en SQL y NO "leer el array, empujar en JS, escribir el array": lo segundo es
 * una carrera perdida por construcción (dos uploads simultáneos y uno se pisa al otro). La BD
 * hace el append sobre la fila viva.
 */
export async function addReferenceImage(
  db: Db,
  personaId: string,
  assetId: string,
): Promise<Persona | undefined> {
  const [row] = await db
    .update(persona)
    .set({
      referenceImageIds: sql`array_append(${persona.referenceImageIds}, ${assetId})`,
      updatedAt: new Date(),
    })
    .where(eq(persona.id, personaId))
    .returning();
  return row;
}

/** Quita una imagen de referencia de la persona y borra su fila `asset`, en UNA transacción.
 *  Devuelve la `storage_key` del fichero a borrar (el caller lo borra del almacén), o `null`
 *  si la persona o la imagen no existían. */
export async function removeReferenceImage(
  db: Db,
  personaId: string,
  assetId: string,
): Promise<{ persona: Persona; storageKey: string } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(persona).where(eq(persona.id, personaId)).for('update');
    if (!row?.referenceImageIds.includes(assetId)) return null;

    const [updated] = await tx
      .update(persona)
      .set({
        referenceImageIds: sql`array_remove(${persona.referenceImageIds}, ${assetId})`,
        updatedAt: new Date(),
      })
      .where(eq(persona.id, personaId))
      .returning();
    if (!updated) return null;

    const [deleted] = await tx
      .delete(asset)
      .where(eq(asset.id, assetId))
      .returning({ storageKey: asset.storageKey });
    if (!deleted) return null;

    return { persona: updated, storageKey: deleted.storageKey };
  });
}

/**
 * SIEMBRA IDEMPOTENTE de una persona por su CLAVE NATURAL (el nombre).
 *
 * Mismo contrato que `seedLibrary` (T2.1): **el seed es la fuente de verdad de los METADATOS;
 * la BD, de la historia.** Se reescriben demografía, personalidad, wardrobe y voice_map; NO se
 * tocan ni `perf` (rendimiento acumulado en F7) ni la PK (las FKs de `ad_variant.persona_id`
 * siguen apuntando a la misma persona) ni `reference_image_ids` (las imágenes las gestiona el
 * caller: sembrar de nuevo no puede tirar las que el usuario subió a mano).
 *
 * Devuelve la fila y si fue una inserción NUEVA (el caller decide si generar imágenes: solo se
 * generan para una persona recién creada — re-sembrar no debe duplicar assets ni pisar las
 * imágenes reales que el usuario haya subido por el CRUD).
 *
 * `onConflict` (T3.9): mismo hilo de política que `seedLibrary`/`seedGallery`.
 *   - `'update'` (default): `pnpm seed` — re-siembra deliberada tras un cambio de código en los
 *     metadatos placeholder.
 *   - `'nothing'`: el ARRANQUE de web. CRÍTICO: `gender`/`descriptor`/`voiceMap`… los edita el
 *     usuario por el PATCH `/api/personas/[id]` (`updatePersona`). Un `DO UPDATE` en el boot los
 *     REVERTIRÍA en cada redeploy → pérdida de datos, la misma clase que T3.9 elimina en templates.
 *     Con `'nothing'`, la fila viva no se toca; una persona placeholder NUEVA del código sí entra.
 */
export async function upsertPersonaByName(
  db: Db,
  values: NewPersona,
  opts: { onConflict?: SeedConflictPolicy } = {},
): Promise<{ persona: Persona; created: boolean }> {
  const onConflict = opts.onConflict ?? 'update';
  const before = await db
    .select({ id: persona.id })
    .from(persona)
    .where(eq(persona.name, values.name));

  const insertPersona = db.insert(persona).values(values);
  const [row] = await (
    onConflict === 'nothing'
      ? insertPersona.onConflictDoNothing({ target: persona.name })
      : insertPersona.onConflictDoUpdate({
          target: persona.name,
          set: {
            // `excluded` = la fila que se intentaba insertar (patrón de library.repo.ts).
            ageRange: sql`excluded.age_range`,
            gender: sql`excluded.gender`,
            ethnicity: sql`excluded.ethnicity`,
            style: sql`excluded.style`,
            descriptor: sql`excluded.descriptor`,
            setting: sql`excluded.setting`,
            personality: sql`excluded.personality`,
            wardrobeNotes: sql`excluded.wardrobe_notes`,
            voiceMap: sql`excluded.voice_map`,
            updatedAt: new Date(),
          },
        })
  ).returning();

  // `DO NOTHING` NO devuelve fila cuando la persona ya existía (el INSERT no toca nada). Se relee
  // SIEMPRE por la clave natural — NO condicionado a `before` — para que el contrato
  // (`{ persona, created }`) sea el mismo en ambas ramas. La condición sobre `before` sería una
  // RACE de primer arranque: el seed NO tiene advisory lock (a diferencia de `runMigrations`), así
  // que en un boot CONCURRENTE contra BD vacía dos instancias de web arrancan a la vez; la perdedora
  // ve `before` vacío pero su INSERT choca con la fila del ganador → `DO NOTHING` no devuelve fila.
  // Releer solo si `before` no estaba vacío la habría tirado al throw y TUMBADO el arranque — justo
  // el modo de fallo que T3.9 elimina. `created: false` es además correcto: esta instancia no la creó.
  if (!row) {
    if (onConflict === 'nothing') {
      const [existing] = await db.select().from(persona).where(eq(persona.name, values.name));
      if (existing) return { persona: existing, created: false };
      // Sin fila tras un `DO NOTHING` es un estado imposible (o insertamos, o chocamos con una
      // existente): si aquí no aparece, algo grave pasa y el throw ruidoso es lo correcto.
      throw new Error('upsertPersonaByName: DO NOTHING sin fila y la persona no se releyó');
    }
    throw new Error('upsertPersonaByName: UPSERT no devolvió fila');
  }

  return { persona: row, created: before.length === 0 };
}

/** Cuántas personas hay (lo que `pnpm seed` imprime y lo que mira la Verificación). */
export async function countPersonas(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(persona);
  return row?.n ?? 0;
}
