// CLI de siembra: lo que `pnpm seed` (raíz → filtro @ugc/db) invoca y lo que ejercita la
// Verificación de T2.1 ("`pnpm seed` puebla librerías y recetas").
//
// Mismo patrón que `db:migrate`/`db:smoke`: carga el `.env` raíz vía la flag
// `--env-file-if-exists` del script, lee DATABASE_URL y falla ruidosamente sin ella.
//
// EL VALIDADOR CORRE ANTES DE TOCAR LA BD: un seed con un hook sin ángulo, un hook de 13
// palabras o una receta sin coste ABORTA aquí, con el detalle de qué línea está mal. (El
// mismo validador corre además en `pnpm gate` sobre la librería real — el gate caza el
// problema antes incluso de que nadie ejecute este script.)
//
// IDEMPOTENTE: correrlo N veces deja la misma librería (ON CONFLICT — ver library.repo.ts).
import { formatSeedIssues, SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import { createDb } from '../src/client';
import { listRecipes, seedLibrary } from '../src/repos/library.repo';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('seed: falta DATABASE_URL (¿copiaste .env.example a .env?)');
    process.exit(1);
  }

  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.ok || !validation.library) {
    console.error(
      `seed: la librería NO es válida (${String(validation.issues.length)} problemas):`,
    );
    console.error(formatSeedIssues(validation.issues));
    process.exit(1);
  }

  const db = createDb(connectionString);
  const counts = await seedLibrary(db, validation.library);

  console.log(
    `seed: OK — hook_line=${String(counts.hookLines)} cta_line=${String(counts.ctaLines)} recipe=${String(counts.recipes)}`,
  );

  // El `SELECT` de la Verificación de T2.1: "los 3 tiers con estimaciones que cuadran con el
  // Apéndice B". Se imprime aquí para que `pnpm seed` deje la evidencia a la vista.
  const recipes = await listRecipes(db);
  console.table(
    recipes.map((r) => ({
      tier: r.id,
      cogs_30s: `$${(r.estCost30sMinCents / 100).toFixed(2)}–$${(r.estCost30sMaxCents / 100).toFixed(2)}`,
      min_cents: r.estCost30sMinCents,
      max_cents: r.estCost30sMaxCents,
    })),
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('seed: falló', err);
  process.exit(1);
});
