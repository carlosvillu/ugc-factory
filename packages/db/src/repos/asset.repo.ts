// Repo del agregado `asset` (db.md §4): funciones por caso de uso con el executor
// como PRIMER argumento. En T0.5 solo create/get (el endpoint de download hace
// getAsset(:id); el smoke/seed hace createAsset tras subir el fichero al
// StorageAdapter). list/update/delete llegan con sus consumidores. Nada de generic
// repository/active record.
import { eq } from 'drizzle-orm';
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
