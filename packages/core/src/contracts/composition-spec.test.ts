import { describe, expect, test } from 'vitest';

import { newUlid } from './ids';
import {
  CompositionSpecSchema,
  CompositionMusicSchema,
  CompositionOutputSchema,
  CompositionSegmentSchema,
  MUSIC_VOLUME_MAX,
  MUSIC_VOLUME_MIN,
} from './composition-spec';

const ulid = (): string => newUlid();

const validSegment = () => ({
  type: 'hook' as const,
  videoAsset: ulid(),
  voAudio: ulid(),
});

const validSpec = () => ({
  segments: [
    { ...validSegment(), type: 'hook' as const },
    { ...validSegment(), type: 'body' as const },
    { ...validSegment(), type: 'cta' as const },
  ],
  music: { asset: ulid(), volume: 0.25, ducking: true, fadeOutS: 1.5 },
  output: { maxDurationS: 30 },
});

describe('CompositionSpecSchema (T5.3)', () => {
  test('parsea un spec válido con música y 3 segmentos, aplicando los defaults del output', () => {
    const parsed = CompositionSpecSchema.parse(validSpec());
    expect(parsed.segments).toHaveLength(3);
    // Los literales canónicos del output se rellenan por default (§9.7 / Apéndice C).
    expect(parsed.output).toEqual({ width: 1080, height: 1920, fps: 30, maxDurationS: 30 });
  });

  test('acepta music:null (variante sin bed → máster solo-voz)', () => {
    const parsed = CompositionSpecSchema.parse({ ...validSpec(), music: null });
    expect(parsed.music).toBeNull();
  });

  test('acepta music.asset:null (mezcla declarada pero sin asset de bed)', () => {
    const spec = {
      ...validSpec(),
      music: { asset: null, volume: 0.2, ducking: false, fadeOutS: 0 },
    };
    expect(CompositionSpecSchema.parse(spec).music?.asset).toBeNull();
  });

  test('rechaza segments vacío (un máster sin segmentos no es un máster)', () => {
    expect(CompositionSpecSchema.safeParse({ ...validSpec(), segments: [] }).success).toBe(false);
  });

  test('rechaza un type de segmento fuera de hook|body|cta', () => {
    const bad = { ...validSpec(), segments: [{ ...validSegment(), type: 'outro' }] };
    expect(CompositionSpecSchema.safeParse(bad).success).toBe(false);
  });

  test('rechaza videoAsset que no es un ULID', () => {
    const bad = { ...validSpec(), segments: [{ ...validSegment(), videoAsset: 'not-a-ulid' }] };
    expect(CompositionSpecSchema.safeParse(bad).success).toBe(false);
  });

  test('transporta voWords/overlayText opcionales sin validar su shape interno (los consume T5.4)', () => {
    const parsed = CompositionSegmentSchema.parse({
      ...validSegment(),
      voWords: [{ word: 'hola', startMs: 0 }, 'lax'],
      overlayText: '20% off',
    });
    expect(parsed.voWords).toHaveLength(2);
    expect(parsed.overlayText).toBe('20% off');
  });

  describe('music.volume ∈ [0,2 – 0,3] (§9.7)', () => {
    test.each([MUSIC_VOLUME_MIN, 0.25, MUSIC_VOLUME_MAX])('acepta volume=%s', (volume) => {
      const spec = { ...validSpec(), music: { asset: ulid(), volume, ducking: true, fadeOutS: 0 } };
      expect(CompositionSpecSchema.safeParse(spec).success).toBe(true);
    });

    test.each([0.1, 0.19, 0.31, 0.5])('rechaza volume=%s (fuera de rango)', (volume) => {
      const spec = { ...validSpec(), music: { asset: ulid(), volume, ducking: true, fadeOutS: 0 } };
      expect(CompositionSpecSchema.safeParse(spec).success).toBe(false);
    });
  });

  test('CompositionMusicSchema rechaza fadeOutS negativo', () => {
    const bad = { asset: ulid(), volume: 0.25, ducking: true, fadeOutS: -1 };
    expect(CompositionMusicSchema.safeParse(bad).success).toBe(false);
  });

  test('CompositionOutputSchema rechaza maxDurationS no positivo', () => {
    expect(CompositionOutputSchema.safeParse({ maxDurationS: 0 }).success).toBe(false);
    expect(CompositionOutputSchema.safeParse({ maxDurationS: -5 }).success).toBe(false);
  });

  test('CompositionOutputSchema rechaza width/height/fps fuera de los literales canónicos', () => {
    expect(CompositionOutputSchema.safeParse({ width: 720, maxDurationS: 30 }).success).toBe(false);
    expect(CompositionOutputSchema.safeParse({ fps: 60, maxDurationS: 30 }).success).toBe(false);
  });
});
