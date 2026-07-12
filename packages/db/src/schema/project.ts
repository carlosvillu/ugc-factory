// Dominio `project` (§12, db.md §1: este fichero agrupa `project`, `brand_kit`,
// `url_analysis` y `product_brief`). En T0.3 solo `project`; el análisis
// (brand_kit, url_analysis, product_brief) se añade en T1.2, aquí mismo.
import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { asset } from './generation';
import { timestamps, ulidPk } from './columns.helpers';

// §12 exige enum nativo para `project.status` pero NO enumera valores. Enum
// mínimo sensato (decisión T0.3, anotada): un proyecto está `active` mientras se
// trabaja o `archived` cuando se retira sin borrarlo. Añadir un valor futuro es
// un `ALTER TYPE … ADD VALUE` trivial (db.md §1); por eso se empieza corto y no
// se sobre-diseña.
export const projectStatus = pgEnum('project_status', ['active', 'archived']);

export const project = pgTable('project', {
  id: ulidPk(),
  name: text('name').notNull(),
  // Locale por defecto de los guiones/briefs del proyecto. La plataforma es
  // ES-first (PRD): default 'es', aplicado por la BD.
  defaultLocale: text('default_locale').notNull().default('es'),
  status: projectStatus('status').notNull().default('active'),
  notes: text('notes'), // opcional (§12): nullable, sin default.
  ...timestamps,
});

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;

// ── Análisis (T1.2, §12): url_analysis → product_brief, y brand_kit ──────────
//
// Enums nativos con los valores LITERALES de §12 (db.md §1: el enum es parte del
// contrato de la tabla). OJO: hay DOS enums `source` distintos — el de
// `url_analysis` (url|manual) y el de `brand_kit` (extracted|manual); nombres
// distintos para no colisionar en pg.

// `url_analysis.source`: el análisis nace de una URL scrapeada o de entrada manual.
export const urlAnalysisSource = pgEnum('url_analysis_source', ['url', 'manual']);

// `url_analysis.platform`: MISMO conjunto que `PlatformSchema` de T1.1
// (@ugc/core product-brief.ts) — el detector de plataforma del scraping.
export const urlAnalysisPlatform = pgEnum('url_analysis_platform', [
  'shopify',
  'woocommerce',
  'custom',
  'amazon',
  'manual',
]);

// `url_analysis.status`: ciclo de vida del análisis (§12).
export const urlAnalysisStatus = pgEnum('url_analysis_status', [
  'pending',
  'scraping',
  'analyzing',
  'done',
  'failed',
]);

// `product_brief.status`: borrador hasta que el usuario lo aprueba (§12).
export const productBriefStatus = pgEnum('product_brief_status', ['draft', 'approved']);

// `brand_kit.source`: el kit se extrae del sitio scrapeado o se define a mano (§12).
export const brandKitSource = pgEnum('brand_kit_source', ['extracted', 'manual']);

export const urlAnalysis = pgTable(
  'url_analysis',
  {
    id: ulidPk(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    source: urlAnalysisSource('source').notNull(),
    // Nullable: en modo manual no hay URL que normalizar (§12).
    urlNormalized: text('url_normalized'),
    // Hash del contenido scrapeado para dedupe/caché del fast-path (T1.3); nullable
    // hasta que hay contenido.
    contentHash: text('content_hash'),
    platform: urlAnalysisPlatform('platform').notNull(),
    // Contenido crudo del scraping (RawContent de T1.1); jsonb opaco en la BD. §12
    // lo marca sin `?` ⇒ NOT NULL: una fila de url_analysis se crea con su contenido
    // (el fast-path de T1.3 escribe raw_content al persistir el análisis).
    rawContent: jsonb('raw_content').notNull(),
    status: urlAnalysisStatus('status').notNull().default('pending'),
    // Avisos del scraping/síntesis (p. ej. campos faltantes); jsonb opaco. §12 sin
    // `?` ⇒ NOT NULL; default `[]` para el caso sin avisos (lista vacía, no null).
    warnings: jsonb('warnings')
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (t) => [
    // UNIQUE PARCIAL de la caché del intake MANUAL (T1.6, §7.4): un único análisis
    // manual por (project_id, content_hash). Es la BARRERA estructural de la carrera
    // lookup-then-insert (dos requests concurrentes con el mismo texto NO pueden crear
    // dos filas: la segunda choca 23505 → ON CONFLICT DO NOTHING → re-SELECT → reuse).
    // PARCIAL sobre `source='manual'`: los análisis de URL (T1.3+) NO entran en esta
    // dedupe (su clave de caché es url_normalizada+hash, otra tarea). Mismo patrón que
    // `brand_kit_domain_key` de T1.2. Seguro sobre datos previos: prod vacía y las BD
    // de test son clones efímeros del template migrado.
    uniqueIndex('url_analysis_manual_cache_key')
      .on(t.projectId, t.contentHash)
      .where(sql`${t.source} = 'manual'`),
  ],
);

export const productBrief = pgTable(
  'product_brief',
  {
    id: ulidPk(),
    urlAnalysisId: text('url_analysis_id')
      .notNull()
      .references(() => urlAnalysis.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    // El ProductBrief del Apéndice A (contrato Zod de T1.1). La columna es jsonb
    // OPACO: la validación del shape es Zod en la capa de aplicación (T1.1), NO en
    // la BD — sin CHECK del shape (guarda de alcance del brief).
    data: jsonb('data').notNull(),
    editedByUser: boolean('edited_by_user').notNull().default(false),
    language: text('language').notNull(),
    status: productBriefStatus('status').notNull().default('draft'),
    // T1.10b — EL STEP QUE PRODUJO ESTA VERSIÓN, o NULL si no la produjo un step (el
    // PATCH standalone edita el brief FUERA de un run: ahí NULL es la verdad, no un
    // hueco). Es la CLAVE DE IDEMPOTENCIA de N3, y existe por una razón de DINERO:
    // véase el UNIQUE parcial de abajo.
    //
    // Sin FK a `step_run`: `step_run` se borra en cascada con el run (§12), y perder el
    // run NO debe borrar el brief — el brief es del PRODUCTO, no del run que lo generó
    // (el PATCH standalone lo edita cuando ya no hay ningún run vivo). La FK convertiría
    // el linaje en una correa.
    originStepRunId: text('origin_step_run_id'),
    ...timestamps,
  },
  (t) => [
    // BARRERA ESTRUCTURAL del versionado (T1.10b): `version` es un contador POR
    // `url_analysis_id` (v1 = brief de la IA que escribe N3; v2 = editado en CP1;
    // v3+ = ediciones standalone vía PATCH /api/briefs/:id). El bump lo SERIALIZA un
    // advisory lock por análisis (`createBriefVersion`, brief.repo.ts) y este UNIQUE es
    // la barrera ESTRUCTURAL que lo respalda: el lock da la SECUENCIA, el UNIQUE la
    // IMPOSIBILIDAD del duplicado — aunque alguien inserte por otro camino (una
    // migración, un script, un repo futuro que olvide el lock), la BD no admitirá dos
    // "brief actual" con el mismo número. Mismo patrón que `url_analysis_manual_cache_key`.
    uniqueIndex('product_brief_analysis_version_key').on(t.urlAnalysisId, t.version),
    // BARRERA ESTRUCTURAL DE DINERO (T1.10b): UN SOLO brief por step_run.
    //
    // N3 paga ~$0,20 de Sonnet 5 y DESPUÉS inserta esta fila. Si el INSERT falla por algo
    // TRANSITORIO (deadlock, timeout, conexión caída tras el commit), el step va a
    // `failStep` → retry → N3 se re-ejecuta ENTERO y VUELVE A PAGAR, y además deja OTRA
    // fila (v2, v3…) de "briefs de la IA" que el usuario nunca pidió. Por eso N3 es
    // IDEMPOTENTE POR ENTRADA: antes de llamar a Anthropic busca su propio brief por este
    // `origin_step_run_id` (un retry conserva el `step_run.id`: `failStep` reusa la fila y
    // solo incrementa `retry_count`) y, si ya existe, lo REUSA sin pasar por caja.
    //
    // Este índice es la barrera que hace de esa idempotencia una IMPOSIBILIDAD y no una
    // convención: aunque dos entregas concurrentes del mismo job se colasen entre el SELECT
    // y el INSERT, la segunda choca 23505 y el brief duplicado NO existe. PARCIAL (`where
    // origin_step_run_id is not null`) porque las ediciones humanas —CP1 y el PATCH
    // standalone— comparten `NULL` y deben poder ser muchas: la unicidad es del brief que
    // produce la MÁQUINA, que es el único que cuesta dinero.
    uniqueIndex('product_brief_origin_step_key')
      .on(t.originStepRunId)
      .where(sql`${t.originStepRunId} is not null`),
  ],
);

export const brandKit = pgTable(
  'brand_kit',
  {
    id: ulidPk(),
    // Nullable (§12): un brand_kit manual puede no colgar de un proyecto todavía.
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    // Nullable: modo manual sin dominio. El UNIQUE es PARCIAL (índice de abajo):
    // N filas con domain NULL conviven, pero un dominio scrapeado es único.
    domain: text('domain'),
    source: brandKitSource('source').notNull(),
    // FK a asset (T0.5): el logo del kit. Nullable (`?` en §12); `set null` para no
    // perder el kit si el asset se borra.
    logoAssetId: text('logo_asset_id').references(() => asset.id, { onDelete: 'set null' }),
    // §12: `palette jsonb`, `tone_of_voice`, `aesthetic`, `extracted_at` SIN `?`
    // ⇒ NOT NULL (solo `project_id?`, `domain?`, `logo_asset_id?`, `typography?`
    // llevan `?`). El kit se materializa completo (extraído o manual).
    palette: jsonb('palette').notNull(),
    typography: text('typography'), // `?` en §12 ⇒ nullable
    toneOfVoice: text('tone_of_voice').notNull(),
    aesthetic: text('aesthetic').notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    // UNIQUE PARCIAL (db.md §8, T1.2): un BrandKit por dominio scrapeado, pero N
    // filas manuales sin dominio (NULL no colisiona). Patrón `step_run_sweep_idx`.
    uniqueIndex('brand_kit_domain_key')
      .on(t.domain)
      .where(sql`${t.domain} IS NOT NULL`),
  ],
);

export type UrlAnalysis = typeof urlAnalysis.$inferSelect;
export type NewUrlAnalysis = typeof urlAnalysis.$inferInsert;
export type ProductBrief = typeof productBrief.$inferSelect;
export type NewProductBrief = typeof productBrief.$inferInsert;
export type BrandKit = typeof brandKit.$inferSelect;
export type NewBrandKit = typeof brandKit.$inferInsert;
