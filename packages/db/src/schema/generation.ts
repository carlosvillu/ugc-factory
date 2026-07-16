// Dominio `generation` (db.md §1: fichero `generation.ts` agrupa `generation` y
// `asset`). T0.5 trajo `asset` con el subset mínimo; T4.1 (§9.6) trae la tabla
// `generation` COMPLETA y las columnas de `asset` que la generación real necesita
// (`fal_url`/`fal_uploaded_at` — la caché de upload a fal storage; §9.6). Las
// columnas de composición (`word_timestamps`, `parent_asset_ids`,
// `normalized_cache_key`, §9.7) siguen sin anticiparse: llegan en F5 con su
// consumidor.
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
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
  // ── T4.1 (§9.6, §12 l.528-534) ──────────────────────────────────────────────
  // CACHÉ DE UPLOAD A FAL STORAGE. Los inputs de una generación (imágenes de
  // producto/persona, audio) se suben a fal storage y fal devuelve una URL; subir el
  // MISMO asset dos veces desperdicia ancho de banda y tiempo. La caché es
  // `(asset_id, checksum)`: si `fal_url` ya está poblada Y el checksum del asset no
  // cambió, se reutiliza. `fal_uploaded_at` es la marca observable de "se subió" (la
  // Verificación comprueba que NO cambia en la 2ª pasada: cache-hit, no re-upload).
  falUrl: text('fal_url'),
  falUploadedAt: timestamp('fal_uploaded_at', { withTimezone: true }),
  // Dimensiones/duración del asset (§12 l.531-532). Un output de imagen (FLUX) las
  // lleva; se persisten para el estimador de coste por megapíxel y el compositor.
  // Nullable: un asset de input arbitrario puede no tenerlas.
  width: integer('width'),
  height: integer('height'),
  durationS: real('duration_s'),
  // La generación que PRODUJO este asset (§12 l.533). Nullable: los assets de INPUT
  // (imágenes de producto subidas por el usuario) no salen de ninguna generación. Sin
  // FK a `generation` a nivel de columna para evitar el ciclo de definición
  // (generation.qa referencia assets, asset.generation_id referencia generación): la
  // integridad la garantiza el repo, no un constraint circular.
  generationId: text('generation_id'),
  ...timestamps,
});

export type Asset = typeof asset.$inferSelect;
export type NewAsset = typeof asset.$inferInsert;

// ── generation (§9.6, §12 l.520-527) — T4.1 ─────────────────────────────────────
//
// UNA invocación a un modelo de fal.ai. Es el registro CANÓNICO de una llamada de
// generación: se persiste la INTENCIÓN (`submitting`) ANTES del submit a fal, luego
// el `fal_request_id`/`status_url`/`response_url` que fal devuelve (`submitted`), y la
// máquina de estados del queue de fal (`in_queue`→`in_progress`→`completed`/`failed`).
// Persistir-primero hace el hueco reconciliable: un crash entre "llamé a fal" y "lo
// apunté" deja un job facturándose en fal SIN rastro nuestro — y eso es justo lo que
// T4.3 (poller/sweeper) reconcilia leyendo la `status_url` guardada aquí.
export const generationStatus = pgEnum('generation_status', [
  'submitting',
  'submitted',
  'in_queue',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
]);

export const generation = pgTable(
  'generation',
  {
    id: ulidPk(),
    // Refs al pipeline (§12 l.520-521). TODAS nullable salvo `model_profile_id`: en T4.1
    // la generación se crea directa (smoke/live/verifier) sin run ni variante; el cableado
    // al DAG (step_run_id/variant_id poblados) llega en T4.11. Sin FK de columna a
    // step_run/variant por el mismo motivo de desacoplo que asset.generation_id.
    stepRunId: text('step_run_id'),
    variantId: text('variant_id'),
    // El modelo que se invoca. NOT NULL: no hay generación sin modelo. Es la clave que
    // ata la generación al catálogo `model_profile` (§13.1).
    modelProfileId: text('model_profile_id').notNull(),
    promptTemplateId: text('prompt_template_id'),
    templateVersion: integer('template_version'),
    // El id de la request en el queue de fal — UNIQUE (§9.6): la idempotencia de T4.3 se
    // ancla aquí (un webhook/poll re-entrante encuentra la fila por este id y hace no-op).
    // Nullable mientras el estado es `submitting` (aún no se ha llamado a fal).
    falRequestId: text('fal_request_id'),
    // Las URLs que fal DEVUELVE en el submit (§6.3.3): se GUARDAN y se usan tal cual para
    // polling/result, NUNCA se reconstruyen (el bug del OSS de referencia: submit a un
    // modelo, poll a otro por asumir el formato de la URL).
    statusUrl: text('status_url'),
    responseUrl: text('response_url'),
    // El prompt YA resuelto que se mandó (§12 l.523): entrada del content_hash.
    resolvedPrompt: text('resolved_prompt'),
    // Los inputs de la generación (imágenes de ref, params). jsonb OPACO; entrada del
    // content_hash. Default `{}`.
    inputs: jsonb('inputs').notNull().default({}),
    // DEDUPE §9.6: hash determinista de (resolved_prompt, model_profile_id, inputs). Dos
    // generaciones con el mismo hash producen el mismo output → se puede reutilizar. La
    // lógica de dedup COMPLETA (reutilizar el asset de una generación idéntica previa) es
    // deuda de F4/F5; T4.1 deja la columna y el cálculo del hash.
    contentHash: text('content_hash'),
    status: generationStatus('status').notNull().default('submitting'),
    // El último payload de status/result que fal devolvió (§12 l.524): evidencia cruda para
    // depurar y para que T4.3 reconcilie sin volver a llamar. jsonb.
    falStatusPayload: jsonb('fal_status_payload'),
    // QA (§12 l.525) y score (§12 l.526): los rellena el QA de F4/F5. Nullable aquí.
    qa: jsonb('qa'),
    score: real('score'),
    // El coste REAL en céntimos (se cruza con el `cost_entry` que el servicio escribe).
    costActual: integer('cost_actual'),
    durationS: real('duration_s'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // §9.6: `fal_request_id` es UNIQUE — es la clave de idempotencia que T4.3 usa para
    // que un poll/webhook re-entrante encuentre la fila y haga no-op. Índice UNIQUE (no
    // constraint de columna) porque la columna es NULLABLE mientras el estado es
    // `submitting`: Postgres permite múltiples NULLs en un índice UNIQUE, así que varias
    // filas `submitting` conviven sin colisionar y la unicidad solo muerde una vez que fal
    // devuelve el id.
    uniqueIndex('generation_fal_request_id_key').on(t.falRequestId),
  ],
);

export type Generation = typeof generation.$inferSelect;
export type NewGeneration = typeof generation.$inferInsert;
