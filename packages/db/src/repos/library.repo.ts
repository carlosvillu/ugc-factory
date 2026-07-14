// Repo de la LIBRERÍA sembrada (T2.1): la escritura IDEMPOTENTE de `hook_line`, `cta_line`
// y `recipe` desde los seeds de `@ugc/core/library`.
//
// IDEMPOTENCIA, no "insertar": `pnpm seed` se ejecuta más de una vez (lo corre el
// desarrollador, lo corre el verifier, lo correrá el arranque). Las PKs de hook/cta son
// ULIDs —nuevos en cada corrida—, así que sin una clave natural el segundo `pnpm seed`
// duplicaría la librería entera. Las claves naturales:
//   - hook_line / cta_line → UNIQUE (language, text)
//   - recipe               → la PK ES el tier
//
// LAS TRES USAN `ON CONFLICT … DO UPDATE`, y la semántica es UNA sola: **el seed es la
// fuente de verdad de los METADATOS de la línea; la BD lo es de su HISTORIA.** (Corrección
// del pase de review de T2.1: hooks/CTAs usaban `DO NOTHING`, lo que descartaba EN SILENCIO
// una corrección de `angle` o `verticals` hecha sobre una línea cuyo texto no cambia — y
// `angle` es justo el campo por el que T2.2 compone la matriz: perder esa corrección sin
// avisar es un bug de producto, con el seed reportando "OK".)
//
// Qué se reescribe y qué NO:
//   - SE REESCRIBE: `angle`, `verticals` (hook), `objective` (cta), y los costes/steps de la
//     receta (T3.4 "recalibra las `recipe` sembradas en T2.1" — recalibrar es exactamente
//     re-sembrar sobre las mismas filas).
//   - NO SE TOCA: `perf` (el rendimiento acumulado en F7 es de la fila viva, no del seed) ni
//     la PK (las FKs de `ad_variant.hook_line_id` siguen apuntando a la misma línea).
//   - `text` es la CLAVE: cambiar el texto crea una línea NUEVA (es otra línea de copy), no
//     edita la vieja. Retirar copy obsoleta es una decisión explícita, no un efecto del seed.
import { count, eq, sql } from 'drizzle-orm';
import { HookLineSeedSchema, RecipeSeedSchema } from '@ugc/core/library';
import type { CtaLineSeed, HookLineSeed, RecipeSeed, RecipeTier } from '@ugc/core/library';
import type { Db } from '../client';
import { ctaLine, hookLine, recipe, type Recipe } from '../schema/gallery';

export interface SeedLibraryCounts {
  hookLines: number;
  ctaLines: number;
  recipes: number;
}

/**
 * Siembra hooks + CTAs + recetas y devuelve el TOTAL de filas que hay en cada tabla tras la
 * operación (no las insertadas: en la segunda corrida se insertan 0 y el total sigue siendo
 * el mismo — que es justo lo que prueba la idempotencia).
 *
 * Todo en UNA transacción: o queda la librería entera, o no queda nada a medias.
 */
export async function seedLibrary(
  db: Db,
  seeds: { hooks: HookLineSeed[]; ctas: CtaLineSeed[]; recipes: RecipeSeed[] },
): Promise<SeedLibraryCounts> {
  await db.transaction(async (tx) => {
    if (seeds.hooks.length > 0) {
      await tx
        .insert(hookLine)
        .values(
          seeds.hooks.map((h) => ({
            angle: h.angle,
            text: h.text,
            verticals: h.verticals,
            language: h.language,
          })),
        )
        // La línea existe (mismo idioma + mismo texto) → se ACTUALIZAN sus metadatos. Una
        // corrección de `angle`/`verticals` en seed-data.ts llega a la BD; `perf` y la PK
        // sobreviven intactos.
        .onConflictDoUpdate({
          target: [hookLine.language, hookLine.text],
          set: {
            // `excluded` = la fila que se intentaba insertar. Con un INSERT de N valores es la
            // ÚNICA forma de que cada fila reciba SU propio valor (un literal las pisaría todas
            // con el del último elemento del array).
            angle: sql`excluded.angle`,
            verticals: sql`excluded.verticals`,
            updatedAt: new Date(),
          },
        });
    }

    if (seeds.ctas.length > 0) {
      await tx
        .insert(ctaLine)
        .values(
          seeds.ctas.map((c) => ({
            objective: c.objective,
            text: c.text,
            language: c.language,
          })),
        )
        .onConflictDoUpdate({
          target: [ctaLine.language, ctaLine.text],
          set: {
            objective: sql`excluded.objective`,
            updatedAt: new Date(),
          },
        });
    }

    if (seeds.recipes.length > 0) {
      await tx
        .insert(recipe)
        .values(
          seeds.recipes.map((r) => ({
            id: r.tier,
            steps: r.steps,
            estCost30sMinCents: r.estCost30sMinCents,
            estCost30sMaxCents: r.estCost30sMaxCents,
            notes: r.notes,
          })),
        )
        // Recalibrable (T3.4): la receta del tier se REESCRIBE, no se duplica. Mismo
        // `excluded.*` que arriba y por el mismo motivo — es un INSERT de N filas.
        .onConflictDoUpdate({
          target: recipe.id,
          set: {
            steps: sql`excluded.steps`,
            estCost30sMinCents: sql`excluded.est_cost_30s_min_cents`,
            estCost30sMaxCents: sql`excluded.est_cost_30s_max_cents`,
            notes: sql`excluded.notes`,
            updatedAt: new Date(),
          },
        });
    }
  });

  return countLibrary(db);
}

/** Totales por tabla — lo que el script de seed imprime y lo que la Verificación mira. */
export async function countLibrary(db: Db): Promise<SeedLibraryCounts> {
  const [hooks] = await db.select({ n: count() }).from(hookLine);
  const [ctas] = await db.select({ n: count() }).from(ctaLine);
  const [recipes] = await db.select({ n: count() }).from(recipe);
  return {
    hookLines: hooks?.n ?? 0,
    ctaLines: ctas?.n ?? 0,
    recipes: recipes?.n ?? 0,
  };
}

/** Las 3 recetas por tier: el `SELECT` de la Verificación de T2.1 y la fuente del estimador
 *  de coste de T2.2 (que lee la horquilla min/max en céntimos). */
export async function listRecipes(db: Db): Promise<Recipe[]> {
  return db.select().from(recipe).orderBy(recipe.id);
}

/**
 * La receta de UN tier — la fila REAL contra la que se estima el coste de un lote (T2.3), YA en
 * el shape que el estimador consume (`RecipeSeed`).
 *
 * Existe como query propia (y no como `listRecipes().find()`) porque el ESTIMADOR necesita
 * exactamente una y `estimateBatchCost` LANZA si le llega la de otro tier: pedirla por su PK es
 * la forma de que "la receta del tier elegido" sea una consulta, no un filtro en memoria que
 * alguien pueda equivocar. `undefined` si no está sembrada (⇒ el handler da un error explícito
 * en vez de estimar con una receta inventada).
 *
 * Devuelve `RecipeSeed` (parseado) y no la FILA cruda: `recipe.steps` es jsonb OPACO en la BD, así
 * que el consumidor tendría que castearlo — y un cast es exactamente donde una receta corrupta
 * (escrita a mano, o por una recalibración de T3.4 con un bug) entraría al estimador sin que nadie
 * mirase. El `parse` la rechaza ruidosamente, que es lo correcto cuando lo que sigue es autorizar
 * un gasto.
 */
export async function getRecipe(db: Db, tier: RecipeTier): Promise<RecipeSeed | undefined> {
  const [row] = await db.select().from(recipe).where(eq(recipe.id, tier));
  if (!row) return undefined;
  return RecipeSeedSchema.parse({
    tier: row.id,
    steps: row.steps,
    estCost30sMinCents: row.estCost30sMinCents,
    estCost30sMaxCents: row.estCost30sMaxCents,
    notes: row.notes ?? undefined,
  });
}

/**
 * TODA la librería de hooks (T2.1), en el shape que consume el compositor de matriz
 * (`HookLineSeed`: es lo que `composeMatrix` pide, y filtra él por ángulo + idioma).
 *
 * Sin paginar y sin filtrar en SQL A PROPÓSITO: la librería sembrada son ~decenas de líneas
 * (§17: «el seed inicial cubre es + en»), el compositor las cruza con TODOS los ángulos e idiomas
 * del lote en una sola pasada, y filtrar aquí exigiría replicar en SQL el PUENTE
 * framework→ángulo (`BRIEF_FRAMEWORK_TO_HOOK_ANGLE`) que vive en core. Un `WHERE` que duplique
 * una tabla de traducción de core es exactamente el drift silencioso que db.md §4 evita.
 *
 * Orden estable (id) para que dos composiciones de la misma config den la MISMA matriz: el
 * compositor toma los primeros N que casan, así que un orden no determinista haría que el mismo
 * lote produjera hooks distintos entre corridas.
 */
export async function listHookLines(db: Db): Promise<HookLineSeed[]> {
  const rows = await db.select().from(hookLine).orderBy(hookLine.id);
  // El `angle`/`language` de la BD son `text` (no enums nativos): se PARSEAN contra el contrato,
  // no se castean. Una línea con un ángulo que el compositor no conoce no puede colarse en la
  // matriz — sería un hook que ningún ángulo del brief podría reclamar.
  return rows.flatMap((row) => {
    const parsed = HookLineSeedSchema.safeParse({
      angle: row.angle,
      text: row.text,
      verticals: row.verticals,
      language: row.language,
    });
    return parsed.success ? [parsed.data] : [];
  });
}
