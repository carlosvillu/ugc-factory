// T5.9 re-scoped — Clause (c') / criterion 22.8: capture Maya's es+en voiceovers via the N7b path,
// driven through the PRODUCTION voice resolver (resolveVoiceTriple: premium recipe voice endpoint ×
// Maya.voiceMap[language]), NOT a hardcoded voiceId. Proves "voices correspond to the persona's voice_map".
//
// Runs stepless against the DEV DB (DATABASE_URL / ASSETS_DIR from .env) so the ledger counts against the
// real dev store. HARD abort at $3.00 accumulated fal spend (verifier mandate). Asserts reused===false on
// both (a dedup hit would return someone else's asset at $0 and prove nothing about Maya's current map).
import { createDbPool, makeLocalStorageAdapter, getRecipe, getModelProfileByEndpoint } from '@ugc/db';
import { getSecretsKeyFromEnv } from '@ugc/core/secrets';
import { resolveVoiceTriple, type VoiceMap } from '@ugc/core/generation';
import { loadFalKey, runGenerateAudio } from '@ugc/services';

const CONN = process.env.DATABASE_URL ?? 'postgres://ugc:ugc@localhost:55432/ugc';
const ASSETS = process.env.ASSETS_DIR ?? '/tmp/ugc-assets-dev';
const ABORT_CENTS = 300; // hard abort at $3.00 (verifier mandate)

const { db, pool } = createDbPool(CONN);
const storage = makeLocalStorageAdapter({ root: ASSETS });
const falKey = await loadFalKey(db, getSecretsKeyFromEnv());
console.log('fal key loaded (len', falKey.length, ')');

const q = async (sql: string): Promise<Record<string, unknown>[]> => (await pool.query(sql)).rows;

// ── Read Maya's voice_map + the PREMIUM recipe from the DEV DB (no hardcoded voiceId) ──────────────
const [maya] = await q(`SELECT name, voice_map FROM persona WHERE name='Maya'`);
if (maya === undefined) throw new Error('Maya persona not found in DEV DB');
const voiceMap = maya.voice_map as VoiceMap;
console.log('Maya voice_map:', JSON.stringify(voiceMap));

const recipe = await getRecipe(db, 'premium');
if (recipe === undefined) throw new Error('premium recipe not seeded');

const asrProfile = await getModelProfileByEndpoint(db, 'fal-ai/elevenlabs/speech-to-text');
if (asrProfile === undefined) throw new Error('ASR profile not seeded');

// ── Resolve the triple through the PRODUCTION resolver, one per language ────────────────────────────
const tripleEs = resolveVoiceTriple(recipe, voiceMap, 'es');
const tripleEn = resolveVoiceTriple(recipe, voiceMap, 'en');
console.log('\nRESOLVED (production resolveVoiceTriple):');
console.log('  es ->', JSON.stringify(tripleEs));
console.log('  en ->', JSON.stringify(tripleEn));

const ttsEs = await getModelProfileByEndpoint(db, tripleEs.ttsEndpoint);
const ttsEn = await getModelProfileByEndpoint(db, tripleEn.ttsEndpoint);
if (ttsEs === undefined || ttsEn === undefined) throw new Error('TTS profile not seeded');

// ── Comparable ad copy, one per language, distinct texts (avoid content_hash dedup collision) ───────
const NARRATION_ES =
  'Llevo semanas probando esta crema hidratante y de verdad ha cambiado mi piel. ' +
  'Se absorbe al instante, no deja sensación grasa y por la mañana noto la cara mucho más suave. ' +
  'Si buscas algo sencillo que funcione, esta es la que yo recomiendo.';
const NARRATION_EN =
  'I have been testing this moisturizing cream for a few weeks and it genuinely transformed my skin. ' +
  'It absorbs instantly, never feels greasy, and every morning my face looks noticeably smoother. ' +
  'If you want something simple that actually works, this is the one I recommend.';

// ASR language codes (ISO-639-3) matching the executor's ASR_LANGUAGE_CODE map.
const ASR_LANG: Record<string, string> = { es: 'spa', en: 'eng' };

interface Row {
  lang: 'es' | 'en';
  triple: typeof tripleEs;
  ttsProfileId: string;
  ttsCostCents: number;
  narration: string;
}
const runs: Row[] = [
  { lang: 'es', triple: tripleEs, ttsProfileId: ttsEs.id, ttsCostCents: Number(ttsEs.cost.amountCents), narration: NARRATION_ES },
  { lang: 'en', triple: tripleEn, ttsProfileId: ttsEn.id, ttsCostCents: Number(ttsEn.cost.amountCents), narration: NARRATION_EN },
];

let acc = 0;
for (const r of runs) {
  console.log(`\n=== N7b voiceover [${r.lang}] ===`);
  // The ttsInputs mirror what generate-voice.ts builds: voice + (for elevenlabs) language_code.
  const ttsInputs: Record<string, unknown> = { voice: r.triple.voice };
  if (r.triple.provider === 'elevenlabs') ttsInputs.language_code = r.lang;
  console.log('  ttsInputs:', JSON.stringify(ttsInputs), '| endpoint:', r.triple.ttsEndpoint);

  const projectedTts = Math.ceil((r.narration.length / 1000) * r.ttsCostCents);
  console.log(`  projected TTS ~= ceil(${r.narration.length}/1000 * ${r.ttsCostCents}c) = ${projectedTts}c`);
  if (acc + projectedTts + 10 >= ABORT_CENTS) {
    console.error(`ABORT: acc ${acc}c + projected ${projectedTts}c near cap ${ABORT_CENTS}c. Not submitting.`);
    break;
  }

  const res = await runGenerateAudio(
    { db, storage, falKey },
    {
      ttsModelProfileId: r.ttsProfileId,
      asrModelProfileId: asrProfile.id,
      narration: r.narration,
      ttsInputs,
      asrLanguageCode: ASR_LANG[r.lang],
    },
  );
  console.log(`  N7b done [${r.lang}]:`);
  console.log('    generation:', res.generation.id, '| fal_request_id:', res.generation.falRequestId);
  console.log('    audio asset:', res.assetId, '| dur', res.durationSeconds, 's | words', res.wordCount);
  console.log('    ttsCost', res.ttsCostCents, 'c | asrCost', res.asrCostCents, 'c | reused', res.reused);
  if (res.reused) {
    console.error(`  ❌ DEDUP HIT [${r.lang}]: reused=true — returned an existing asset, proves nothing. FAIL.`);
  }
  if (res.warnings.length) console.log('    warnings:', res.warnings);
  acc += res.ttsCostCents + res.asrCostCents;
  console.log(`    accumulated fal spend: ${acc}c`);
}

console.log(`\nTOTAL fal spend (this script): ${acc}c = $${(acc / 100).toFixed(2)}`);
await pool.end();
console.log('DONE');
