// T5.19 Parte B — generate ONE real N7c avatar clip from Maya's seeded reference PHOTO.
// Stepless (documented invocation surface of generate-avatar.ts). Runs against the scratch DB ugc_t519
// (seeded from zero) + scratch ASSETS_DIR. HARD pre-spend gate: abort if projected/actual > $1.00.
//
// Flow: N7b (short ~3s Spanish hook, eleven-v3 TTS + ASR) -> gate on audio duration*16c<100c -> N7c OmniHuman.
import { createDbPool, makeLocalStorageAdapter } from '@ugc/db';
import { getSecretsKeyFromEnv } from '@ugc/core/secrets';
import { loadFalKey } from './src/fal-key.ts';
import { runGenerateAudio } from './src/generate-audio.ts';
import { runGenerateAvatar } from './src/generate-avatar.ts';

const CONN = 'postgres://ugc:ugc@localhost:55432/ugc_t519';
const ASSETS = process.env.SCRATCH_ASSETS ?? '/tmp/ugc-t519-assets';
const ABORT_CENTS = 100; // hard abort at $1.00

const { db, pool } = createDbPool(CONN);
const storage = makeLocalStorageAdapter({ root: ASSETS });
const falKey = await loadFalKey(db, getSecretsKeyFromEnv());
console.log('fal key loaded (len', falKey.length, ')');

// Resolve ids from the scratch DB (passed as env to avoid hardcoding).
const q = async (sql: string): Promise<any[]> => (await pool.query(sql)).rows;
const [maya] = await q(
  `SELECT (reference_image_ids)[1] AS ref, name FROM persona WHERE name='Maya'`,
);
const [tts] = await q(
  `SELECT id FROM model_profile WHERE fal_endpoint='fal-ai/elevenlabs/tts/eleven-v3'`,
);
const [asr] = await q(
  `SELECT id FROM model_profile WHERE fal_endpoint='fal-ai/elevenlabs/speech-to-text'`,
);
const [avatar] = await q(
  `SELECT id, cost FROM model_profile WHERE fal_endpoint='fal-ai/bytedance/omnihuman/v1.5'`,
);
console.log('Maya ref#1 asset:', maya.ref);
console.log('tts profile:', tts.id, '| asr profile:', asr.id, '| avatar profile:', avatar.id, avatar.cost);

// ── N7b: short hook, one sentence (~3s of speech) ──────────────────────────────
const narration = 'Hola, mira este producto que de verdad me encantó.';
console.log('\n=== N7b TTS+ASR (short hook) ===');
const audio = await runGenerateAudio(
  { db, storage, falKey },
  {
    ttsModelProfileId: tts.id,
    asrModelProfileId: asr.id,
    narration,
    ttsInputs: { voice: 'EXAVITQu4vr4xnSDxMaL', language_code: 'es' },
    asrLanguageCode: 'spa',
  },
);
console.log('N7b done: audio asset', audio.assetId, '| dur', audio.durationSeconds, 's |',
  'ttsCost', audio.ttsCostCents, 'c | asrCost', audio.asrCostCents, 'c | reused', audio.reused);

// ── HARD PRE-SPEND GATE on N7c ─────────────────────────────────────────────────
const avatarCentsPerSec = Number(avatar.cost.amountCents);
const projectedN7c = audio.durationSeconds * avatarCentsPerSec;
console.log('\n=== N7c PRE-SPEND GATE ===');
console.log(`projected N7c = ${audio.durationSeconds}s * ${avatarCentsPerSec}c/s = ${projectedN7c.toFixed(1)}c`);
if (projectedN7c >= ABORT_CENTS) {
  console.error(`ABORT: projected ${projectedN7c.toFixed(1)}c >= ${ABORT_CENTS}c cap. Not submitting N7c.`);
  await pool.end();
  process.exit(2);
}
console.log(`GATE OK: ${projectedN7c.toFixed(1)}c < ${ABORT_CENTS}c => submitting N7c`);

// ── N7c: OmniHuman avatar clip from Maya's PHOTO ───────────────────────────────
console.log('\n=== N7c OmniHuman avatar (Maya photo + hook audio) ===');
const clip = await runGenerateAvatar(
  { db, storage, falKey },
  {
    avatarModelProfileId: avatar.id,
    imageAssetId: maya.ref, // reference #1 = frontal headshot (same slot as the chibi incident)
    audioAssetId: audio.assetId,
    resolution: '720p',
  },
);
console.log('N7c done:');
console.log('  generation:', clip.generation.id, '| fal_request_id:', clip.generation.falRequestId);
console.log('  clip asset:', clip.assetId, '| dur', clip.durationSeconds, 's');
console.log('  cost:', clip.costCents, 'c | reused:', clip.reused);
if (clip.reused) {
  console.error('WARNING: N7c was a DEDUP HIT (reused) — not a fresh generation. Investigate.');
}
if (clip.warnings.length) console.log('  warnings:', clip.warnings);

// Resolve the clip storage key for the caller to extract a frame.
const [clipAsset] = await q(
  `SELECT storage_key, bytes, duration_s FROM asset WHERE id='${clip.assetId}'`,
);
console.log('\nCLIP storage_key:', clipAsset.storage_key, '| bytes', clipAsset.bytes, '| dur', clipAsset.duration_s);
console.log('TOTAL Parte B cost:', (audio.ttsCostCents + audio.asrCostCents + clip.costCents), 'c');
await pool.end();
console.log('DONE');
