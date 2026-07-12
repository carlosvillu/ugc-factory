// Dominio `gallery` (§12, db.md §1). El mapa de db.md §1 asigna a este fichero
// `prompt_template`, `prompt_version`, `guard_pack`, `hook_line`, `cta_line`,
// `persona`, `model_profile` y `recipe`. T2.1 trajo `hook_line`, `cta_line` y `recipe`
// (las librerías de copy y las recetas por tier); **T2.0 añade `persona`** (la librería de
// avatares, §11). El resto llega con sus tareas (galería = F3, model_profile = F3) — mismo
// criterio que `ops.ts`, que en T0.3 solo trajo dos de sus cuatro tablas.
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
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
