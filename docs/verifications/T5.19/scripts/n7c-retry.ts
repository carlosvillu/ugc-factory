// T5.19 Parte B RETRY — the first N7c attempt hit a fal-side transient file_download_error on image_url
// (fal could not fetch its OWN uploaded reference during inference; the fal.media URL is externally 200).
// Reuse the already-completed N7b audio asset; retry only N7c. Same hard gate.
import { createDbPool, makeLocalStorageAdapter } from '@ugc/db';
import { getSecretsKeyFromEnv } from '@ugc/core/secrets';
import { loadFalKey } from './src/fal-key.ts';
import { runGenerateAvatar } from './src/generate-avatar.ts';

const CONN = 'postgres://ugc:ugc@localhost:55432/ugc_t519';
const ASSETS = process.env.SCRATCH_ASSETS ?? '/tmp/ugc-t519-assets';
const ABORT_CENTS = 100;

const { db, pool } = createDbPool(CONN);
const storage = makeLocalStorageAdapter({ root: ASSETS });
const falKey = await loadFalKey(db, getSecretsKeyFromEnv());
const q = async (sql: string): Promise<any[]> => (await pool.query(sql)).rows;

const [maya] = await q(`SELECT (reference_image_ids)[1] AS ref FROM persona WHERE name='Maya'`);
const [avatar] = await q(
  `SELECT id, cost FROM model_profile WHERE fal_endpoint='fal-ai/bytedance/omnihuman/v1.5'`,
);
// The completed TTS audio asset from the first run.
const [audio] = await q(
  `SELECT a.id, a.duration_s FROM asset a WHERE a.kind='tts_audio' ORDER BY a.id DESC LIMIT 1`,
);
console.log('reusing audio asset', audio.id, 'dur', audio.duration_s, 's');

const projected = Number(audio.duration_s) * Number(avatar.cost.amountCents);
console.log(`projected N7c = ${audio.duration_s}s * ${avatar.cost.amountCents}c/s = ${projected.toFixed(1)}c`);
if (projected >= ABORT_CENTS) {
  console.error(`ABORT: ${projected.toFixed(1)}c >= ${ABORT_CENTS}c`);
  await pool.end();
  process.exit(2);
}

console.log('=== N7c OmniHuman RETRY ===');
const clip = await runGenerateAvatar(
  { db, storage, falKey },
  {
    avatarModelProfileId: avatar.id,
    imageAssetId: maya.ref,
    audioAssetId: audio.id,
    resolution: '720p',
  },
);
console.log('N7c done: gen', clip.generation.id, 'fal_req', clip.generation.falRequestId);
console.log('  clip asset', clip.assetId, 'dur', clip.durationSeconds, 's cost', clip.costCents, 'c reused', clip.reused);
const [ca] = await q(`SELECT storage_key, bytes, duration_s FROM asset WHERE id='${clip.assetId}'`);
console.log('CLIP storage_key:', ca.storage_key, 'bytes', ca.bytes, 'dur', ca.duration_s);
await pool.end();
console.log('DONE');
