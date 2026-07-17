// Resolución de voz de N7b (T4.5, §13.1): valida la coherencia proveedor↔endpoint↔voiceId del triple.
// El mismatch RUIDOSO (kokoro con un voiceId/endpoint de elevenlabs) es la invariante clave — kokoro
// solo acepta su enum `af_/am_`; pasarle un endpoint de otro proveedor quemaría dinero silenciosamente.
import { describe, expect, it } from 'vitest';
import { PermanentStepError } from '../orchestrator/executor';

import { resolveVoiceStep } from './voice-resolution';

describe('resolveVoiceStep — triple consistente (T4.5)', () => {
  it('kokoro (test tier): endpoint fal-ai/kokoro + voiceId af_heart → inputs {voice, speed}', () => {
    const inputs = resolveVoiceStep({
      provider: 'kokoro',
      ttsEndpoint: 'fal-ai/kokoro',
      voice: 'af_heart',
      speed: 1,
    });
    expect(inputs).toEqual({ voice: 'af_heart', speed: 1 });
  });

  it('elevenlabs (standard tier): endpoint fal-ai/elevenlabs/tts/turbo-v2.5 + voiceId → OK', () => {
    const inputs = resolveVoiceStep({
      provider: 'elevenlabs',
      ttsEndpoint: 'fal-ai/elevenlabs/tts/turbo-v2.5',
      voice: 'EXAVITQu4vr4xnSDxMaL',
    });
    expect(inputs).toEqual({ voice: 'EXAVITQu4vr4xnSDxMaL' });
  });

  it('CONTROL NEGATIVO: tier kokoro con endpoint de elevenlabs → PermanentStepError (no coerción)', () => {
    // El mismatch que la Entrega exige RUIDOSO. Reintroducir la coerción silenciosa (devolver los inputs
    // igual) haría que este test cayera: la resolución DEBE lanzar.
    expect(() =>
      resolveVoiceStep({
        provider: 'kokoro',
        ttsEndpoint: 'fal-ai/elevenlabs/tts/turbo-v2.5',
        voice: 'af_heart',
      }),
    ).toThrow(PermanentStepError);
  });

  it('CONTROL NEGATIVO: provider elevenlabs con endpoint fal-ai/kokoro → PermanentStepError', () => {
    expect(() =>
      resolveVoiceStep({
        provider: 'elevenlabs',
        ttsEndpoint: 'fal-ai/kokoro',
        voice: 'EXAVITQu4vr4xnSDxMaL',
      }),
    ).toThrow(PermanentStepError);
  });

  it('CONTROL NEGATIVO: minimax (sin endpoint TTS sembrado) → PermanentStepError', () => {
    expect(() =>
      resolveVoiceStep({ provider: 'minimax', ttsEndpoint: 'fal-ai/minimax/tts', voice: 'v1' }),
    ).toThrow(PermanentStepError);
  });

  it('no colisiona por prefijo: fal-ai/kokoro-something NO se acepta para provider kokoro exacto', () => {
    // El match es exacto o con separador `/`: `fal-ai/kokoro` OK, `fal-ai/kokoro/es` OK, pero
    // `fal-ai/kokoroX` (otro modelo que empieza igual) NO — evita aceptar un endpoint ajeno por prefijo.
    expect(() =>
      resolveVoiceStep({ provider: 'kokoro', ttsEndpoint: 'fal-ai/kokoroX', voice: 'af_heart' }),
    ).toThrow(PermanentStepError);
  });
});
