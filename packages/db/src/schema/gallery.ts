// Dominio `gallery` (§12, db.md §1). El mapa de db.md §1 asigna a este fichero
// `prompt_template`, `prompt_version`, `guard_pack`, `hook_line`, `cta_line`,
// `persona`, `model_profile` y `recipe`. En T2.1 SOLO nacen las tres tablas que la
// tarea entrega: `hook_line`, `cta_line` y `recipe` (las librerías de copy y las
// recetas por tier). El resto llega con sus tareas (galería = F3, personas = T2.0,
// model_profile = F3) — mismo criterio que `ops.ts`, que en T0.3 solo trajo dos de
// sus cuatro tablas.
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
