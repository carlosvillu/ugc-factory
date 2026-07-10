// Dominio `generation` (db.md §1: fichero `generation.ts` agrupa `generation` y
// `asset`). En T0.5 solo la tabla `asset` con el SUBSET MÍNIMO que pide la Entrega
// (id, kind, storage_key, mime, bytes, checksum); las columnas restantes de §12
// (width/height/duration_s, word_timestamps, parent_asset_ids, generation_id,
// fal_url…, normalized_cache_key) y la tabla `generation` llegan con sus
// consumidores (F4/§9.6-§9.7). No se anticipan aquí (misma disciplina que project.ts
// en T0.3).
import { integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps, ulidPk } from './columns.helpers';

// §12: `asset.kind` es un ENUM nativo con ESTOS valores exactos (db.md §1: los
// valores del enum son parte del contrato de la tabla; copiarlos bien la primera
// vez, añadir uno futuro es un `ALTER TYPE … ADD VALUE` trivial).
export const assetKind = pgEnum('asset_kind', [
  'product_image',
  'reference_image',
  'keyframe',
  'tts_audio',
  'avatar_clip',
  'broll_clip',
  'music_bed',
  'final_video',
  'thumbnail',
  'screenshot',
  'font',
  'other',
]);

export const asset = pgTable('asset', {
  id: ulidPk(),
  kind: assetKind('kind').notNull(),
  // Clave RELATIVA en el StorageAdapter (§19.2): nunca una ruta cruda del cliente.
  // El endpoint de download resuelve `:id` → esta columna → adapter.get(storage_key).
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  // `integer` (no `bigint`): cabe hasta 2 GB, suficiente para los assets del
  // pipeline, y pg lo devuelve como `number` — `bigint` volvería string y rompería
  // el tipo `bytes: number` del contrato del adaptador.
  bytes: integer('bytes').notNull(),
  // sha256 hex calculado por el StorageAdapter en `put` (32 bytes → 64 chars hex).
  checksum: text('checksum').notNull(),
  ...timestamps,
});

export type Asset = typeof asset.$inferSelect;
export type NewAsset = typeof asset.$inferInsert;
