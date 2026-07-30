// T5.26 Control negativo — $0, no fal calls. Proves the correspondence assertion DISCRIMINATES and that
// isSeedBatchCapable still selects Maya. Runs ENTIRELY in this script — product code is NEVER edited
// (verifier rule). Reads the premium recipe from the scratch DB; builds voice_maps IN-MEMORY.
//
// RED case A (the core of T5.26): revert Maya's es to Sarah 'EXAVITQu4vr4xnSDxMaL' in a local voice_map and
//   run it through the SAME production resolveVoiceTriple + the SAME assertion the PASS uses. The assertion
//   MUST bite (resolved voice = Sarah != Afrodita) → prints FAIL/Expected. If it did NOT bite, the check is
//   vacuous and the PASS proves nothing.
// RED case B: isSeedBatchCapable on a Maya whose es voiceId is 'placeholder-es' MUST go false (a placeholder
//   voice makes the persona NOT batch-capable). And Afrodita '6Pd8...' does NOT start with 'placeholder-' →
//   real Maya stays true → Maya remains the unique batch-capable persona.
import { createDbPool, getRecipe } from '@ugc/db';
import { resolveVoiceTriple, type VoiceMap } from '@ugc/core/generation';
import { PERSONA_SEEDS, isSeedBatchCapable } from '@ugc/core/persona/server';

const CONN = process.env.DATABASE_URL ?? 'postgres://ugc:ugc@localhost:55432/ugc_t526';
const EXPECTED_AFRODITA = '6Pd8chnUWvPJasJAi15C';
const SARAH = 'EXAVITQu4vr4xnSDxMaL';

const { db, pool } = createDbPool(CONN);
const recipe = await getRecipe(db, 'premium');
if (recipe === undefined) throw new Error('premium recipe missing');

let redProven = true;

// ── RED case A: revert to Sarah → the correspondence assertion MUST bite ──────────────────────────
console.log('=== RED case A: revert Maya.es to Sarah, run the SAME assertion the PASS uses ===');
const revertedMap: VoiceMap = {
  es: { provider: 'elevenlabs', voiceId: SARAH },
  en: { provider: 'elevenlabs', voiceId: 'Rachel' },
};
const tripleReverted = resolveVoiceTriple(recipe, revertedMap, 'es');
console.log(`  resolved es voice = '${tripleReverted.voice}'`);
if (tripleReverted.voice === EXPECTED_AFRODITA) {
  console.error('  ❌ UNEXPECTED: assertion did NOT bite (reverted map still resolved to Afrodita)');
  redProven = false;
} else {
  console.log(`  ✓ ASSERTION BITES → FAIL: Expected voice '${EXPECTED_AFRODITA}' (Afrodita) but resolved '${tripleReverted.voice}' (Sarah). ROJO.`);
}

// Sanity: the real seeded map DOES resolve to Afrodita (positive control).
const realMaya = PERSONA_SEEDS.find((p) => p.name === 'Maya');
if (realMaya === undefined) throw new Error('Maya seed not found');
const tripleReal = resolveVoiceTriple(recipe, realMaya.voiceMap as VoiceMap, 'es');
console.log(`  [positive control] real seed resolves es -> '${tripleReal.voice}' (expect Afrodita: ${tripleReal.voice === EXPECTED_AFRODITA ? 'OK' : 'MISMATCH'})`);

// ── RED case B: isSeedBatchCapable discriminates on placeholder voiceId ────────────────────────────
console.log('\n=== RED case B: isSeedBatchCapable ===');
const realCapable = isSeedBatchCapable(realMaya);
console.log(`  isSeedBatchCapable(real Maya, es=Afrodita '${EXPECTED_AFRODITA}') = ${realCapable} (expect true)`);
const placeholderMaya = { ...realMaya, voiceMap: { es: { provider: 'elevenlabs' as const, voiceId: 'placeholder-es' }, en: { provider: 'elevenlabs' as const, voiceId: 'Rachel' } } };
const placeholderCapable = isSeedBatchCapable(placeholderMaya);
console.log(`  isSeedBatchCapable(Maya with es='placeholder-es') = ${placeholderCapable} (expect false)`);
if (!realCapable) { console.error('  ❌ real Maya went NOT batch-capable — Afrodita wrongly looks like a placeholder'); redProven = false; }
if (placeholderCapable) { console.error('  ❌ placeholder voice stayed batch-capable — predicate does not bite'); redProven = false; }
if (realCapable && !placeholderCapable) console.log('  ✓ predicate discriminates: Afrodita→true, placeholder→false (Maya stays batch-capable)');

// Maya is the unique batch-capable persona in the seed.
const capableNames = PERSONA_SEEDS.filter(isSeedBatchCapable).map((p) => p.name);
console.log(`  batch-capable personas in seed: [${capableNames.join(', ')}] (expect exactly [Maya])`);
if (capableNames.length !== 1 || capableNames[0] !== 'Maya') { console.error('  ❌ Maya is not the unique batch-capable persona'); redProven = false; }

await pool.end();
console.log(redProven ? '\nCONTROL NEGATIVO: ROJO probado (asserts bite).' : '\nCONTROL NEGATIVO: NO probado — revisar.');
process.exit(redProven ? 0 : 1);
