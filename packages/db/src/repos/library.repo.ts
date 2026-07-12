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
import { count, sql } from 'drizzle-orm';
import type { CtaLineSeed, HookLineSeed, RecipeSeed } from '@ugc/core/library';
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
 *  de coste de T2.2 (que lee la horquilla min/max en céntimos).
 *
 *  Las lecturas de la librería de copy (hooks por ángulo+idioma, CTAs por objetivo) NO se
 *  escriben aquí todavía: su consumidor es el compositor de matriz de T2.2 y un repo empieza
 *  con la query que necesitas HOY (db.md §4). */
export async function listRecipes(db: Db): Promise<Recipe[]> {
  return db.select().from(recipe).orderBy(recipe.id);
}
