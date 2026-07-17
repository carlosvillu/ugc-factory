// VERIFIER-SIDE SEEDER (T4.8): siembra un ad_script de CONVERSIÓN real (hook + 2 body ≤8s + cta) en el
// mismo DATABASE_URL que sirve `pnpm dev`, para conducir el executor N7d encima. El body son 2 escenas
// (6s, 7s) ≤ maxDuration(8) → el executor debe producir EXACTAMENTE 2 clips (uno por escena, sin
// trocear). Imprime SCRIPT_ID. Env: DATABASE_URL.
import { createDb } from '@ugc/db';
import {
  adBatch,
  adScript,
  adVariant,
  productBrief,
  project,
  urlAnalysis,
} from '@ugc/db/schema';
import {
  makeAdBatch,
  makeAdScript,
  makeAdVariant,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
} from '@ugc/test-utils';
import type { AdScene } from '@ugc/core/contracts';

const CONVERSION_SCENES: AdScene[] = [
  { t: 0, seconds: 10, segment: 'hook', narration: 'Struggling with dull skin?', visual: 'x', camera: 'x', emotion: 'x' },
  { t: 10, seconds: 6, segment: 'body', narration: 'This serum brightens in days.', visual: 'x', camera: 'x', emotion: 'x' },
  { t: 16, seconds: 7, segment: 'body', narration: 'Apply two drops every morning.', visual: 'x', camera: 'x', emotion: 'x' },
  { t: 23, seconds: 5, segment: 'cta', narration: 'Get yours today, link below.', visual: 'x', camera: 'x', emotion: 'x' },
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('seed-conversion-script: falta DATABASE_URL');
    process.exit(1);
  }
  const db = createDb(databaseUrl);

  const [p] = await db.insert(project).values(makeProject()).returning();
  const [ua] = await db.insert(urlAnalysis).values(makeUrlAnalysis({ projectId: p!.id })).returning();
  const [brief] = await db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: makeBrief() }))
    .returning();
  const [batch] = await db
    .insert(adBatch)
    .values(makeAdBatch({ projectId: p!.id, briefId: brief!.id }))
    .returning();
  const [variant] = await db.insert(adVariant).values(makeAdVariant({ batchId: batch!.id })).returning();
  const [script] = await db
    .insert(adScript)
    .values(makeAdScript({ variantId: variant!.id, language: 'en', scenes: CONVERSION_SCENES }))
    .returning();

  console.log(`SCRIPT_ID=${script!.id}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('seed-conversion-script: falló', err);
  process.exit(1);
});
