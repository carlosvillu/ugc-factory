// Driver de verificación T3.9 · Phase B — N4 estima el coste en vez de abortar.
//
// Replica el CUERPO REAL de N4 (apps/worker/src/executors/strategy.ts):
//   listPlanningInputs(db, tier) -> if recipe===undefined throw PermanentStepError -> planBatch(...)
// usando las MISMAS funciones de producción (@ugc/db, @ugc/core/strategy), contra la BD REAL
// ugc_t39 sembrada por el BOOT de web (no por `pnpm seed`). El brief es in-memory (N4 solo lee de
// la BD la receta vía listPlanningInputs; el brief llega del artefacto de N3).
//
// Por qué NO se conduce un run orquestado completo: alcanzar N4 exige N1–N3, que pegan a
// Firecrawl/Anthropic (de pago) y romperían el cap $0 de esta tarea. N4 en sí es $0 (sin LLM, sin
// red: cabecera de strategy.ts). Ejercitar su cuerpo con las funciones de producción contra la BD
// sembrada es la vía $0 fiel al fallo de prod («no hay receta sembrada del tier "test"»).
//
// CÓMO SE EJECUTÓ: copiado a apps/worker/__t39-n4-driver.ts (para resolver los workspace pkgs),
// `npx tsx apps/worker/__t39-n4-driver.ts`, y borrado tras la corrida. Salida en 06-n4-estimates.txt.
import { createDbPool, listPlanningInputs } from '@ugc/db';
import { defaultBatchConfig, planBatch } from '@ugc/core/strategy';
import { makeBrief } from '@ugc/test-utils';

const CONN = 'postgres://ugc:ugc@localhost:55432/ugc_t39';

async function main(): Promise<void> {
  const { db, pool } = createDbPool(CONN);
  try {
    const brief = makeBrief();
    const config = defaultBatchConfig(brief, ['es', 'en']);
    console.log(`[n4] tier por defecto del lote = "${config.tier}" (el que abortaba en prod)`);

    const { libraryHooks, personas, recipe } = await listPlanningInputs(db, config.tier);
    console.log(
      `[n4] listPlanningInputs("${config.tier}"): hooks=${String(libraryHooks.length)} ` +
        `personas=${String(personas.length)} recipe.tier=${recipe ? recipe.tier : 'undefined'}`,
    );
    if (recipe === undefined) {
      throw new Error('FAIL: recipe undefined tras el boot-seed → N4 abortaría (regresión de T3.9)');
    }

    const { plan, estimate } = planBatch({ brief, config, libraryHooks, personas, recipe });
    console.log(
      `[n4] planBatch OK: variantes=${String(plan.variants.length)} ` +
        `coste estimado del lote = ${String(estimate.total.minCents)}–${String(estimate.total.maxCents)} cents`,
    );
    if (estimate.total.maxCents <= 0) throw new Error('FAIL: la estimación de coste no es positiva');
    console.log('[n4] ✅ N4 ESTIMA el coste en vez de abortar (tier "test" sembrado)');

    // Rama de aborto: recipe undefined ⇒ N4 lanza. DELETE en una tx SQL revertida.
    const client = await pool.connect();
    let sawUndefined = false;
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM recipe WHERE id = $1', [config.tier]);
      const { rows } = await client.query('SELECT id FROM recipe WHERE id = $1', [config.tier]);
      sawUndefined = rows.length === 0;
      console.log(
        `[n4] tras DELETE de la receta "${config.tier}" (en tx): filas restantes = ${String(rows.length)} ` +
          `${sawUndefined ? '⇒ getRecipe devolvería undefined ⇒ N4 lanzaría PermanentStepError' : '(AÚN PRESENTE, mal)'}`,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    if (!sawUndefined) throw new Error('FAIL: la receta no desapareció con el DELETE en la tx');

    const after = await listPlanningInputs(db, config.tier);
    console.log(
      `[n4] tras rollback, recipe("${config.tier}").tier = ${after.recipe ? after.recipe.tier : 'undefined'} (debe seguir presente)`,
    );
    if (after.recipe === undefined) throw new Error('FAIL: el rollback no restauró la receta');
    console.log('[n4] ✅ rama de aborto confirmada: N4 solo aborta cuando la receta es undefined');
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
