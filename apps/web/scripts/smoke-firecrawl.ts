// Smoke de la Verificación de T1.4: dada una URL REAL JS-heavy, ejecuta la ingesta N2
// (Firecrawl `/v2/scrape` → fallback Jina) y PERSISTE el RawContent en `url_analysis`,
// el screenshot como `asset` y los créditos en `cost_entry`. Imprime lo que el verifier
// comprueba a mano: markdown legible, ≥3 imágenes, branding con paleta, el id del asset
// del screenshot (descargable por GET /api/assets/:id/download) y los créditos (→ /spend).
//
// Es un DEMO runnable para el verifier (que puede usarlo o reescribirlo); el rigor
// permanente (regresión del gate) vive en los tests: unit del ingester con msw
// (`packages/core/src/ingest/firecrawl.test.ts`) y la cadena servicio→persistencia con
// Testcontainers (`apps/web/test/integration/firecrawl-ingest.test.ts`).
//
// Corre contra una BD YA LEVANTADA (misma DATABASE_URL/ASSETS_DIR que web) y con RED
// REAL (a diferencia de la suite, aquí SÍ se sale a internet). La API key de Firecrawl
// se lee del módulo de secretos (T0.14): siémbrala antes vía /settings o el bootstrap.
//
// Env: DATABASE_URL, ASSETS_DIR, APP_MASTER_KEY (para descifrar la key), FIRECRAWL_URL
// (la URL a analizar), FIRECRAWL_PROJECT_ID (opcional). Turnkey: `pnpm smoke:firecrawl`.
import { deriveSecretsKey } from '@ugc/core/secrets';
import { createDb, createProject, getAsset, makeLocalStorageAdapter } from '@ugc/db';

import { runFirecrawlIngest } from '@ugc/services';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:firecrawl: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const masterKey = requireEnv('APP_MASTER_KEY');
  const url = requireEnv('FIRECRAWL_URL');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const secretsKey = deriveSecretsKey(masterKey);

  // 1) Proyecto contenedor (reutiliza uno si se pasa FIRECRAWL_PROJECT_ID).
  let projectId = process.env.FIRECRAWL_PROJECT_ID;
  if (!projectId) {
    const project = await createProject(db, {
      name: `smoke-firecrawl ${new Date().toISOString()}`,
    });
    projectId = project.id;
    console.log(`smoke:firecrawl: proyecto ${projectId} creado`);
  }

  // 2) Ingesta N2 con RED REAL + persistencia.
  const result = await runFirecrawlIngest({ db, storage, secretsKey }, { projectId, url });

  const raw = result.analysis.rawContent as {
    markdown: string;
    images: unknown[];
    branding?: { palette?: string[] } | null;
    screenshotRef?: string | null;
  };

  console.log(`smoke:firecrawl: URL          = ${url}`);
  console.log(`smoke:firecrawl: provider     = ${result.provider}`);
  console.log(
    `smoke:firecrawl: analysis id  = ${result.analysis.id} (status=${result.analysis.status})`,
  );
  console.log(`smoke:firecrawl: credits      = ${String(result.credits)}`);
  console.log('smoke:firecrawl: --- RawContent (comprobar a mano vs la página) ---');
  console.log(`smoke:firecrawl: markdown     = ${String(raw.markdown.length)} chars`);
  console.log(`smoke:firecrawl: images       = ${String(raw.images.length)} imagen(es)`);
  console.log(`smoke:firecrawl: palette      = ${JSON.stringify(raw.branding?.palette ?? null)}`);
  console.log(`smoke:firecrawl: screenshotRef= ${JSON.stringify(raw.screenshotRef ?? null)}`);

  // 3) Confirma el asset del screenshot persistido (descargable por T0.5).
  if (result.screenshotAssetId) {
    const asset = await getAsset(db, result.screenshotAssetId);
    console.log(
      `smoke:firecrawl: screenshot asset ${result.screenshotAssetId} (${String(asset?.bytes ?? 0)} bytes, key=${asset?.storageKey ?? '?'})`,
    );
    console.log(
      `smoke:firecrawl: descárgalo con GET /api/assets/${result.screenshotAssetId}/download (T0.5)`,
    );
  } else {
    console.log('smoke:firecrawl: (sin screenshot — provider=jina o la captura falló)');
  }

  console.log('smoke:firecrawl: OK ✓ — inspecciona lo de arriba contra la página real y /spend');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:firecrawl: falló', err);
  process.exit(1);
});
