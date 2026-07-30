// T5.26 verifier — Clause 1 point 3 (resolution via PRODUCTION path) + Clause 2 end-to-end regen.
// Adapted from docs/verifications/T5.9/rescoped-2026-07-30/voices/n7b-voices.ts (the 30/07 run).
//
// Reads Maya's voice_map from the SCRATCH DB (ugc_t526, re-seeded from scratch by `pnpm seed`), resolves
// the es triple through the PRODUCTION resolver (resolveVoiceTriple: premium recipe TTS endpoint ×
// Maya.voiceMap['es']), and ASSERTS the resolved voice === '6Pd8chnUWvPJasJAi15C' (Afrodita) — NOT a
// hardcoded voiceId, read from the DB the seed wrote. Then runs ONE es voiceover via runGenerateAudio to
// prove the seed-fixed Afrodita produces a `completed` tts_audio with word_timestamps and that fal accepts
// it FROM THE SEED (not only from the ad-hoc shortlist). reused===false is structural (scratch DB, no prior
// tts_audio). HARD abort at $0.10 accumulated fal spend (verifier mandate).
import { createDbPool, makeLocalStorageAdapter, getRecipe, getModelProfileByEndpoint, seedSecretIfAbsent } from '@ugc/db';
import { getSecretsKeyFromEnv, encryptSecret } from '@ugc/core/secrets';
import { resolveVoiceTriple, type VoiceMap } from '@ugc/core/generation';
import { loadFalKey, runGenerateAudio } from '@ugc/services';

const CONN = process.env.DATABASE_URL ?? 'postgres://ugc:ugc@localhost:55432/ugc_t526';
const ASSETS = process.env.ASSETS_DIR ?? '/tmp/ugc-assets-t526';
const ABORT_CENTS = 10; // hard abort at $0.10 (verifier mandate for T5.26)
const EXPECTED_AFRODITA = '6Pd8chnUWvPJasJAi15C';

const { db, pool } = createDbPool(CONN);
const storage = makeLocalStorageAdapter({ root: ASSETS });
// Scenario prep (allowed): the scratch DB has no app_setting rows; seed the fal secret CIFRADO exactly
// as web boot does (seedSecretIfAbsent + encryptSecret + getSecretsKeyFromEnv), from env FAL_KEY.
const secretsKey = getSecretsKeyFromEnv();
if (process.env.FAL_KEY) {
  const seeded = await seedSecretIfAbsent(db, 'fal', encryptSecret(process.env.FAL_KEY, secretsKey));
  console.log('fal secret seeded into scratch DB:', seeded);
}
const falKey = await loadFalKey(db, secretsKey);
console.log('fal key loaded (len', falKey.length, ') | DB:', CONN);

const q = async (sql: string): Promise<Record<string, unknown>[]> => (await pool.query(sql)).rows;

// ── Read Maya's voice_map + the PREMIUM recipe from the SCRATCH DB (no hardcoded voiceId) ──────────
const [maya] = await q(`SELECT name, voice_map FROM persona WHERE name='Maya'`);
if (maya === undefined) throw new Error('Maya persona not found in scratch DB');
const voiceMap = maya.voice_map as VoiceMap;
console.log('Maya voice_map (from re-seeded DB):', JSON.stringify(voiceMap));

const recipe = await getRecipe(db, 'premium');
if (recipe === undefined) throw new Error('premium recipe not seeded');

// ── Resolve the es triple through the PRODUCTION resolver ──────────────────────────────────────────
const tripleEs = resolveVoiceTriple(recipe, voiceMap, 'es');
console.log('\nRESOLVED (production resolveVoiceTriple):');
console.log('  es ->', JSON.stringify(tripleEs));

// ── ASSERTION (clause 1 point 3): the production resolver yields Afrodita, read from the seed's voice_map ──
if (tripleEs.voice !== EXPECTED_AFRODITA) {
  console.error(`❌ FAIL: resolved es voice '${tripleEs.voice}' !== expected Afrodita '${EXPECTED_AFRODITA}'`);
  await pool.end();
  process.exit(1);
}
console.log(`✓ ASSERT OK: resolveVoiceTriple(premium, Maya.voice_map, 'es').voice === '${EXPECTED_AFRODITA}' (Afrodita)`);

const ttsEs = await getModelProfileByEndpoint(db, tripleEs.ttsEndpoint);
const asrProfile = await getModelProfileByEndpoint(db, 'fal-ai/elevenlabs/speech-to-text');
if (ttsEs === undefined || asrProfile === undefined) throw new Error('TTS/ASR profile not seeded');

// ── Clause 2 end-to-end: ONE es voiceover via the production path from the SEED-fixed Afrodita ──────
const NARRATION_ES =
  'Llevo semanas probando esta crema hidratante y de verdad ha cambiado mi piel. ' +
  'Se absorbe al instante, no deja sensación grasa y por la mañana noto la cara mucho más suave. ' +
  'Si buscas algo sencillo que funcione, esta es la que yo recomiendo.';

const ttsInputs: Record<string, unknown> = { voice: tripleEs.voice, language_code: 'es' };
console.log('\n=== N7b voiceover [es] via runGenerateAudio ===');
console.log('  ttsInputs:', JSON.stringify(ttsInputs), '| endpoint:', tripleEs.ttsEndpoint);

const ttsCostCents = Number(ttsEs.cost.amountCents);
const projectedTts = Math.ceil((NARRATION_ES.length / 1000) * ttsCostCents);
console.log(`  projected TTS ~= ceil(${NARRATION_ES.length}/1000 * ${ttsCostCents}c) = ${projectedTts}c`);
if (projectedTts + 3 >= ABORT_CENTS) {
  console.error(`ABORT: projected ${projectedTts}c + asr near cap ${ABORT_CENTS}c. Not submitting.`);
  await pool.end();
  process.exit(1);
}

const res = await runGenerateAudio(
  { db, storage, falKey },
  {
    ttsModelProfileId: ttsEs.id,
    asrModelProfileId: asrProfile.id,
    narration: NARRATION_ES,
    ttsInputs,
    asrLanguageCode: 'spa',
  },
);
console.log('  N7b done [es]:');
console.log('    generation:', res.generation.id, '| fal_request_id:', res.generation.falRequestId);
console.log('    audio asset:', res.assetId, '| dur', res.durationSeconds, 's | words', res.wordCount);
console.log('    ttsCost', res.ttsCostCents, 'c | asrCost', res.asrCostCents, 'c | reused', res.reused);
if (res.reused) {
  console.error('  ❌ DEDUP HIT: reused=true — returned an existing asset, proves nothing. FAIL.');
  await pool.end();
  process.exit(1);
}
if (res.warnings.length) console.log('    warnings:', res.warnings);

const acc = res.ttsCostCents + res.asrCostCents;
console.log(`\nTOTAL fal spend (this script): ${acc}c = $${(acc / 100).toFixed(2)}`);
console.log('AUDIO_ASSET_ID=' + res.assetId);
await pool.end();
console.log('DONE');
