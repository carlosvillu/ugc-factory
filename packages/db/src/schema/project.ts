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

export const urlAnalysis = pgTable('url_analysis', {
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
});

export const productBrief = pgTable('product_brief', {
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
  ...timestamps,
});

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
