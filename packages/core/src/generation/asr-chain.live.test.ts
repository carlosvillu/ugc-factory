// TIER LIVE (external-apis.md §8) — T4.5: verifica el CONTRATO real de la cadena TTS→ASR que los mocks
// asumen y CIERRA el [verificar] per-model observándolo contra la API real:
//   · el TTS de kokoro devuelve `{audio:{url}}` y NO trae word timestamps nativos → ASR es la ruta por
//     defecto (§13.1);
//   · el ASR `fal-ai/elevenlabs/speech-to-text` devuelve `words[]` con {text,start,end,type} y cubre el
//     100% de las palabras.
// Golpea la RED REAL con FAL_KEY (.env.test.local / .env), gasta <$0,02 (una frase corta) y NUNCA corre
// en CI. Un live ROJO/SKIPPED no prueba nada (anti-patrón, principio 9): se declara el coste ANTES con
// `spendBudget()` y, si falta la key, se SALTA con mensaje explícito. El implementer/verifier lo corre
// una vez con la key y anota el coste real.
import { describe, expect, it } from 'vitest';
import { spendBudget } from '@ugc/test-utils/live-budget';

import { makeFalClient } from './fal-client';
import { extractAudioOutput } from './fal-audio-output';
import { extractWordTimestamps, computeWordCoverage } from './word-timestamps';

const FAL_KEY = process.env.FAL_KEY;
const describeLive = FAL_KEY ? describe : describe.skip;

if (!FAL_KEY) {
  console.warn(
    '[live] FAL_KEY ausente: los tests live de T4.5 (cadena TTS→ASR) se SALTAN. Ponla en .env.test.local.',
  );
}

const TTS_ENDPOINT = 'fal-ai/kokoro';
const ASR_ENDPOINT = 'fal-ai/elevenlabs/speech-to-text';
const PHRASE = 'Testing the voiceover chain end to end.';

describeLive('cadena TTS→ASR — contrato real de fal (LIVE, T4.5)', () => {
  it('kokoro sintetiza audio SIN timestamps nativos; el ASR encadenado los produce con cobertura 100%', async () => {
    spendBudget(0.02); // frase corta: TTS ~0¢ + ASR ~0¢, cota holgada
    const fal = makeFalClient({ credentials: FAL_KEY! });

    // TTS: submit → poll → output de AUDIO (no imagen).
    const ttsSub = await fal.submit(TTS_ENDPOINT, { prompt: PHRASE, voice: 'af_heart', speed: 1 });
    const ttsPolled = await fal.poll({
      statusUrl: ttsSub.statusUrl,
      responseUrl: ttsSub.responseUrl,
    });
    const audio = extractAudioOutput(ttsPolled.output);
    expect(audio).not.toBeNull();
    expect(audio?.audio.url).toMatch(/^https:/);
    // [verificar] kokoro: el output NO trae word timestamps nativos (solo el fichero de audio).
    expect(ttsPolled.output).not.toHaveProperty('words');

    // ASR encadenado sobre la URL pública del audio (ruta por defecto §13.1).
    const asrSub = await fal.submit(ASR_ENDPOINT, {
      audio_url: audio!.audio.url,
      language_code: 'eng',
      diarize: false,
      tag_audio_events: false,
    });
    const asrPolled = await fal.poll({
      statusUrl: asrSub.statusUrl,
      responseUrl: asrSub.responseUrl,
    });
    const wt = extractWordTimestamps(asrPolled.output);
    expect(wt).not.toBeNull();
    const cov = computeWordCoverage(wt!);
    // Cobertura del 100% de las palabras (Entrega T4.5) contra la API real.
    expect(cov.wordCount).toBeGreaterThan(0);
    expect(cov.fullyCovered).toBe(true);
  }, 300_000);
});
