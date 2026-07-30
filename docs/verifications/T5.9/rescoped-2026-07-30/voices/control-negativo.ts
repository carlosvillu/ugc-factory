// T5.9 (c') Control negativo — prove resolveVoiceTriple DISCRIMINATES (it doesn't pass anything through).
// $0, no fal calls. Two red cases:
//   A) A persona whose voice_map covers the language but with a placeholder voiceId → resolveVoiceStep
//      inside resolveVoiceTriple must NOT silently accept it as a real eleven-v3 voice... but placeholder
//      IDs ARE structurally elevenlabs, so the sharper red is an UNMAPPED language.
//   B) Unmapped language (persona has no voice for 'fr') → PermanentStepError.
// If Maya's map resolved fine (proven live) but these throw, the resolver is doing real work.
import { createDbPool, getRecipe } from '@ugc/db';
import { resolveVoiceTriple, type VoiceMap } from '@ugc/core/generation';

const CONN = process.env.DATABASE_URL ?? 'postgres://ugc:ugc@localhost:55432/ugc';
const { db, pool } = createDbPool(CONN);
const q = async (sql: string): Promise<Record<string, unknown>[]> => (await pool.query(sql)).rows;

const recipe = await getRecipe(db, 'premium');
if (recipe === undefined) throw new Error('premium recipe missing');

const [maya] = await q(`SELECT voice_map FROM persona WHERE name='Maya'`);
const mayaMap = maya!.voice_map as VoiceMap;

function tryResolve(label: string, map: VoiceMap, lang: string): void {
  try {
    const t = resolveVoiceTriple(recipe!, map, lang);
    console.log(`[${label}] NO THROW (resolved ${JSON.stringify(t)})`);
  } catch (e) {
    console.log(`[${label}] THROW ${(e as Error).constructor.name}: ${(e as Error).message}`);
  }
}

console.log('=== POSITIVE control (must resolve) ===');
tryResolve('Maya es', mayaMap, 'es');
tryResolve('Maya en', mayaMap, 'en');

console.log('\n=== NEGATIVE control (must THROW) ===');
// B) Unmapped language: Maya has no 'fr' → PermanentStepError.
tryResolve('Maya fr (unmapped)', mayaMap, 'fr');
// A) A voice_map with a KOKORO voice but the premium endpoint is elevenlabs eleven-v3 → provider↔endpoint
//    mismatch must be caught by resolveVoiceStep inside resolveVoiceTriple.
tryResolve('kokoro voice on eleven-v3 endpoint (es)', { es: { provider: 'kokoro', voiceId: 'af_heart' } } as unknown as VoiceMap, 'es');
// A') empty voice_map → no voice for language → throw.
tryResolve('empty voice_map (es)', {} as VoiceMap, 'es');

await pool.end();
