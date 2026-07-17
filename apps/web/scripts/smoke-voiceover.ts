// Smoke de la Verificación de T4.5 (§7.2 N7b + §13.1, cadena TTS→ASR): para un guion REAL de la BD,
// sintetiza un voiceover POR ESCENA con el TTS del tier y encadena el ASR para los word timestamps.
// Es el MISMO camino de PRODUCCIÓN que el executor N7b (`getScriptById` → `AdScriptSchema` →
// `resolveVoiceStep` → `runGenerateAudio`), conducido STEPLESS (sin run/DAG — eso es T4.11). Imprime
// lo que el verifier presenta al usuario para su JUICIO HUMANO (¿suena bien en idioma y voz?) y lo que
// comprueba a mano: por escena → generation completed, asset `tts_audio` descargable, `word_timestamps`
// cubriendo el 100% de las palabras, y los 2 cost_entry (TTS chars + ASR seconds).
//
// La Verificación pide UN guion `es` y otro `en`: se corre DOS VECES con distinta config (SCRIPT_ID +
// TTS_ENDPOINT + PROVIDER + VOICE + LANGUAGE). El TRIPLE (endpoint+provider+voz) DEBE ser consistente
// por tier. AMBAS combinaciones VERIFICADAS EN VIVO (2026-07-16) — cadena TTS→ASR completa con
// cobertura 100%:
//   · en (TEST tier): TTS_ENDPOINT=fal-ai/kokoro PROVIDER=kokoro VOICE=af_heart LANGUAGE=en.
//     El endpoint base `fal-ai/kokoro` SOLO expone voces inglesas `af_/am_` (su enum rechaza voces es
//     con 422 — confirmado en vivo); por eso el `es` NO corre en el tier test.
//   · es (STANDARD tier): TTS_ENDPOINT=fal-ai/elevenlabs/tts/turbo-v2.5 PROVIDER=elevenlabs
//     VOICE=Rachel LANGUAGE=es. ElevenLabs turbo es multilingüe (usa el campo `text`, no `prompt` —
//     el servicio lo deriva del endpoint) y produce audio español correcto con ASR al 100%.
//     (`Rachel` es la voz multilingüe por defecto; sustitúyela por el voiceId es del voice_map real de
//     la Persona cuando T4.11 cablee la resolución completa.)
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY, SCRIPT_ID, TTS_ENDPOINT, VOICE, LANGUAGE (es|en),
//      PROVIDER (kokoro|elevenlabs, default kokoro), [SPEED]. RED REAL.
// Turnkey (en): SCRIPT_ID=<id-guion-en> TTS_ENDPOINT=fal-ai/kokoro PROVIDER=kokoro VOICE=af_heart \
//   LANGUAGE=en  pnpm --filter @ugc/web smoke:voiceover
// Turnkey (es): SCRIPT_ID=<id-guion-es> TTS_ENDPOINT=fal-ai/elevenlabs/tts/turbo-v2.5 \
//   PROVIDER=elevenlabs VOICE=Rachel LANGUAGE=es  pnpm --filter @ugc/web smoke:voiceover
import { makeLogger } from '@ugc/core/observability';
import { AdScriptSchema } from '@ugc/core/contracts';
import { resolveVoiceStep, type VoiceProvider } from '@ugc/core/persona';
import {
  createDb,
  getAsset,
  getModelProfileByEndpoint,
  getScriptById,
  makeLocalStorageAdapter,
} from '@ugc/db';
import { runGenerateAudio } from '@ugc/services';
import { computeWordCoverage, WordTimestampsSchema } from '@ugc/core/generation';

const ASR_ENDPOINT = 'fal-ai/elevenlabs/speech-to-text';
const ASR_LANGUAGE_CODE: Record<string, string> = { es: 'spa', en: 'eng' };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:voiceover: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');
  const scriptId = requireEnv('SCRIPT_ID');
  const ttsEndpoint = requireEnv('TTS_ENDPOINT');
  const voice = requireEnv('VOICE');
  const language = requireEnv('LANGUAGE');
  const provider = (process.env.PROVIDER ?? 'kokoro') as VoiceProvider;
  const speed = process.env.SPEED ? Number(process.env.SPEED) : undefined;

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  // Camino de PRODUCCIÓN: leer la fila `ad_script` REAL y validar su jsonb `scenes[]` (no castear).
  const scriptRow = await getScriptById(db, scriptId);
  if (scriptRow === undefined) {
    console.error(`smoke:voiceover: el guion ${scriptId} no existe`);
    process.exit(1);
  }
  const script = AdScriptSchema.pick({ scenes: true, language: true }).parse({
    scenes: scriptRow.scenes,
    language: scriptRow.language,
  });
  console.log(
    `smoke:voiceover: guion ${scriptId} — idioma fila=${script.language}, ${String(script.scenes.length)} escenas`,
  );

  const [ttsProfile, asrProfile] = await Promise.all([
    getModelProfileByEndpoint(db, ttsEndpoint),
    getModelProfileByEndpoint(db, ASR_ENDPOINT),
  ]);
  if (ttsProfile === undefined) {
    console.error(
      `smoke:voiceover: no existe el model_profile TTS ${ttsEndpoint}. Siembra: pnpm seed:gallery`,
    );
    process.exit(1);
  }
  if (asrProfile === undefined) {
    console.error(
      `smoke:voiceover: no existe el model_profile ASR ${ASR_ENDPOINT}. Siembra: pnpm seed:gallery`,
    );
    process.exit(1);
  }

  // Resolución MÍNIMA: valida coherencia proveedor↔endpoint↔voz (mismatch → lanza, no coerción).
  const voiceInputs = resolveVoiceStep({
    provider,
    ttsEndpoint,
    voice,
    ...(speed !== undefined ? { speed } : {}),
  });
  const asrLanguageCode = ASR_LANGUAGE_CODE[language];

  console.log(
    `smoke:voiceover: TTS ${ttsEndpoint} (voz ${voice}) → ASR ${ASR_ENDPOINT} (${asrLanguageCode ?? 'autodetect'}) — RED REAL…\n`,
  );

  let totalCents = 0;
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (scene === undefined) continue;
    const res = await runGenerateAudio(
      { db, storage, falKey, logger },
      {
        ttsModelProfileId: ttsProfile.id,
        asrModelProfileId: asrProfile.id,
        narration: scene.narration,
        ttsInputs: {
          voice: voiceInputs.voice,
          ...(voiceInputs.speed !== undefined ? { speed: voiceInputs.speed } : {}),
          // ElevenLabs turbo es multilingüe: pasarle `language_code` (ISO-639-1, p. ej. `es`) fija el
          // idioma de síntesis (verificado en vivo). kokoro NO tiene ese parámetro (idioma implícito en
          // la voz), así que solo se añade para elevenlabs.
          ...(provider === 'elevenlabs' ? { language_code: language } : {}),
        },
        ...(asrLanguageCode !== undefined ? { asrLanguageCode } : {}),
      },
    );
    totalCents += res.ttsCostCents + res.asrCostCents;

    // Re-leer el asset para EVIDENCIAR los word_timestamps sellados + cobertura 100%.
    const asset = await getAsset(db, res.assetId);
    const wt = WordTimestampsSchema.parse(asset?.wordTimestamps);
    const cov = computeWordCoverage(wt);
    const sceneNum = i + 1;
    console.log(
      `smoke:voiceover: escena ${String(sceneNum)}/${String(script.scenes.length)} — generation ${res.generation.id} (${res.generation.status}), ` +
        `asset ${res.assetId} (tts_audio, ${res.durationSeconds.toFixed(2)}s), ` +
        `cobertura ${String(cov.timedWordCount)}/${String(cov.wordCount)} ${cov.fullyCovered ? 'OK ✓' : 'INCOMPLETA ✗'}, ` +
        `TTS ${String(res.ttsCostCents)}¢ + ASR ${String(res.asrCostCents)}¢ — GET /api/assets/${res.assetId}/download`,
    );
    // Onset de las 3 primeras palabras (para el juicio de waveform del usuario: <±100ms vs Audacity).
    const firstThree = wt.words.filter((w) => w.type === 'word').slice(0, 3);
    console.log(
      `smoke:voiceover:   onset 3 palabras → ${firstThree.map((w) => `"${w.text}"@${String(w.start)}s`).join('  ')}`,
    );
    console.log(`smoke:voiceover:   narración = "${scene.narration}"`);
  }

  console.log(
    `\nsmoke:voiceover: OK ✓ — ${String(script.scenes.length)} voiceovers, coste total ${String(totalCents)}¢ (→ /spend). ` +
      `Descarga los audios y JÚZGALOS: ¿suenan correctos en idioma (${language}) y voz esperada? ` +
      `Mide en Audacity/ffmpeg astats el onset de 3 palabras vs los timestamps de arriba (<±100ms).`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:voiceover: falló', err);
  process.exit(1);
});
