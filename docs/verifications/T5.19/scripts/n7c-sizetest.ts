// T5.19 Parte B — DECISIVE SIZE TEST. Hypothesis: OmniHuman's inference-side fetcher can't pull a
// 5.9 MB reference from fal.media (external curl is 200; the discriminator is file SIZE, since the
// 2026-07-26 smoke succeeded when Maya's ref was a ~KB sharp placeholder).
// Recompress Maya's frontal headshot to <1 MB (long edge kept >=2048 so validateReferenceImage passes),
// write ONLY into the scratch storage path (NEVER the committed fixture), clear fal_url, retry N7c.
// Run from packages/services dir: pnpm exec tsx --env-file=../../.env <this>
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createDbPool, makeLocalStorageAdapter } from '@ugc/db';
import { getSecretsKeyFromEnv } from '@ugc/core/secrets';
import { loadFalKey } from '../../../../packages/services/src/fal-key.ts';
import { runGenerateAvatar } from '../../../../packages/services/src/generate-avatar.ts';

const CONN = 'postgres://ugc:ugc@localhost:55432/ugc_t519';
const ASSETS = process.env.SCRATCH_ASSETS ?? '/tmp/ugc-t519-assets';
const MAYA_REF = '01KYQ8J1GD2NDMG5EJ2YFKWK11';

const { db, pool } = createDbPool(CONN);
const storage = makeLocalStorageAdapter({ root: ASSETS });
const falKey = await loadFalKey(db, getSecretsKeyFromEnv());
const q = async (sql: string): Promise<any[]> => (await pool.query(sql)).rows;

const [ref] = await q(`SELECT storage_key FROM asset WHERE id='${MAYA_REF}'`);
const scratchPath = join(ASSETS, ref.storage_key);
const orig = await readFile(scratchPath);
console.log('orig ref size', orig.length, 'bytes');

// Recompress: keep long edge >=2048, PNG palette+compression to shrink well under 1 MB.
const small = await sharp(orig)
  .resize({ width: 1152, height: 2048, fit: 'inside' }) // long edge 2048
  .png({ compressionLevel: 9, quality: 80, palette: true })
  .toBuffer();
console.log('recompressed size', small.length, 'bytes', `(${(small.length / 1024).toFixed(0)} KB)`);
const meta = await sharp(small).metadata();
console.log('recompressed dims', meta.width, 'x', meta.height, 'longEdge', Math.max(meta.width, meta.height));

// Overwrite ONLY the scratch storage copy (committed fixture untouched).
await writeFile(scratchPath, small);
await pool.query(`UPDATE asset SET fal_url=NULL, fal_uploaded_at=NULL, bytes=${small.length} WHERE id='${MAYA_REF}'`);
console.log('wrote smaller ref into scratch storage + cleared fal_url');

const [avatar] = await q(`SELECT id FROM model_profile WHERE fal_endpoint='fal-ai/bytedance/omnihuman/v1.5'`);
const [audio] = await q(`SELECT id, duration_s FROM asset WHERE kind='tts_audio' ORDER BY id DESC LIMIT 1`);

console.log('=== N7c OmniHuman with SMALLER ref ===');
try {
  const clip = await runGenerateAvatar(
    { db, storage, falKey },
    { avatarModelProfileId: avatar.id, imageAssetId: MAYA_REF, audioAssetId: audio.id, resolution: '720p' },
  );
  console.log('SUCCESS: gen', clip.generation.id, 'fal_req', clip.generation.falRequestId);
  console.log('  clip asset', clip.assetId, 'dur', clip.durationSeconds, 's cost', clip.costCents, 'c reused', clip.reused);
  const [ca] = await q(`SELECT storage_key, bytes FROM asset WHERE id='${clip.assetId}'`);
  console.log('CLIP storage_key:', ca.storage_key, 'bytes', ca.bytes);
  console.log('CONCLUSION: SIZE was the cause => T5.19 fixture is too large for OmniHuman fetcher (DEFECT).');
} catch (e: any) {
  console.log('STILL FAILED:', e?.status, e?.message);
  console.log('CONCLUSION: size is NOT the discriminator (or fal-side host issue persists).');
}
await pool.end();
