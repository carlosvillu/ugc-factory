// VERIFIER (T5.5a, clause c) — money-path REAL de N7f vía el EXECUTOR (no el bypass live test).
// Drives makeN7fExecutor against the DEV DB with the REAL fal key → 1 i2v real, persists a
// cta_clip asset + cost_entry so it lands in /spend. Debe correr DESDE apps/worker (workspace deps):
//   cd apps/worker && npx tsx --env-file=../../.env --env-file=../../.env.test.local <esta copia>
// (durante la verificación se copió a apps/worker/verif-t55a-money-path.mts con las rutas relativas
//  ajustadas; esta copia bajo docs/ es la evidencia del script ejecutado).
// RESULTADO 2026-07-22: la llamada i2v NO llegó a gastar — fal devolvió HTTP 403
//   {"detail":"User is locked. Reason: Exhausted balance."} en storage/upload/initiate (ver 05-fal-auth-probe.txt).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSecretsKeyFromEnv } from '@ugc/core/secrets';
import { createDbPool, makeLocalStorageAdapterFromEnv } from '@ugc/db';
import {
  adBatch,
  adScript,
  adVariant,
  asset,
  productBrief,
  project,
  urlAnalysis,
} from '@ugc/db/schema';
import { loadFalKey } from '@ugc/services';
import {
  makeAdBatch,
  makeAdScript,
  makeAdVariant,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
} from '@ugc/test-utils';
import { makeN7fExecutor } from '../../../apps/worker/src/executors/generate-cta.ts';

const CONN = process.env.DATABASE_URL!;
const I2V = 'fal-ai/veo3.1/image-to-video';
const KEYFRAME = fileURLToPath(new URL('../T4.8/00-packshot-product.png', import.meta.url));

const { db, pool } = createDbPool(CONN);
const storage = makeLocalStorageAdapterFromEnv();

async function main() {
  // 1) Seed project → … → ad_script with a single CTA scene.
  const [p] = await db.insert(project).values(makeProject({ name: 'VERIF T5.5a CTA money-path' })).returning();
  const [ua] = await db.insert(urlAnalysis).values(makeUrlAnalysis({ projectId: p!.id })).returning();
  const [brief] = await db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: makeBrief() }))
    .returning();
  const [batch] = await db.insert(adBatch).values(makeAdBatch({ projectId: p!.id, briefId: brief!.id })).returning();
  const [variant] = await db.insert(adVariant).values(makeAdVariant({ batchId: batch!.id })).returning();
  const [script] = await db
    .insert(adScript)
    .values(
      makeAdScript({
        variantId: variant!.id,
        language: 'en',
        scenes: [
          { t: 0, seconds: 4, segment: 'cta', narration: 'Get yours now, link in bio.', visual: 'product on clean surface, push-in', camera: 'slow push', emotion: 'confident' },
        ],
      }),
    )
    .returning();

  // 2) Real keyframe asset from the committed T4.8 packshot.
  const bytes = new Uint8Array(readFileSync(KEYFRAME));
  const key = `inputs/keyframe/verif-t55a-${Date.now()}`;
  const put = await storage.put(key, bytes, { mime: 'image/png' });
  const [kf] = await db
    .insert(asset)
    .values({ kind: 'keyframe', storageKey: key, mime: 'image/png', bytes: put.bytes, checksum: put.checksum })
    .returning();

  console.log(JSON.stringify({ scriptId: script!.id, keyframeAssetId: kf!.id }, null, 2));

  // 3) Real fal key: prefer process.env.FAL_KEY (.env.test.local), fall back to app_setting (worker's
  //    resolver). Key source is orthogonal to what N7f implements.
  const falKey = () =>
    process.env.FAL_KEY ? Promise.resolve(process.env.FAL_KEY) : loadFalKey(db, getSecretsKeyFromEnv());
  const resolved = await falKey();
  const srcName = process.env.FAL_KEY ? 'process.env.FAL_KEY' : 'app_setting';
  console.log('[plumbing] fal key resolved from', srcName, ':', resolved.slice(0, 6) + '…', 'len=', resolved.length);

  // 4) Run the REAL N7f executor once (stepless seam: keyframe via config imageAssetIds).
  const outputs: unknown[] = [];
  const exec = makeN7fExecutor({ db, storage, falKey });
  const t0 = Date.now();
  await exec({
    config: { scriptId: script!.id, ctaEndpoint: I2V, imageAssetIds: [kf!.id] },
    collectOutput: (r: unknown) => outputs.push(r),
    deps: [],
  });
  console.log('[executor] N7f done in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  console.log('[output]', JSON.stringify(outputs[0], null, 2));

  // 5) Read back the persisted cta_clip asset + generation + cost_entry.
  const clip = await db.execute(
    `SELECT id, kind, mime, duration_s, parent_asset_ids, storage_key, checksum, bytes FROM asset WHERE kind='cta_clip' ORDER BY created_at DESC LIMIT 1`,
  );
  console.log('[asset cta_clip]', JSON.stringify(clip.rows[0], null, 2));
  const gen = await db.execute(
    `SELECT g.id, g.status, g.fal_request_id FROM generation g ORDER BY g.created_at DESC LIMIT 1`,
  );
  console.log('[generation]', JSON.stringify(gen.rows[0], null, 2));
  const cost = await db.execute(
    `SELECT id, provider, amount_cents, quantity, unit, created_at FROM cost_entry WHERE provider='fal' ORDER BY created_at DESC LIMIT 1`,
  );
  console.log('[cost_entry]', JSON.stringify(cost.rows[0], null, 2));

  // 6) Export the persisted clip to disk for ffprobe (tied to the persisted asset).
  const clipRow = clip.rows[0] as { storage_key: string };
  const got = await storage.get(clipRow.storage_key);
  const buf = Buffer.from(await new Response(got.body as ReadableStream).arrayBuffer());
  const outPath = fileURLToPath(new URL('./03-cta-clip-persisted.mp4', import.meta.url));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, buf);
  console.log('[clip written]', outPath, buf.length, 'bytes');
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error('MONEY-PATH FAILED:', e);
    await pool.end();
    process.exit(1);
  });
