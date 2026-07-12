// Dominio `batch` (§12 «Lote y variantes», db.md §1): `ad_batch`, `ad_variant`,
// `ad_script`. Nace en T2.1 (F2, estrategia y guiones). Las tablas existen aquí y
// sus consumidores llegan después: el compositor de matriz (T2.2) planifica las
// variantes, CP2 (T2.3) las CREA en `planned`, el ScriptWriter (T2.4) escribe las
// `ad_script` y mueve la variante a `scripted`.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { timestamps, ulidPk } from './columns.helpers';
import { asset } from './generation';
import { adObjective, hookLine, persona, recipeTier } from './gallery';
import { project, productBrief } from './project';

// §12: `ad_batch … tier ENUM(test|standard|premium)`. Es EL MISMO conjunto que la PK
// de `recipe` (Apéndice B: una receta POR tier), así que reutiliza el enum nativo
// `recipe_tier` en vez de declarar un gemelo `ad_batch_tier` que podría divergir.

// §12 exige enum nativo para `ad_batch.status` pero NO enumera valores (igual que
// pasó con `project.status` en T0.3). Enum mínimo sensato (decisión T2.1, anotada):
// un lote está `planned` mientras se compone/aprueba la matriz (CP2), `running`
// mientras sus variantes se generan, y termina `completed` o `cancelled`. Añadir un
// valor es un `ALTER TYPE … ADD VALUE` trivial (db.md §1); no se sobre-diseña un
// ciclo de vida que ninguna tarea consume todavía.
export const adBatchStatus = pgEnum('ad_batch_status', [
  'planned',
  'running',
  'completed',
  'cancelled',
]);

// §12 LITERAL, y la razón de ser de esta tarea: el enum de `ad_variant.status` ya
// incluye `scripted` TRAS `planned` en el PRD (`planned|scripting|scripted|generating|
// composing|qa|approved|rejected|published`) — la "alineación anotada en PRD §12" que
// pide el planning YA ESTÁ en el PRD; aquí se copia VERBATIM. NO reordenar ni renombrar
// (db.md §1: quitar/renombrar un valor de un pgEnum es migración manual delicada).
export const adVariantStatus = pgEnum('ad_variant_status', [
  'planned',
  'scripting',
  'scripted',
  'generating',
  'composing',
  'qa',
  'approved',
  'rejected',
  'published',
]);

export const adBatch = pgTable(
  'ad_batch',
  {
    id: ulidPk(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    // El brief del que sale la matriz. `cascade`: sin brief no hay lote que interpretar
    // (el brief es la entrada del compositor de T2.2), y el brief solo se borra si se
    // borra su análisis, que solo se borra si se borra el proyecto.
    briefId: text('brief_id')
      .notNull()
      .references(() => productBrief.id, { onDelete: 'cascade' }),
    // §12: `matrix jsonb (ángulos×hooks×personas×duraciones×idiomas)` — el BatchPlan
    // que compone T2.2. jsonb OPACO: su shape lo valida el contrato Zod de core.
    matrix: jsonb('matrix').notNull(),
    tier: recipeTier('tier').notNull(),
    platforms: text('platforms')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    objective: adObjective('objective').notNull(),
    languages: text('languages')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: adBatchStatus('status').notNull().default('planned'),
    // Dinero en CÉNTIMOS ENTEROS (misma convención que `cost_entry.amount_cents` y
    // `recipe.est_cost_30s_*_cents`; ver nota en ops.ts). `cost_estimated` lo escribe el
    // estimador de T2.2 al confirmar CP2; `cost_actual` lo acumula el pipeline.
    costEstimatedCents: integer('cost_estimated_cents'),
    costActualCents: integer('cost_actual_cents'),
    ...timestamps,
  },
  (t) => [
    // La lista de lotes de un proyecto (la pantalla de lotes de F2/F5).
    index('ad_batch_project_id_idx').on(t.projectId),
  ],
);

export type AdBatch = typeof adBatch.$inferSelect;
export type NewAdBatch = typeof adBatch.$inferInsert;

export const adVariant = pgTable(
  'ad_variant',
  {
    id: ulidPk(),
    batchId: text('batch_id')
      .notNull()
      .references(() => adBatch.id, { onDelete: 'cascade' }),
    angleName: text('angle_name').notNull(),
    framework: text('framework').notNull(),
    // FK NULLABLE a la librería (§12 lo marca `hook_line_id?`): el hook de una variante
    // puede venir de la LIBRERÍA (T2.1) o del BRIEF (los `hook_examples` de un ángulo),
    // y en ese segundo caso no hay fila que referenciar. `set null`: purgar una línea de
    // la librería no puede borrar los anuncios que se hicieron con ella.
    hookLineId: text('hook_line_id').references(() => hookLine.id, { onDelete: 'set null' }),
    // `persona_id`: DEUDA DE T2.1 SALDADA EN T2.0. En T2.1 esto era texto nullable SIN FK
    // porque la tabla `persona` aún no existía. T2.0 la crea → aquí llega su FK REAL.
    //
    // `set null` (y no `cascade`) es una decisión de PRODUCTO, no un default: **borrar una
    // persona no puede borrar los anuncios que ya hizo**. Una variante generada, compuesta y
    // publicada sigue existiendo (y sus métricas siguen contando) aunque el usuario retire de
    // la librería la persona que la protagonizó; lo que se pierde es el puntero, no el anuncio.
    // Sigue nullable: una variante puede no tener persona asignada (§12 la marca sin `?`, pero
    // el compositor de T2.2 puede planificar sin fijar persona — el usuario «puede fijar o
    // dejar que rote», §11).
    personaId: text('persona_id').references(() => persona.id, { onDelete: 'set null' }),
    language: text('language').notNull(),
    // Receta reproducible (§12): `prompt_template` es F3 (T3.1) — mismo trato que
    // `persona_id`: texto nullable sin FK hasta que la tabla exista.
    promptTemplateId: text('prompt_template_id'),
    templateVersion: integer('template_version'),
    // Duración objetivo en SEGUNDOS (los presets de §8.4: 15/30/45).
    durationTarget: integer('duration_target').notNull(),
    platformTargets: text('platform_targets')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // El plan de composición FFmpeg (§9.7). jsonb opaco; nullable hasta que N7 lo escribe.
    compositionSpec: jsonb('composition_spec'),
    // §12: `filename_code UNIQUE`. El código legible del fichero final
    // (p. ej. `acme-pain-hook02-es-30s`) — la Verificación de T2.3 exige que sea único y
    // legible. UNIQUE GLOBAL (no por lote): el código viaja con el fichero exportado,
    // fuera de toda BD, y ahí no hay lote que lo desambigüe.
    filenameCode: text('filename_code').notNull().unique(),
    status: adVariantStatus('status').notNull().default('planned'),
    // Assets finales (F5). `set null`: borrar el asset no borra la variante.
    masterAssetId: text('master_asset_id').references(() => asset.id, { onDelete: 'set null' }),
    thumbnailAssetId: text('thumbnail_asset_id').references(() => asset.id, {
      onDelete: 'set null',
    }),
    qaReport: jsonb('qa_report'),
    // §12: `score?` — la puntuación de QA (F5). Entero (0–100), nullable.
    score: integer('score'),
    ...timestamps,
  },
  (t) => [
    // La query caliente: todas las variantes de un lote (el canvas de CP2/CP3 y la
    // pantalla del lote las listan juntas).
    index('ad_variant_batch_id_idx').on(t.batchId),
  ],
);

export type AdVariant = typeof adVariant.$inferSelect;
export type NewAdVariant = typeof adVariant.$inferInsert;

export const adScript = pgTable(
  'ad_script',
  {
    id: ulidPk(),
    variantId: text('variant_id')
      .notNull()
      .references(() => adVariant.id, { onDelete: 'cascade' }),
    // Versionado igual que `product_brief` (T1.10b): v1 = guion de la IA (N5), v2+ =
    // ediciones del usuario en CP3. El UNIQUE de abajo es la barrera estructural.
    version: integer('version').notNull().default(1),
    hook: text('hook').notNull(),
    // §12: `scenes jsonb[]`, `subtitles jsonb[]`. Se persisten como UN jsonb que
    // CONTIENE el array (no como `jsonb[]` de Postgres): el shape lo valida Zod en core
    // y un array-de-jsonb nativo solo añade fricción de driver sin comprar nada.
    scenes: jsonb('scenes').notNull(),
    subtitles: jsonb('subtitles').notNull(),
    cta: text('cta').notNull(),
    fullText: text('full_text').notNull(),
    wordCount: integer('word_count').notNull(),
    // Duración estimada del guion en segundos (§7.2 N5: `word_count ÷ 2.5`). Entero:
    // la regla de timing produce segundos; el redondeo lo hace el ScriptWriter (T2.4).
    estSeconds: integer('est_seconds').notNull(),
    tone: text('tone').notNull(),
    language: text('language').notNull(),
    editedByUser: boolean('edited_by_user').notNull().default(false),
    // §12: `guardrail_flags jsonb` — lo que el linter FTC de T2.5 marca sobre el guion.
    // Nullable: un guion aún no linteado no tiene flags (≠ lista vacía = linteado y limpio).
    guardrailFlags: jsonb('guardrail_flags'),
    ...timestamps,
  },
  (t) => [uniqueIndex('ad_script_variant_version_key').on(t.variantId, t.version)],
);

export type AdScript = typeof adScript.$inferSelect;
export type NewAdScript = typeof adScript.$inferInsert;
