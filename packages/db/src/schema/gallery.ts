// Dominio `gallery` (§12, db.md §1). El mapa de db.md §1 asigna a este fichero
// `prompt_template`, `prompt_version`, `guard_pack`, `hook_line`, `cta_line`,
// `persona`, `model_profile` y `recipe`. T2.1 trajo `hook_line`, `cta_line` y `recipe`
// (las librerías de copy y las recetas por tier); **T2.0 añade `persona`** (la librería de
// avatares, §11). El resto llega con sus tareas (galería = F3, model_profile = F3) — mismo
// criterio que `ops.ts`, que en T0.3 solo trajo dos de sus cuatro tablas.
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { timestamps, ulidPk } from './columns.helpers';

// ── hook_line / cta_line (§12) ──────────────────────────────────────────────
//
// §12: `hook_line id, angle, text (interpolable), verticals text[], language, perf jsonb`
//      `cta_line  id, objective, text, language, perf jsonb`
//
// Son la LIBRERÍA CURADA de copy (la siembra T2.1, la consume el compositor de
// matriz de T2.2 como fuente alternativa a los hooks del brief). `text` es
// INTERPOLABLE: lleva placeholders `{product}`, `{benefit}`, `{pain}`… que el
// ScriptWriter (T2.4) resuelve con datos del brief.
//
// `language` es text (no enum): el seed cubre es+en (§17), pero añadir un idioma
// es "añadir voces al voice_map + traducir las librerías" (§17) — un `ALTER TYPE`
// por idioma sería fricción gratuita en una columna que NO gobierna una máquina de
// estados. Mismo criterio que `project.default_locale`.

export const hookLine = pgTable(
  'hook_line',
  {
    id: ulidPk(),
    // El ÁNGULO al que sirve el hook (pain-point, social-proof, curiosity…). NOT NULL:
    // un hook sin ángulo no es seleccionable por el compositor de matriz (que elige
    // hooks POR ángulo) — y es justo el caso que el validador de seeds rechaza.
    angle: text('angle').notNull(),
    text: text('text').notNull(),
    // Verticales para las que el hook es apropiado (beauty, fitness, saas…). Array
    // VACÍO = agnóstico de vertical (la mayoría de la librería seed). Default `{}`.
    verticals: text('verticals')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    language: text('language').notNull(),
    // Rendimiento observado (CTR/hold-rate por hook, F7). Nullable: la librería
    // sembrada nace sin historial.
    perf: jsonb('perf'),
    ...timestamps,
  },
  (t) => [
    // IDEMPOTENCIA DEL SEED: `pnpm seed` se ejecuta N veces (el verifier lo corre, el
    // arranque lo puede correr) y NO puede duplicar la librería. Las PKs son ULIDs
    // (nuevas en cada corrida), así que la identidad natural de una línea de copy es
    // (idioma, texto): el seed inserta con ON CONFLICT DO UPDATE contra este UNIQUE, y
    // refresca los METADATOS de la línea (ángulo, verticales…) sin tocar jamás `perf` —
    // el seed es la fuente de verdad de lo que la línea ES; la BD, de cómo le ha IDO.
    // Es además la invariante de producto correcta: dos hooks idénticos en el mismo
    // idioma son la misma línea, aunque los catalogues bajo ángulos distintos.
    uniqueIndex('hook_line_language_text_key').on(t.language, t.text),
    // El compositor de matriz (T2.2) pide "hooks del ángulo X en el idioma Y": es la
    // única query caliente de esta tabla.
    index('hook_line_angle_language_idx').on(t.angle, t.language),
  ],
);

export type HookLine = typeof hookLine.$inferSelect;
export type NewHookLine = typeof hookLine.$inferInsert;

// `cta_line.objective`: los mismos valores que el objetivo del lote (§12:
// `ad_batch.objective ENUM(hook_test|conversion|story)`) — una CTA se elige POR
// objetivo del lote. Enum nativo compartido: declarado con `ad_batch` (abajo) y
// reutilizado aquí, para que no puedan divergir.

export const adObjective = pgEnum('ad_objective', ['hook_test', 'conversion', 'story']);

export const ctaLine = pgTable(
  'cta_line',
  {
    id: ulidPk(),
    objective: adObjective('objective').notNull(),
    text: text('text').notNull(),
    language: text('language').notNull(),
    perf: jsonb('perf'),
    ...timestamps,
  },
  (t) => [
    // Misma idempotencia de seed que hook_line (ver arriba).
    uniqueIndex('cta_line_language_text_key').on(t.language, t.text),
    index('cta_line_objective_language_idx').on(t.objective, t.language),
  ],
);

export type CtaLine = typeof ctaLine.$inferSelect;
export type NewCtaLine = typeof ctaLine.$inferInsert;

// ── recipe (§12, Apéndice B) ────────────────────────────────────────────────
//
// §12: `recipe id (test|standard|premium), steps jsonb (nodo→model_profile_id+params),
//       est_cost_30s, notes`
//
// LA PK ES EL TIER, no un ULID: §12 lo dice literal (`id (test|standard|premium)`).
// Hay exactamente TRES recetas y su identidad ES su nombre — igual que
// `app_setting.key` (T0.3), la clave natural es la PK. Consecuencia práctica: el
// seed upsertea por PK (`ON CONFLICT (id) DO UPDATE`) y es idempotente por
// construcción; y T3.4 ("recalibra las `recipe` sembradas en T2.1") reescribe las
// MISMAS tres filas, sin duplicar.
export const recipeTier = pgEnum('recipe_tier', ['test', 'standard', 'premium']);

// EL COSTE ES UN RANGO, NO UN PUNTO — y se guarda en CÉNTIMOS ENTEROS.
//
// DIVERGENCIA DELIBERADA DE §12 (anotada por regla de trabajo 6, mismo patrón que
// `cost_entry.amount_usd` → `amount_cents` en ops.ts):
//   §12 nombra UNA columna `est_cost_30s`; aquí son DOS —
//   `est_cost_30s_min_cents` / `est_cost_30s_max_cents`.
//
// Por qué DOS y no una:
//   - El Apéndice B (y §16.1, que coincide) NO da un número: da un RANGO por tier
//     (Test $0,3–1,7 · Standard $1,8–5 · Premium $9–13). El rango no es imprecisión:
//     es la horquilla real según qué modelos toca la receta y cuánto b-roll lleva.
//   - El CONSUMIDOR es T2.2 (el estimador de coste), que debe enseñar el coste ANTES
//     de gastar y cuya Verificación exige cuadrar con el Apéndice B ±10 %. Con un
//     punto medio, el "±10 %" se mediría contra un número que el Apéndice B no dice
//     — y el usuario perdería la horquilla (que es información honesta: "esto te
//     costará entre X e Y"). Del rango SIEMPRE puedes derivar el punto medio; del
//     punto medio NO puedes recuperar el rango. Se guarda lo más informativo.
//
// Por qué CÉNTIMOS ENTEROS: todo el dinero del proyecto lo es (`cost_entry.amount_cents`,
// `budget.limit_cents`, `step_run.cost_estimated`, el contrato SSE). $0,3 → 30 céntimos;
// $1,7 → 170. Un float aquí rompería la suma exacta del estimador de T2.2 (30 variantes
// × 0.3 en float ya no es 9.00) y desalinearía esta tabla del resto del sistema.
export const recipe = pgTable('recipe', {
  // La PK es el tier (§12). El enum nativo hace IMPOSIBLE una cuarta receta fantasma.
  id: recipeTier('id').primaryKey(),
  // `steps`: nodo → { modelProfileId, params } (§12). jsonb OPACO en la BD; su shape
  // lo valida el contrato Zod de core (RecipeSeedSchema), no un CHECK.
  // `model_profile` no existe como tabla hasta F3: los ids de modelo del seed son las
  // etiquetas del Apéndice B (p. ej. "veed/avatars"), y T3.4 las recableará a
  // `model_profile_id` reales cuando recalibre. Sin FK a una tabla que no existe.
  steps: jsonb('steps').notNull(),
  estCost30sMinCents: integer('est_cost_30s_min_cents').notNull(),
  estCost30sMaxCents: integer('est_cost_30s_max_cents').notNull(),
  notes: text('notes'),
  ...timestamps,
});

export type Recipe = typeof recipe.$inferSelect;
export type NewRecipe = typeof recipe.$inferInsert;

// ── persona (§11 + §12) ─────────────────────────────────────────────────────
//
// §12: `persona (campos de §11) + voice_map jsonb {locale: {provider, voiceId}}`
// §11: nombre, demografía (rango de edad, género, etnia, estilo), personalidad (se inyecta
//      en el CASTING del prompt), `referenceImages[]` ≥2K (identity lock), `voice_map` por
//      idioma Y PROVEEDOR, wardrobeNotes, notas de rendimiento (`PerfStats`).
//
// Una persona es un avatar SINTÉTICO (D10: sin caras reales) reutilizable entre lotes. El
// contrato Zod público (lo que valida la API y consume el formulario) vive en
// `@ugc/core/persona`; esto es solo el shape de persistencia.

// El género se inyecta en el casting del prompt: su vocabulario es CONTRATO del prompt, no
// texto libre → enum nativo (espejo de `PersonaGenderSchema` en core).
export const personaGender = pgEnum('persona_gender', ['female', 'male', 'non_binary']);

export const persona = pgTable(
  'persona',
  {
    id: ulidPk(),
    // CLAVE NATURAL (UNIQUE abajo): la identidad de una persona es su nombre. Es lo que hace
    // IDEMPOTENTE el seed (mismo criterio que `(language, text)` en hook_line): `pnpm seed` se
    // corre N veces y no puede duplicar «Lucía (placeholder)».
    name: text('name').notNull(),

    // ── Demografía (§11) ────────────────────────────────────────────────────
    // `age_range` (NO una edad): §11 dice «rango de edad» y —clave— es EXACTAMENTE el
    // placeholder `{persona.age_range}` del contrato de variables de §10.4, que T2.4 resuelve
    // SIN traducir. Formato `NN-NN`, validado por Zod en la frontera.
    ageRange: text('age_range').notNull(),
    gender: personaGender('gender').notNull(),
    ethnicity: text('ethnicity').notNull(),
    style: text('style').notNull(),

    // ── Los otros dos placeholders de §10.4 ─────────────────────────────────
    // DIVERGENCIA DELIBERADA DE §11 (anotada; regla de trabajo 6): §11 no nombra `descriptor`
    // ni `setting`, pero §10.4 declara `{persona.descriptor}` y `{persona.setting}` como
    // variables canónicas del contrato de templates «← Persona». Se crean como COLUMNAS de
    // primera clase precisamente para que T2.4 pueda resolverlas sin inventárselas ni
    // derivarlas a ojo de un texto libre. La alternativa (concatenar demografía) produciría
    // prompts robóticos: el descriptor es REDACCIÓN («mujer de 29 años, latina, look casual»).
    descriptor: text('descriptor').notNull(),
    // El escenario cotidiano por defecto (§10.3 punto 3: «escenario cotidiano con 2–3 anclas»).
    setting: text('setting').notNull(),

    // Personalidad (§11): «se inyecta en el casting del prompt».
    personality: text('personality').notNull(),
    // Continuidad de vestuario entre CUTs (§11 + «wardrobe continuity declarada por CUT»).
    // Nullable: una persona puede no fijar vestuario.
    wardrobeNotes: text('wardrobe_notes'),

    // §12 LITERAL: `voice_map jsonb {locale: {provider, voiceId}}`. jsonb (no tablas
    // normalizadas) por el mismo criterio que `ad_batch.matrix`: es un documento cuyo shape lo
    // valida Zod en la frontera (`VoiceMapSchema` en core), y añadir un idioma NO puede exigir
    // una migración (§17: «añadir un idioma es añadir voces al voice_map»). El PROVEEDOR viaja
    // con el voiceId porque «el voiceId solo es unívoco DENTRO de su proveedor» (§11).
    voiceMap: jsonb('voice_map')
      .notNull()
      .default(sql`'{}'::jsonb`),

    // `referenceImages[]` (§11): los ULIDs de las filas `asset` (kind `reference_image`) que
    // son el IDENTITY LOCK, EN ORDEN (el primero es el retrato principal — el grande del
    // mockup 6c). Array de texto y NO una tabla join ni FKs por elemento: son 2–3 imágenes en
    // una herramienta mono-usuario, y una tabla join añadiría superficie (orden explícito,
    // repo, migración) sin comprar nada que este producto necesite. Precedente en el propio
    // §12: `asset.parent_asset_ids`. El coste asumido —Postgres no garantiza la integridad
    // referencial de los elementos— se paga con el repo: borrar una persona borra sus assets
    // (misma tx) y el endpoint valida que el asset existe antes de añadirlo.
    referenceImageIds: text('reference_image_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // §11: «notas de rendimiento (`PerfStats`)». Nullable: una persona nueva no tiene historia.
    // Mismo trato que `hook_line.perf` — y por eso el seed NUNCA lo pisa (el seed es la fuente
    // de verdad de lo que la persona ES; la BD, de cómo le ha IDO).
    perf: jsonb('perf'),
    ...timestamps,
  },
  (t) => [
    // La clave natural que hace idempotente el seed (ver `name` arriba).
    uniqueIndex('persona_name_key').on(t.name),
  ],
);

export type Persona = typeof persona.$inferSelect;
export type NewPersona = typeof persona.$inferInsert;

// ── prompt_template (§10.1 + §12 l.537) ─────────────────────────────────────
//
// §12 l.537: `campos de §10.1; facetas como text[] + GIN index; head_version int;
//             perf jsonb, usage_count`
//
// La galería facetada de templates ESTRUCTURADOS (§10). El pipeline la consume
// programáticamente (por facetas) y el usuario la navega/edita visualmente.
//
// `kind` (video|image|script|voiceover, §10.1): el vocabulario es CONTRATO (gobierna
// qué compilador/modelo consume el template) → enum nativo.
export const promptKind = pgEnum('prompt_kind', ['video', 'image', 'script', 'voiceover']);

// Curación (§10.1): la máquina de estados de publicación de un template. `published`
// exige thumbnail (§10.2 regla 2) — invariante de producto que valida el endpoint, no
// un CHECK. Vocabulario CONTRATO → enum nativo.
export const promptStatus = pgEnum('prompt_status', ['draft', 'review', 'published', 'deprecated']);

export const promptTemplate = pgTable(
  'prompt_template',
  {
    id: ulidPk(),
    // CLAVE NATURAL (UNIQUE abajo): la identidad de un template es su slug legible
    // (`grwm-beauty-pain-point`). Idempotencia del seed versionado en git (§10.2 regla 1),
    // mismo criterio que `hook_line.(language, text)` y `persona.name`.
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    kind: promptKind('kind').notNull(),
    // `body` con slots `{namespace.field}` (§10.1). El template canónico es
    // MODEL-AGNOSTIC (§10.2 regla 4): lo específico del modelo vive en el promptAdapter
    // del model_profile, no aquí.
    body: text('body').notNull(),
    // `beats[]` estructurados (tStart, tEnd, action, dialogue, camera — §10.1). jsonb
    // OPACO en la BD; su shape lo valida el contrato Zod de core, no un CHECK.
    beats: jsonb('beats')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // `variables` (VariableSpec[]: nombre, tipo, required, source, enumValues?, example — §10.1).
    variables: jsonb('variables')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // `assetSlots` (@product/@character/@background/@style/@camera_motion/@audio, required — §10.1).
    assetSlots: jsonb('asset_slots')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // `guardPackIds[]` (§10.1): las guard packs componibles que el compilador inyecta.
    // Guarda las CLAVES semánticas (`guard.vertical.beauty`, ver guard_pack.key abajo), no
    // los ULIDs — la clave es estable y legible, lo que el seed versionado en git referencia.
    // Sin FK por elemento: mismo criterio que `persona.referenceImageIds` (§12 l.531
    // `asset.parent_asset_ids`) — 2–3 packs por template en una herramienta mono-usuario; el
    // endpoint valida que la key existe antes de añadirla.
    guardPackKeys: text('guard_pack_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // defaults (duración, aspect — §10.1). Nullable: un template de script/voiceover puede no
    // fijar duración/aspect de vídeo.
    defaultDurationS: integer('default_duration_s'),
    defaultAspect: text('default_aspect'),

    // ── Cinco facetas ortogonales (§10.1) como text[] + GIN (§12 l.537) ─────────
    // §12 lo fija LITERAL: "facetas como text[]". Arrays de texto (NO jsonb) precisamente
    // para que la búsqueda facetada por subconjuntos (`@>`/`&&`) las sirva con un GIN
    // `array_ops` (ver índices abajo). Array VACÍO = agnóstico de esa faceta. Default `{}`.
    formats: text('formats')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hookAngles: text('hook_angles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    verticals: text('verticals')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    platforms: text('platforms')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    aesthetics: text('aesthetics')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // `freeTags[]` (§10.1): tags libres, NO faceta ortogonal → sin GIN propio (no es una
    // dimensión de la búsqueda facetada; es metadato de texto libre).
    freeTags: text('free_tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // ── Curación / autoría (§10.1) ──────────────────────────────────────────
    status: promptStatus('status').notNull().default('draft'),
    featured: boolean('featured').notNull().default(false),
    license: text('license'),
    author: text('author'),
    attribution: text('attribution'),

    // `language` + `translations` (§10.1). `language` es text (no enum), mismo criterio que
    // `hook_line.language`: añadir un idioma no puede exigir un ALTER TYPE (§17).
    language: text('language').notNull(),
    // `translations` (§10.1): {locale: templateId} — los templates hermanos traducidos.
    translations: jsonb('translations')
      .notNull()
      .default(sql`'{}'::jsonb`),

    // `compliance` (testimonialStyle, requiresDisclosure, restrictedVerticals — §10.1). jsonb,
    // shape validado por Zod en la frontera.
    compliance: jsonb('compliance'),

    // `perf` jsonb (§12 l.538): stats de uso/performance agregadas del flywheel (F7).
    // Nullable: un template nuevo no tiene historia. Como en `hook_line.perf`, el seed
    // NUNCA lo pisa (el seed es la fuente de verdad de lo que el template ES).
    perf: jsonb('perf'),
    // `head_version int` (§12 l.537): la última versión publicada en `prompt_version`.
    // Arranca en 0 (aún sin versión materializada).
    headVersion: integer('head_version').notNull().default(0),
    // `usage_count int` (§12 l.537): cuántas generaciones han referenciado el template.
    usageCount: integer('usage_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    // Clave natural que hace idempotente el seed versionado (ver `slug` arriba).
    uniqueIndex('prompt_template_slug_key').on(t.slug),
    // ── GIN por faceta: UNO por columna text[], no un compuesto (db.md §8) ─────
    // Por qué per-column y no un GIN compuesto: la búsqueda facetada combina
    // subconjuntos ARBITRARIOS de facetas (formato Y ángulo, o solo vertical, o los
    // tres…). Con un índice por columna el planner sirve cada predicado con su GIN y
    // combina con BitmapAnd — un GIN compuesto solo ayudaría a la combinación exacta
    // de todas las columnas a la vez, que no es el patrón de consulta.
    //
    // Opclass `array_ops` EXPLÍCITO: es el opclass de `text[]` bajo GIN. Sirve los cuatro
    // operadores de array — `&&` (overlap), `@>` (contains), `<@` (contained) y `=`
    // (igualdad exacta) — verificado empíricamente en el EXPLAIN del test. La búsqueda
    // facetada usa `@>`/`&&`. Postgres tomaría `array_ops` por defecto para text[] bajo
    // gin; se declara explícito para que el opclass sea una decisión documentada.
    //
    // Lo load-bearing NO es el operador (los cuatro son GIN-servables) sino la PRESENCIA
    // del índice: un `text[]` SIN GIN (p. ej. `free_tags`) cae a Seq Scan con el mismo
    // `@>` — es justo el control negativo del test (experimento de una variable).
    index('prompt_template_formats_gin').using('gin', t.formats.op('array_ops')),
    index('prompt_template_hook_angles_gin').using('gin', t.hookAngles.op('array_ops')),
    index('prompt_template_verticals_gin').using('gin', t.verticals.op('array_ops')),
    index('prompt_template_platforms_gin').using('gin', t.platforms.op('array_ops')),
    index('prompt_template_aesthetics_gin').using('gin', t.aesthetics.op('array_ops')),
  ],
);

export type PromptTemplate = typeof promptTemplate.$inferSelect;
export type NewPromptTemplate = typeof promptTemplate.$inferInsert;

// ── prompt_version (§10.1 + §12 l.539) ──────────────────────────────────────
//
// §12 l.539: `template_id, version, body, beats jsonb, guard_pack_ids, changelog`
//
// INMUTABLE (§10.1): toda generación referencia `templateId@version` — reproducibilidad
// y A/B entre versiones. Una fila por (template, versión); nunca se UPDATEa el body/beats.
export const promptVersion = pgTable(
  'prompt_version',
  {
    id: ulidPk(),
    // FK al template. ON DELETE CASCADE: las versiones son partes del template, no
    // entidades independientes — borrar el template borra su historia de versiones.
    templateId: text('template_id')
      .notNull()
      .references(() => promptTemplate.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    // Snapshot inmutable del body/beats en esta versión (§12 l.539). No son nullable:
    // una versión sin cuerpo no es reproducible.
    body: text('body').notNull(),
    beats: jsonb('beats')
      .notNull()
      .default(sql`'[]'::jsonb`),
    // `guard_pack_ids` (§12 l.539): las keys de guard pack vigentes en esta versión
    // (mismo criterio que `prompt_template.guardPackKeys`: keys estables, no ULIDs).
    guardPackKeys: text('guard_pack_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    changelog: text('changelog'),
    ...timestamps,
  },
  (t) => [
    // §10.1: `templateId@version` es la identidad de una generación reproducible → una
    // única fila por (template, versión). db-integration §5: la constraint lleva su test.
    uniqueIndex('prompt_version_template_version_key').on(t.templateId, t.version),
  ],
);

export type PromptVersion = typeof promptVersion.$inferSelect;
export type NewPromptVersion = typeof promptVersion.$inferInsert;

// ── guard_pack (§10.1 + §12 l.540-542) ──────────────────────────────────────
//
// §12 l.540-542: `id, key UNIQUE (p.ej. "guard.vertical.beauty"),
//                 scope ENUM(general|vertical|fidelity|platform), vertical?, platform?
//                 (lookup §9.5), lines text[]`
//
// Negative prompts componibles por scope (§10.1). El compilador los inyecta según el
// brief (§9.5): el guard pack de compliance del vertical, los fidelity guards, el de
// plataforma. Seed de redacción propia (§10.2 regla 5 — prohibido copiar Cliprise).
export const guardScope = pgEnum('guard_scope', ['general', 'vertical', 'fidelity', 'platform']);

export const guardPack = pgTable(
  'guard_pack',
  {
    id: ulidPk(),
    // CLAVE SEMÁNTICA legible y UNIQUE (§12 l.540): `guard.vertical.beauty`,
    // `guard.platform.tiktok`… Es lo que `prompt_template.guardPackKeys` referencia y lo
    // que hace idempotente el seed (misma identidad natural que las otras librerías).
    key: text('key').notNull(),
    scope: guardScope('scope').notNull(),
    // `vertical?`/`platform?` (§12 l.542): el lookup dependiente del brief (§9.5). Nullable:
    // solo los packs de scope vertical/platform los fijan; un pack `general` o `fidelity` no.
    vertical: text('vertical'),
    platform: text('platform'),
    // `lines text[]` (§12 l.542): las líneas de negative prompt del pack.
    lines: text('lines')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [
    // La clave semántica es UNIQUE (§12 l.540) — identidad natural + idempotencia del seed.
    uniqueIndex('guard_pack_key_key').on(t.key),
  ],
);

export type GuardPack = typeof guardPack.$inferSelect;
export type NewGuardPack = typeof guardPack.$inferInsert;

// ── model_profile (§10.1 + §12 l.546-548) ───────────────────────────────────
//
// §12 l.546-548: `id, fal_endpoint, kind ENUM(t2v|i2v|r2v|avatar|lipsync|tts|image|music|
//                 utility), capabilities jsonb (maxDuration, refImages/refVideos/refAudios,
//                 audio, dialogue, aspects), cost jsonb (por s/imagen/1k chars — multi-unidad),
//                 prompt_adapter, status ENUM(active|deprecated), verified_at`
//
// El catálogo de modelos de fal.ai que el pipeline puede invocar. `capabilities` gobierna
// qué nodo del grafo puede usar el modelo; `cost` es multi-unidad (el estimador de T2.2 y
// T3.4 lo consumen). T3.4 recablea las etiquetas del Apéndice B de las `recipe` a estos ids.
export const modelKind = pgEnum('model_kind', [
  't2v',
  'i2v',
  'r2v',
  'avatar',
  'lipsync',
  'tts',
  'image',
  'music',
  'utility',
]);

export const modelStatus = pgEnum('model_status', ['active', 'deprecated']);

export const modelProfile = pgTable(
  'model_profile',
  {
    id: ulidPk(),
    // CLAVE NATURAL (UNIQUE abajo): el endpoint fal (`fal-ai/veo3`, `fal-ai/kling-video`…).
    // Es la identidad del modelo y lo que hace idempotente el seed.
    falEndpoint: text('fal_endpoint').notNull(),
    kind: modelKind('kind').notNull(),
    // `capabilities` jsonb (§10.1 + §12 l.547): maxDuration, refImages/refVideos/refAudios,
    // audio, dialogue, aspects. jsonb — shape validado por Zod en la frontera; añadir una
    // capacidad (p. ej. un nuevo tipo de ref) no puede exigir una migración.
    capabilities: jsonb('capabilities')
      .notNull()
      .default(sql`'{}'::jsonb`),
    // `cost` jsonb MULTI-UNIDAD (§12 l.547): por segundo / imagen / 1k chars, según kind. jsonb
    // (no columnas) precisamente porque la UNIDAD cambia por kind: un t2v cobra por segundo, un
    // image por imagen, un tts por 1k chars. Su shape lo valida Zod en la frontera.
    cost: jsonb('cost')
      .notNull()
      .default(sql`'{}'::jsonb`),
    // `prompt_adapter` (§10.1 regla 4): lo específico del modelo (sintaxis @asset, límites)
    // vive aquí, no en el template canónico. Identificador del adaptador; nullable (algunos
    // modelos consumen el prompt canónico sin adaptar).
    promptAdapter: text('prompt_adapter'),
    status: modelStatus('status').notNull().default('active'),
    // `verified_at` (§12 l.548): cuándo se verificó por última vez el endpoint/capacidades
    // contra fal. Nullable: un perfil recién sembrado aún no se ha verificado en vivo.
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // La clave natural que hace idempotente el seed (ver `falEndpoint` arriba).
    uniqueIndex('model_profile_fal_endpoint_key').on(t.falEndpoint),
  ],
);

export type ModelProfile = typeof modelProfile.$inferSelect;
export type NewModelProfile = typeof modelProfile.$inferInsert;
