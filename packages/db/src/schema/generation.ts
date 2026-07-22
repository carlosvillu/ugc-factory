// Dominio `generation` (db.md §1: fichero `generation.ts` agrupa `generation` y
// `asset`). T0.5 trajo `asset` con el subset mínimo; T4.1 (§9.6) trae la tabla
// `generation` COMPLETA y las columnas de `asset` que la generación real necesita
// (`fal_url`/`fal_uploaded_at` — la caché de upload a fal storage; §9.6). Las
// columnas de composición (`word_timestamps`, `parent_asset_ids`,
// `normalized_cache_key`, §9.7) siguen sin anticiparse: llegan en F5 con su
// consumidor.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
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
  'cta_clip',
  'music_bed',
  'final_video',
  'thumbnail',
  'screenshot',
  'font',
  'other',
]);

export const asset = pgTable(
  'asset',
  {
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
    // ── T4.5 (§9.7, §12; N7b · TTS + word timestamps) ────────────────────────────
    // WORD-LEVEL TIMESTAMPS del voiceover (`kind='tts_audio'`). §13.1 fija la RUTA POR
    // DEFECTO: los timestamps NO vienen del TTS (kokoro/elevenlabs no los emiten
    // nativos — confirmado 2026-07-16 en el openapi de `fal-ai/kokoro`: el output es
    // solo `{audio:{url}}`), sino de un ASR encadenado (`fal-ai/elevenlabs/speech-to-text`)
    // sobre el audio TTS ya generado. El ASR devuelve JSON (no un fichero): por eso NO es
    // un asset propio — sus timestamps se SELLAN sobre ESTE mismo asset de audio (UPDATE de
    // esta columna). Los consume el generador ASS/subtítulos de F5. jsonb OPACO en la BD; su
    // shape lo valida `WordTimestampsSchema` de core (construido desde el output ASR REAL
    // capturado en vivo, disciplina anti-arnés). Nullable: un asset que no es voiceover, o un
    // voiceover cuyo ASR aún no corrió, no tiene timestamps (≠ `[]` = ASR corrió sin palabras).
    wordTimestamps: jsonb('word_timestamps'),
    // ── T5.2 (§9.7, §12 l.531-533; normalización canónica con caché) ─────────────
    // CACHÉ NORMALIZE-ONCE del render (§9.7). Un asset NORMALIZADO (vídeo 1080×1920/30fps/
    // H.264 con `-an`, o pista de audio AAC 48k estéreo) es su PROPIA fila `asset` —NO una
    // columna estampada sobre el origen—: su `checksum` es el sha256 de SUS bytes, y ESTA
    // columna es la CLAVE DE LOOKUP de la caché = derivación pura de `checksum-del-origen +
    // params de normalización` (w×h, fps, códec/CRF, autorotate, versión de receta;
    // `computeNormalizedCacheKey` en @ugc/services). El discriminador «es un normalizado» es
    // `normalized_cache_key IS NOT NULL`, NO el kind (un vídeo normalizado conserva
    // avatar_clip/broll_clip; la voz canónica es tts_audio) — por eso NO se añade un kind
    // `normalized` al enum. Nullable: la inmensa mayoría de assets (inputs, outputs crudos de
    // fal) no son normalizados. Un MISMO origen puede tener N normalizados (perfil por
    // plataforma / preset HQ de F8), uno por combinación asset×perfil → N filas con distinta
    // key: por eso el perfil ya entra en la key hoy, aunque solo se siembre el perfil canónico.
    normalizedCacheKey: text('normalized_cache_key'),
    // LINAJE (§12 l.531). Los ids de los assets ORIGEN de los que deriva este (para un
    // normalizado: `[assetOrigenId]`; para un futuro concat: los N segmentos). Default `{}`
    // (asset sin padres: inputs, outputs crudos). Se modela como `text[]` de ULIDs, gemelo de
    // `step_run.depends_on` — el cast `::text[]` del default es obligatorio (sin él el array
    // default se comporta mal en Drizzle).
    parentAssetIds: text('parent_asset_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    // ÍNDICE DE LA CACHÉ NORMALIZE-ONCE (§9.7, db.md §8): el worker busca por esta key
    // ANTES de re-normalizar (lookup-then-create). Índice NORMAL, NO único —
    // deliberadamente: la unicidad la garantiza el propio lookup-then-create del
    // normalizador (busca; si no hay, encoda y crea), no un constraint. En un mundo
    // concurrente dos encodes del MISMO origen×perfil podrían crear transitoriamente dos
    // filas con la misma key antes de que ninguno vea a la otra; un UNIQUE convertiría esa
    // carrera benigna (dos normalizados idénticos, uno huérfano) en un 23505 que aborta un
    // render — coste alto para impedir una duplicación barata y auto-corregible. El índice
    // solo acelera el lookup; la key es nullable, así que Postgres no indexa las filas
    // no-normalizadas de más (la inmensa mayoría) y el índice queda pequeño.
    index('asset_normalized_cache_key_idx')
      .on(t.normalizedCacheKey)
      .where(sql`${t.normalizedCacheKey} is not null`),
  ],
);

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
    // PROCEDENCIA del output (T4.4, N7a): `true` cuando el output es un PACKSHOT SINTÉTICO —
    // un shot del producto GENERADO por IA (ruta `ai_packshot` de N7a, sin fotos reales del
    // producto), no una foto real ni un frame de una foto hero. Downstream (N7d b-roll R2V,
    // fidelity guards de F4/F5) necesita distinguir "esta imagen de producto es inventada" de
    // "esta es el producto real" para decidir la fidelidad exigible. Es PROCEDENCIA, NO
    // dimensión de dedupe: por eso vive como columna de primera clase y NUNCA entra en
    // `content_hash.inputs` (meterlo ahí partiría el dedupe entre dos generaciones idénticas
    // que solo difieren en este flag). Se lee vía `asset.generation_id → generation`. Default
    // `false`: la inmensa mayoría de generaciones (Persona, avatar, b-roll de foto real) no
    // son packshots sintéticos.
    syntheticProduct: boolean('synthetic_product').notNull().default(false),
    // DISCRIMINADOR DE PRIMERA CLASE (T4.6, §8.3): `true` cuando esta generación es una MUESTRA DE
    // PREVIEW DE VOZ (el botón ▶ de CP2/CP3), no un voiceover de producción. Precedente
    // `synthetic_product` de T4.4: `generation` NO tiene columna `kind` propia, así que las
    // procedencias que necesitan gatear un ÍNDICE o una query se modelan como booleanos de primera
    // clase FUERA de `content_hash`. Aquí gatea la CACHÉ SCOPED de previews: el índice único parcial de
    // abajo impone unicidad de `content_hash` SOLO entre previews (lookup-then-insert atómico, patrón
    // `url_analysis`), sin tocar la unicidad GLOBAL de `content_hash` que T4.10 decide deliberadamente
    // (N7a/N7b/retries de producción NO esperan unicidad de hash). Así "5 reproducciones, 0 coste"
    // queda garantizado a nivel BD incluso con clicks concurrentes. Default `false`: la inmensa mayoría
    // de generaciones (imagen, voiceover de producción) no son previews.
    voicePreview: boolean('voice_preview').notNull().default(false),
    // DISCRIMINADOR DE PRIMERA CLASE (T4.12, «probar template»): `true` cuando esta generación es una
    // IMAGEN DE PRUEBA de un template disparada por el botón «Probar template» de la ficha, no una
    // generación de producción. Precedente EXACTO de `voice_preview` (T4.6): `generation` no tiene
    // columna `kind` propia, así que las procedencias que gatean un ÍNDICE o una query se modelan como
    // booleanos de primera clase FUERA de `content_hash`. Aquí gatea la CACHÉ SCOPED de pruebas: el
    // índice único parcial de abajo impone unicidad de `content_hash` SOLO entre pruebas (lookup-then-
    // insert atómico, patrón `voice_preview`), sin tocar la unicidad global de producción. Así «N
    // clicks de probar, 0 coste» queda garantizado a nivel BD incluso con clicks concurrentes.
    //
    // DISJUNCIÓN con el índice de producción (crítico, T4.10): una fila `template_test=true` lleva
    // `voice_preview=false`, así que SIN cuidado casaría también el predicado del índice de producción
    // (`voice_preview=false AND status NOT IN (failed,cancelled)`) → el 2º click chocaría 23505 contra
    // ESE índice (no el arbiter del ON CONFLICT de pruebas) → error no gestionado, no un no-op gracioso.
    // Por eso el predicado del índice de producción se AMPLÍA abajo con `template_test = false`, dejando
    // los tres índices parciales sobre `content_hash` mutuamente disjuntos. Default `false`: la inmensa
    // mayoría de generaciones (producción, previews de voz) no son pruebas de template.
    templateTest: boolean('template_test').notNull().default(false),
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
    // CACHÉ SCOPED DE PREVIEWS DE VOZ (T4.6): unicidad de `content_hash` SOLO entre las filas
    // `voice_preview=true`. Índice PARCIAL (el `WHERE`) — deliberadamente NO global: la unicidad
    // global de `content_hash` la decide T4.10, y N7a/N7b/retries de producción NO la esperan. El
    // `content_hash` de un preview lo determinan voz+modelo+idioma+texto de muestra fijo, así que dos
    // clicks del MISMO ▶ colisionan aquí y el `ON CONFLICT DO NOTHING` del repo hace que el segundo no
    // cree fila ni cost_entry (garantía "N plays, 0 coste" a nivel BD). `content_hash` es nullable,
    // pero un preview SIEMPRE lo pobla; Postgres permite múltiples NULLs en un índice único, así que
    // las generaciones no-preview (excluidas por el `WHERE`) y cualquier preview sin hash conviven.
    uniqueIndex('generation_voice_preview_content_hash_key')
      .on(t.contentHash)
      .where(sql`${t.voicePreview} = true`),
    // CACHÉ SCOPED DE PRUEBAS DE TEMPLATE (T4.12, «probar template»): unicidad de `content_hash` SOLO
    // entre las filas `template_test=true`. GEMELO del índice de previews de voz: índice PARCIAL,
    // deliberadamente NO global. El `content_hash` de una prueba lo determinan prompt-de-prueba + modelo
    // + inputs, así que dos clicks del MISMO «Probar template» colisionan aquí y el `ON CONFLICT DO
    // NOTHING` del repo hace que el segundo no cree fila ni cost_entry («N clicks, 0 coste» a nivel BD).
    // DISJUNTO del índice de producción (que ahora exige `template_test = false`) y del de previews
    // (`voice_preview = true` implica `template_test = false`): los tres arbiters eligen sin ambigüedad.
    uniqueIndex('generation_template_test_content_hash_key')
      .on(t.contentHash)
      .where(sql`${t.templateTest} = true`),
    // DEDUP GLOBAL DE PRODUCCIÓN (T4.10, §9.6): unicidad de `content_hash` entre las generaciones de
    // PRODUCCIÓN VIVAS-O-EXITOSAS — `voice_preview = false` AND status NOT IN ('failed','cancelled'). Es
    // la clave de la economía Hook×Body×CTA: un lote de 3 variantes del mismo ángulo comparte body/CTA,
    // así que sus generaciones colisionan aquí y el `ON CONFLICT DO NOTHING` del repo hace que solo UNA
    // submitee a fal (las demás reutilizan su asset — cero coste). La atomicidad vive en el INSERT de la
    // fila `submitting`, NO en la completion: dos generaciones idénticas concurrentes MISS del lookup y
    // ambas intentan insertar `submitting`; la segunda choca contra este índice y no crea fila (ni gasta).
    //
    // PREDICADO `status NOT IN ('failed','cancelled')`, NO `= 'completed'` NI global:
    //  · `= 'completed'` NO frenaría la carrera (dos `submitting` no están en el índice → ambas gastan) y
    //    ADEMÁS corrompería: la 2ª completion chocaría 23505, el catch la degradaría a `failed` — una
    //    generación que fal SÍ facturó quedaría registrada como fallo. Inaceptable (dinero + correctness).
    //  · global (todos los estados) ROMPERÍA los retries: una generación `failed` conserva su hash y
    //    bloquearía el `submitting` del reintento. Por eso `failed`/`cancelled` quedan FUERA del predicado
    //    (un retry de una fila terminal-fallida vuelve a insertar sin conflicto).
    // DISJUNTO de los índices de previews y de pruebas de template (`voice_preview = false AND
    // template_test = false` aquí vs `voice_preview = true` / `template_test = true` allí): los TRES
    // índices parciales sobre `content_hash` no se solapan, así que el arbiter del `ON CONFLICT` elige
    // sin ambigüedad (el `where` del repo DEBE ser el literal EXACTO de este predicado, ver
    // `insertProductionGenerationIfAbsent`; un parámetro `$1` da 42P10). El `template_test = false`
    // se AÑADIÓ en T4.12: sin él, una fila `template_test=true` (que lleva `voice_preview=false`)
    // casaría este índice y el 2º click de «probar template» chocaría 23505 contra ESTE índice en vez
    // de ser un no-op del arbiter de pruebas.
    uniqueIndex('generation_production_content_hash_key')
      .on(t.contentHash)
      .where(
        sql`${t.voicePreview} = false and ${t.templateTest} = false and ${t.status} not in ('failed', 'cancelled')`,
      ),
  ],
);

export type Generation = typeof generation.$inferSelect;
export type NewGeneration = typeof generation.$inferInsert;
