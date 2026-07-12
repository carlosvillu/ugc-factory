// LA VERIFICACIÓN DE T2.1, CODIFICADA COMO TEST PERMANENTE (regla de trabajo 8 del
// planning: toda cláusula determinista y gratuita de la Verificación vive dentro de
// `pnpm gate`). Contra Postgres REAL (Testcontainers), con los seeds REALES:
//
//   1. "`pnpm seed` puebla librerías y recetas" → `seedLibrary` sobre la BD clonada inserta
//      los ~80 hooks, ~30 CTAs y las 3 recetas, y se leen de vuelta.
//   2. IDEMPOTENCIA (implícita pero innegociable: el script se corre más de una vez) → la
//      SEGUNDA siembra deja los MISMOS totales, no el doble.
//   3. "`SELECT` de `recipe` muestra los 3 tiers con estimaciones que cuadran con el
//      Apéndice B (±10 %)" → se lee la tabla y se compara contra los números del Apéndice B
//      escritos A MANO aquí (oráculo independiente: leerlos del propio seed sería comprobar
//      que 1 = 1).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import { ctaLine, hookLine } from '@ugc/db/schema';
import { countLibrary, listRecipes, seedLibrary } from '../../src/repos/library.repo';

// APÉNDICE B (PRD:798) y §16.1, que coinciden. En DÓLARES aquí a propósito: es la unidad en
// la que el PRD lo escribe, y el test hace la conversión a céntimos igual que la haría un
// humano leyendo el Apéndice — si alguien cambiara la unidad de la columna, este test lo caza.
const APPENDIX_B_COGS_30S_USD: Record<string, { min: number; max: number }> = {
  test: { min: 0.3, max: 1.7 },
  standard: { min: 1.8, max: 5 },
  premium: { min: 9, max: 13 },
};

/** La tolerancia que pide la Verificación. */
const TOLERANCE = 0.1;

/** Las 3 recetas reales, validadas: `seedLibrary` las exige siempre (el validador rechaza una
 *  librería sin los 3 tiers), así que los tests que solo tocan hooks/CTAs las pasan tal cual. */
function realRecipes() {
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  return validation.library.recipes;
}

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'library-seed' });
});

afterAll(async () => {
  await tdb.close();
});

describe('`pnpm seed`: puebla librerías y recetas (T2.1)', () => {
  it('siembra la librería REAL y es IDEMPOTENTE (dos corridas, mismos totales)', async () => {
    // Se siembra exactamente lo que siembra el script: `SEED_LIBRARY` pasada por el
    // validador (mismo camino, sin atajos — el arnés no puede ser más cómodo que la realidad).
    const validation = validateSeeds(SEED_LIBRARY);
    expect(validation.ok).toBe(true);
    if (!validation.library) throw new Error('la librería real no valida');

    const first = await seedLibrary(tdb.db, validation.library);
    expect(first.hookLines).toBe(SEED_LIBRARY.hooks.length);
    expect(first.ctaLines).toBe(SEED_LIBRARY.ctas.length);
    expect(first.recipes).toBe(3);

    // SEGUNDA corrida: ON CONFLICT … DO UPDATE ⇒ actualiza metadatos, ni una fila más.
    const second = await seedLibrary(tdb.db, validation.library);
    expect(second).toEqual(first);

    // Y los datos siguen ahí (no es que la segunda corrida haya vaciado y repuesto).
    const totals = await countLibrary(tdb.db);
    expect(totals).toEqual(first);
  });

  it('las dos librerías (es/en) llegan a la BD con su idioma', async () => {
    for (const language of ['es', 'en'] as const) {
      const hooks = await tdb.db.select().from(hookLine).where(eq(hookLine.language, language));
      const ctas = await tdb.db.select().from(ctaLine).where(eq(ctaLine.language, language));
      expect(hooks.length).toBeGreaterThanOrEqual(40);
      expect(ctas.length).toBeGreaterThanOrEqual(15);
    }
  });

  it('`SELECT` de `recipe`: los 3 tiers cuadran con el Apéndice B (±10 %)', async () => {
    const recipes = await listRecipes(tdb.db);
    expect(recipes.map((r) => r.id).sort()).toEqual(['premium', 'standard', 'test']);

    for (const row of recipes) {
      const appendix = APPENDIX_B_COGS_30S_USD[row.id];
      expect(appendix, `tier fuera del Apéndice B: ${row.id}`).toBeDefined();
      if (!appendix) continue;

      // La columna guarda CÉNTIMOS ENTEROS (no float): la comparación con el Apéndice B se
      // hace en dólares, dividiendo entre 100 — exactamente lo que hará el estimador de T2.2
      // al enseñarle el coste al usuario.
      const minUsd = row.estCost30sMinCents / 100;
      const maxUsd = row.estCost30sMaxCents / 100;

      expect(Number.isInteger(row.estCost30sMinCents)).toBe(true);
      expect(Number.isInteger(row.estCost30sMaxCents)).toBe(true);
      expect(row.estCost30sMinCents).toBeGreaterThan(0); // "receta sin coste" = dato corrupto
      expect(row.estCost30sMinCents).toBeLessThanOrEqual(row.estCost30sMaxCents);

      expect(Math.abs(minUsd - appendix.min)).toBeLessThanOrEqual(appendix.min * TOLERANCE);
      expect(Math.abs(maxUsd - appendix.max)).toBeLessThanOrEqual(appendix.max * TOLERANCE);
    }
  });

  it('la receta trae los 4 componentes del Apéndice B (avatar, b-roll, voz, shots)', async () => {
    const recipes = await listRecipes(tdb.db);
    for (const row of recipes) {
      // `steps` es jsonb opaco en la BD: se lee tal cual se escribió (roundtrip real).
      const steps = row.steps as { component: string; model: string }[];
      expect(steps.map((s) => s.component).sort()).toEqual(['avatar', 'broll', 'shots', 'voice']);
      for (const step of steps) expect(step.model.length).toBeGreaterThan(0);
    }
  });

  it('re-sembrar una línea con el ÁNGULO corregido ACTUALIZA la fila (no la descarta)', async () => {
    // El hallazgo del pase de review: con `DO NOTHING`, corregir el `angle` de un hook cuyo
    // TEXTO no cambia se descartaba EN SILENCIO — y `angle` es el campo por el que T2.2
    // compone la matriz. Aquí se fija el comportamiento correcto: el seed es la fuente de
    // verdad de los metadatos; la BD, de la historia (`perf` y la PK sobreviven).
    const line = {
      angle: 'curiosity' as const,
      text: 'Línea de prueba de re-siembra.',
      verticals: [] as never[],
      language: 'es' as const,
    };
    const cta = {
      objective: 'story' as const,
      text: 'CTA de prueba de re-siembra.',
      language: 'es' as const,
    };
    await seedLibrary(tdb.db, { hooks: [line], ctas: [cta], recipes: realRecipes() });

    const [before] = await tdb.db.select().from(hookLine).where(eq(hookLine.text, line.text));
    expect(before?.angle).toBe('curiosity');
    // Simula la historia acumulada en F7: `perf` es de la fila viva, NO del seed.
    await tdb.db
      .update(hookLine)
      .set({ perf: { ctr: 0.031 } })
      .where(eq(hookLine.id, before?.id ?? ''));

    // Re-siembra con el ángulo CORREGIDO y una vertical nueva, MISMO texto.
    await seedLibrary(tdb.db, {
      hooks: [{ ...line, angle: 'pain_point', verticals: ['beauty'] }],
      ctas: [{ ...cta, objective: 'conversion' }],
      recipes: realRecipes(),
    });

    const [after] = await tdb.db.select().from(hookLine).where(eq(hookLine.text, line.text));
    expect(after?.angle).toBe('pain_point'); // la corrección LLEGA
    expect(after?.verticals).toEqual(['beauty']);
    expect(after?.id).toBe(before?.id); // misma fila: las FKs de ad_variant siguen válidas
    expect(after?.perf).toEqual({ ctr: 0.031 }); // la HISTORIA no se pisa

    const [ctaAfter] = await tdb.db.select().from(ctaLine).where(eq(ctaLine.text, cta.text));
    expect(ctaAfter?.objective).toBe('conversion');
  });

  it('re-sembrar con costes recalibrados REESCRIBE la receta del tier (no duplica) — T3.4', async () => {
    const validation = validateSeeds(SEED_LIBRARY);
    if (!validation.library) throw new Error('la librería real no valida');

    const recalibrated = {
      ...validation.library,
      recipes: validation.library.recipes.map((r) =>
        r.tier === 'test' ? { ...r, estCost30sMinCents: 32, estCost30sMaxCents: 165 } : r,
      ),
    };
    const counts = await seedLibrary(tdb.db, recalibrated);
    expect(counts.recipes).toBe(3); // sigue habiendo TRES, no cuatro

    const [testRecipe] = (await listRecipes(tdb.db)).filter((r) => r.id === 'test');
    expect(testRecipe?.estCost30sMinCents).toBe(32);
    expect(testRecipe?.estCost30sMaxCents).toBe(165);

    // Se restaura el seed canónico para no dejar la BD del clon en un estado raro para el
    // resto del fichero (los tests de arriba ya corrieron, pero el orden no es un contrato).
    await seedLibrary(tdb.db, validation.library);
  });
});
