// Smoke de la Verificación de T1.3: dada una URL REAL de producto, ejecuta el fast
// path determinista (classify → probe Shopify `.json` → fetch HTML → parsers JSON-LD/OG
// → merge) y PERSISTE el RawContent en `url_analysis`, imprimiendo título/precio/
// imágenes para comprobarlos A MANO contra la página (lo que exige el verifier).
//
// Es un DEMO runnable para el verifier (que puede usarlo o reescribirlo); el rigor
// permanente (regresión del gate) vive en los tests: unit del fast path con msw
// (`packages/core/src/ingest/*.test.ts`) y la cadena ingester→persistencia con
// Testcontainers (`packages/db/test/integration/ingest-persist.test.ts`).
//
// Corre contra una BD YA LEVANTADA (misma DATABASE_URL que web) y con RED REAL (a
// diferencia de la suite, aquí sí se sale a internet para hitear la URL de verdad).
//
// Env: DATABASE_URL, INGEST_URL (la URL de producto a analizar), INGEST_PROJECT_ID
// (opcional; si falta, crea un proyecto de smoke). Turnkey: `pnpm smoke:ingest`.
import { makeFastPathIngester } from '@ugc/core/ingest';
import { createDb, createProject, createUrlAnalysis } from '@ugc/db';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:ingest: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const url = requireEnv('INGEST_URL');
  const db = createDb(databaseUrl);

  // 1) Proyecto contenedor (reutiliza uno si se pasa INGEST_PROJECT_ID).
  let projectId = process.env.INGEST_PROJECT_ID;
  if (!projectId) {
    const project = await createProject(db, { name: `smoke-ingest ${new Date().toISOString()}` });
    projectId = project.id;
    console.log(`smoke:ingest: proyecto ${projectId} creado`);
  }

  // 2) Fast path con RED REAL.
  const ingester = makeFastPathIngester();
  const result = await ingester.ingest(url);

  console.log(`smoke:ingest: URL           = ${url}`);
  console.log(`smoke:ingest: platform      = ${result.platform}`);
  console.log(`smoke:ingest: urlNormalized = ${result.urlNormalized}`);
  console.log(`smoke:ingest: contentHash   = ${result.contentHash}`);
  console.log(`smoke:ingest: warnings      = ${JSON.stringify(result.warnings)}`);
  console.log('smoke:ingest: --- RawContent extraído (comprobar a mano vs la página) ---');
  console.log(`smoke:ingest: title    = ${JSON.stringify(result.raw.product?.title ?? null)}`);
  console.log(`smoke:ingest: price    = ${JSON.stringify(result.raw.product?.price ?? null)}`);
  console.log(`smoke:ingest: currency = ${JSON.stringify(result.raw.product?.currency ?? null)}`);
  console.log(`smoke:ingest: images   = ${String(result.raw.images.length)} imagen(es)`);
  for (const img of result.raw.images.slice(0, 5)) console.log(`smoke:ingest:   - ${img.url}`);

  // 3) Persiste la fila (RawContent en jsonb) y confirma que se creó.
  const row = await createUrlAnalysis(db, {
    projectId,
    platform: result.platform,
    urlNormalized: result.urlNormalized,
    contentHash: result.contentHash,
    rawContent: result.raw,
    warnings: result.warnings,
  });
  console.log(
    `smoke:ingest: PERSISTIDO url_analysis ${row.id} (status=${row.status}, platform=${row.platform})`,
  );
  console.log('smoke:ingest: OK ✓ — inspecciona la fila arriba contra la página real');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:ingest: falló', err);
  process.exit(1);
});
