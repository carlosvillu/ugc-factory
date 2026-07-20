// Repo del agregado `asset` (db.md §4): funciones por caso de uso con el executor
// como PRIMER argumento. En T0.5 solo create/get (el endpoint de download hace
// getAsset(:id); el smoke/seed hace createAsset tras subir el fichero al
// StorageAdapter). list/update/delete llegan con sus consumidores. Nada de generic
// repository/active record.
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client';
import { asset, type Asset, type NewAsset } from '../schema/generation';

/**
 * Inserta una fila `asset` y devuelve la fila completa (con defaults e id
 * aplicados por la BD). `RETURNING` garantiza que lo devuelto es lo persistido.
 * El caller ya subió los bytes al StorageAdapter y pasa `bytes`/`checksum` que el
 * `put` devolvió — la fila y el fichero quedan consistentes.
 */
export async function createAsset(db: Db, values: NewAsset): Promise<Asset> {
  const [row] = await db.insert(asset).values(values).returning();
  if (!row) throw new Error('createAsset: INSERT no devolvió fila');
  return row;
}

/** Lee un asset por id; `undefined` si no existe (el endpoint lo mapea a 404). */
export async function getAsset(db: Db, id: string): Promise<Asset | undefined> {
  const [row] = await db.select().from(asset).where(eq(asset.id, id));
  return row;
}

/**
 * Lee los assets cuyos ids están en `ids` (lectura por lote). Lo usa el script de escalado de personas
 * (T4.12) para inspeccionar las `reference_image_ids` de una persona y distinguir las referencias IA
 * (`generationId !== null`, estampado por `createAsset` en generate-persona-images) de las sintéticas
 * del seed (`generationId === null`) que hay que limpiar. NO garantiza el orden de `ids` (irrelevante
 * para el filtro por `generationId`). `[]` in → `[]` out SIN tocar la BD (`inArray(col, [])` es un
 * footgun de Drizzle: genera SQL inválido / degenerado; se corta aquí). */
export async function getAssetsByIds(db: Db, ids: readonly string[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(asset)
    .where(inArray(asset.id, [...ids]));
}

/**
 * El asset de un `kind` producido por una generación (T4.5, N7b). Lo usa el finalizer de audio para
 * el NO-OP GRACIOSO: cuando la liquidación re-chequea `completed` bajo el lock y descubre que otra
 * ruta ya finalizó la generación (mundo concurrente de T4.11: webhook+poll+sweeper), devuelve el
 * asset que ESA ruta creó en vez de re-crear/re-cobrar — igual que `finalizeGeneration` devuelve el
 * estado ya finalizado. `undefined` si aún no hay asset de ese kind (invariante roto en ese punto).
 */
export async function getAssetByGenerationKind(
  db: Db,
  generationId: string,
  kind: Asset['kind'],
): Promise<Asset | undefined> {
  const [row] = await db
    .select()
    .from(asset)
    .where(and(eq(asset.generationId, generationId), eq(asset.kind, kind)));
  return row;
}

/**
 * LOOKUP de la CACHÉ NORMALIZE-ONCE del render (T5.2, §9.7): el asset NORMALIZADO cuya
 * `normalized_cache_key` coincide (= derivación pura de `checksum-del-origen + perfil`). Lo usa el
 * normalizador ANTES de encodear: si existe, es un CACHE HIT (no lanza ffmpeg, reutiliza el asset ya
 * normalizado); si `undefined`, encoda, sube y crea la fila con esta key. Molde de `getAssetByGenerationKind`.
 * `undefined` = miss (nadie ha normalizado ese origen×perfil todavía). El índice PARCIAL
 * `asset_normalized_cache_key_idx` acelera este SELECT. Si por una carrera hubiera >1 fila con la misma
 * key (posible: el índice NO es único, ver el schema), devuelve una cualquiera — ambas son normalizados
 * equivalentes del mismo origen×perfil, así que el hit es correcto sea cual sea.
 */
export async function getAssetByNormalizedCacheKey(
  db: Db,
  normalizedCacheKey: string,
): Promise<Asset | undefined> {
  const [row] = await db
    .select()
    .from(asset)
    .where(eq(asset.normalizedCacheKey, normalizedCacheKey));
  return row;
}

/**
 * Estampa la caché de upload a fal storage (T4.1, §9.6): la `fal_url` que fal devolvió y
 * el `fal_uploaded_at` = ahora. Se llama SOLO tras un upload REAL. La 2ª vez que se sube
 * el mismo input NO se llama aquí (cache-hit), así que `fal_uploaded_at` no cambia — que
 * es la señal observable de la Verificación ("un solo upload"). Devuelve la fila
 * actualizada.
 */
export async function setAssetFalUpload(
  db: Db,
  id: string,
  falUrl: string,
  uploadedAt: Date,
): Promise<Asset> {
  const [row] = await db
    .update(asset)
    .set({ falUrl, falUploadedAt: uploadedAt })
    .where(eq(asset.id, id))
    .returning();
  if (!row) throw new Error(`setAssetFalUpload: no existe el asset ${id}`);
  return row;
}

/**
 * SELLA los word timestamps del ASR (T4.5, N7b) sobre un asset de audio ya persistido
 * (`kind='tts_audio'`). §13.1: el ASR (`fal-ai/elevenlabs/speech-to-text`) es una SEGUNDA
 * llamada fal encadenada tras el TTS; devuelve JSON (no un fichero), así que NO es un asset
 * propio — sus timestamps se estampan sobre el MISMO asset del audio TTS. `wordTimestamps` es
 * el jsonb ya VALIDADO por `WordTimestampsSchema` de core (el repo persiste lo que el servicio
 * validó, no revalida). Devuelve la fila actualizada.
 */
export async function setAssetWordTimestamps(
  db: Db,
  id: string,
  wordTimestamps: unknown,
): Promise<Asset> {
  const [row] = await db.update(asset).set({ wordTimestamps }).where(eq(asset.id, id)).returning();
  if (!row) throw new Error(`setAssetWordTimestamps: no existe el asset ${id}`);
  return row;
}
