// Verifier-owned driver for the T1.7 'skipped' clause: "el modo manual sin imágenes deja el
// paso skipped y el flujo continúa". Builds a RawContent with images=[] and NO screenshotRef,
// no uploads → runVisualAnalyze must NOT call Anthropic (cero coste). Asserts:
//   - status === 'skipped'
//   - usage === null
//   - anthropic cost_entry count UNCHANGED (snapshot before/after)
//   - a valid empty VisualAnalysis is returned (flujo continúa, no crash)
// Free: no paid call.
import { deriveSecretsKey } from '../../../packages/core/src/secrets/index';
import { createDb, createProject, makeLocalStorageAdapter } from '../../../packages/db/src/index';
import { runVisualAnalyze } from '../../../apps/web/src/server/visual-analyze';
import type { RawContent } from '../../../packages/core/src/contracts/index';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`skipped-verify: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const masterKey = requireEnv('APP_MASTER_KEY');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const secretsKey = deriveSecretsKey(masterKey);
  const project = await createProject(db, { name: `verify-T1.7-skipped ${new Date().toISOString()}` });

  // El conteo before/after de cost_entry anthropic lo hace el wrapper bash (docker psql):
  // aquí se comprueba status/usage/visualAnalysis y se confía en el conteo externo.
  // RawContent manual sin imágenes: images=[], sin screenshotRef, sin uploads.
  const raw: RawContent = {
    source: 'manual',
    url: null,
    platform: 'manual',
    markdown: 'Producto manual sin imágenes.',
    images: [],
    screenshotRef: null,
  } as unknown as RawContent;

  const res = await runVisualAnalyze(
    { db, storage, secretsKey },
    { projectId: project.id, raw, uploads: [] },
  );

  console.log(`skipped-verify: status        = ${res.status}`);
  console.log(`skipped-verify: usage         = ${JSON.stringify(res.usage)}`);
  console.log(`skipped-verify: visualAnalysis= ${JSON.stringify(res.visualAnalysis)}`);
  console.log(`skipped-verify: warnings      = ${JSON.stringify(res.warnings)}`);

  const ok =
    res.status === 'skipped' &&
    res.usage === null &&
    Array.isArray(res.visualAnalysis.images) &&
    res.visualAnalysis.images.length === 0 &&
    res.visualAnalysis.hero_image_url === null;

  console.log(`skipped-verify: RESULT        = ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 4);
}

main().catch((err: unknown) => {
  console.error('skipped-verify: threw', err);
  process.exit(1);
});
