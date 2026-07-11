// Verifier-owned driver (NOT the implementer's) for T1.7 · Cliente Anthropic + VisualAnalyzer.
// Composes the REAL services exactly as T1.10a would: runFirecrawlIngest (to get a persisted
// RawContent with real CDN product images + a screenshotRef in storage) then runVisualAnalyze
// (the service under test, which reads the anthropic key from the T0.14 secret store, rescales,
// calls Haiku, and records the cost_entry). ONE paid Anthropic call.
//
// Guardrail: it prints the count of sendableProductImageUrls BEFORE calling Anthropic and, if
// ANALYZE_DRY=1, STOPS before spending — so the verifier can confirm ≥8 sendable raster images
// without burning the paid call.
//
// Outputs (all to docs/verifications/T1.7/): the survivor product-image URLs, the per-image
// classification (kind/background/video_suitability/has_overlay_text) in input order, the token
// usage, and downloads each classified image to product-XX.<ext> for the durable side-by-side.
//
// Env: DATABASE_URL, ASSETS_DIR, APP_MASTER_KEY (all from .env). ANALYZE_URL (landing to analyze).
// Usage: ANALYZE_URL=https://... tsx --env-file-if-exists=.env docs/verifications/T1.7/analyze-verify.ts
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { deriveSecretsKey } from '../../../packages/core/src/secrets/index';
import { createDb, createProject, makeLocalStorageAdapter } from '../../../packages/db/src/index';
import { runFirecrawlIngest } from '../../../apps/web/src/server/firecrawl-ingest';
import {
  runVisualAnalyze,
  sendableProductImageUrls,
} from '../../../apps/web/src/server/visual-analyze';
import type { RawContent } from '../../../packages/core/src/contracts/index';

const EV = join(process.cwd(), 'docs/verifications/T1.7');

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`analyze-verify: falta ${name}`);
    process.exit(1);
  }
  return v;
}

function extFor(url: string): string {
  const m = /\.(jpe?g|png|gif|webp)/i.exec(url);
  return m ? m[1].toLowerCase() : 'img';
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const masterKey = requireEnv('APP_MASTER_KEY');
  const url = requireEnv('ANALYZE_URL');
  const dry = process.env.ANALYZE_DRY === '1';

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const secretsKey = deriveSecretsKey(masterKey);

  const project = await createProject(db, { name: `verify-T1.7 ${new Date().toISOString()}` });
  console.log(`analyze-verify: project      = ${project.id}`);

  // 1) Real Firecrawl ingest → RawContent with real CDN product images + persisted screenshot.
  const ingest = await runFirecrawlIngest({ db, storage, secretsKey }, { projectId: project.id, url });
  const raw: RawContent = ingest.analysis.rawContent as RawContent;
  console.log(`analyze-verify: firecrawl    = provider=${ingest.provider} credits=${ingest.credits}`);
  console.log(`analyze-verify: raw.images   = ${raw.images.length} total`);
  console.log(`analyze-verify: screenshotRef= ${JSON.stringify(raw.screenshotRef ?? null)}`);

  // 2) GUARDRAIL: count sendable raster images BEFORE spending.
  const sendable = sendableProductImageUrls(raw.images);
  console.log(`analyze-verify: sendable     = ${sendable.length} raster http(s) images`);
  sendable.forEach((u, i) => console.log(`  send[${String(i + 1).padStart(2, '0')}] ${u}`));

  if (dry) {
    console.log('analyze-verify: DRY RUN — stopping before the paid Anthropic call.');
    process.exit(0);
  }
  if (sendable.length < 8) {
    console.error(`analyze-verify: ABORT — solo ${sendable.length} imágenes sendable (<8). Cambia de landing, no gastes.`);
    process.exit(3);
  }

  // 3) THE paid call — runVisualAnalyze (records cost_entry). uploads=[] → modo url (CDN images).
  console.log('analyze-verify: --- llamando a runVisualAnalyze (RED REAL, gasto Anthropic) ---');
  const t0 = Date.now();
  const res = await runVisualAnalyze(
    { db, storage, secretsKey },
    { projectId: project.id, raw, uploads: [] },
  );
  const ms = Date.now() - t0;

  console.log(`analyze-verify: status       = ${res.status}  (${String(ms)} ms)`);
  console.log(`analyze-verify: usage        = ${JSON.stringify(res.usage)}`);
  console.log(`analyze-verify: warnings     = ${JSON.stringify(res.warnings)}`);
  console.log(`analyze-verify: hero_image   = ${JSON.stringify(res.visualAnalysis.hero_image_url)}`);
  console.log(`analyze-verify: brand_style  = ${JSON.stringify(res.visualAnalysis.brand_style)}`);
  console.log(`analyze-verify: social_proof = ${JSON.stringify(res.visualAnalysis.rendered_social_proof)}`);
  console.log(`analyze-verify: #images      = ${res.visualAnalysis.images.length} classified`);

  // 4) Side-by-side: print classification in order + download each image locally.
  const rows: string[] = [];
  for (let i = 0; i < res.visualAnalysis.images.length; i++) {
    const img = res.visualAnalysis.images[i];
    const n = String(i + 1).padStart(2, '0');
    const line = `[${n}] kind=${img.kind} | bg=${img.background} | video=${img.video_suitability} | overlay=${String(img.has_overlay_text)} | url=${img.url}`;
    console.log(line);
    rows.push(line);
    // Download the image bytes for the durable, CDN-independent side-by-side.
    try {
      const r = await fetch(img.url, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        const file = `product-${n}.${extFor(img.url)}`;
        await writeFile(join(EV, file), buf);
        console.log(`     saved ${file} (${String(buf.length)} bytes)`);
      } else {
        console.log(`     download failed HTTP ${String(r.status)}`);
      }
    } catch (e) {
      console.log(`     download threw ${String(e)}`);
    }
  }
  await writeFile(join(EV, 'classifications.txt'), rows.join('\n') + '\n');

  console.log('analyze-verify: OK ✓');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('analyze-verify: threw', err);
  process.exit(1);
});
