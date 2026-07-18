// Unit de la resolución PURA recipe×voice_map (T4.11). Prueba que se proyectan los endpoints por
// componente (avatar/broll/voice, NO shots) y que el triple de voz es coherente o REVIENTA (un provider
// con el endpoint de otro no vale — money-safety de T4.5 reusada).
import { describe, expect, it } from 'vitest';
import { PermanentStepError } from '../orchestrator/executor';
import type { RecipeSeed } from '../library/contracts';
import {
  resolveComponentEndpoints,
  resolveVoiceTriple,
  type VoiceMap,
} from './resolve-variant-recipe';

const PREMIUM: RecipeSeed = {
  tier: 'premium',
  steps: [
    { component: 'avatar', model: 'fal-ai/bytedance/omnihuman/v1.5' },
    { component: 'broll', model: 'fal-ai/veo3.1/image-to-video' },
    { component: 'voice', model: 'fal-ai/elevenlabs/tts/eleven-v3' },
    { component: 'shots', model: 'fal-ai/nano-banana-pro/edit' },
  ],
  estCost30sMinCents: 900,
  estCost30sMaxCents: 1300,
};

describe('resolveComponentEndpoints', () => {
  it('proyecta avatar/broll/voice desde recipe.steps', () => {
    expect(resolveComponentEndpoints(PREMIUM)).toEqual({
      avatar: 'fal-ai/bytedance/omnihuman/v1.5',
      broll: 'fal-ai/veo3.1/image-to-video',
      voice: 'fal-ai/elevenlabs/tts/eleven-v3',
    });
  });

  it('NO proyecta `shots` (asimetría N7a: hardcodea flux-2, ignora recipe.steps.shots)', () => {
    const out = resolveComponentEndpoints(PREMIUM);
    expect(out).not.toHaveProperty('shots');
  });

  it('omite un componente ausente del recipe (voice-only)', () => {
    const voiceOnly: RecipeSeed = {
      ...PREMIUM,
      steps: [{ component: 'voice', model: 'fal-ai/kokoro' }],
    };
    expect(resolveComponentEndpoints(voiceOnly)).toEqual({ voice: 'fal-ai/kokoro' });
  });
});

describe('resolveVoiceTriple', () => {
  const voiceMap: VoiceMap = { es: { provider: 'elevenlabs', voiceId: 'rachel_v3' } };

  it('resuelve el triple coherente (endpoint del recipe × provider+voiceId del voice_map)', () => {
    expect(resolveVoiceTriple(PREMIUM, voiceMap, 'es')).toEqual({
      ttsEndpoint: 'fal-ai/elevenlabs/tts/eleven-v3',
      provider: 'elevenlabs',
      voice: 'rachel_v3',
    });
  });

  it('provider incoherente con el endpoint (kokoro en un endpoint de elevenlabs) → PermanentStepError', () => {
    const mismatched: VoiceMap = { es: { provider: 'kokoro', voiceId: 'af_heart' } };
    expect(() => resolveVoiceTriple(PREMIUM, mismatched, 'es')).toThrow(PermanentStepError);
  });

  it('voice_map sin el idioma → PermanentStepError', () => {
    expect(() => resolveVoiceTriple(PREMIUM, voiceMap, 'fr')).toThrow(PermanentStepError);
  });

  it('recipe sin componente voice → PermanentStepError', () => {
    const noVoice: RecipeSeed = {
      ...PREMIUM,
      steps: PREMIUM.steps.filter((s) => s.component !== 'voice'),
    };
    expect(() => resolveVoiceTriple(noVoice, voiceMap, 'es')).toThrow(PermanentStepError);
  });
});
