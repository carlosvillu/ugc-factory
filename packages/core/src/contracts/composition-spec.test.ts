import { describe, expect, test } from 'vitest';

import { makeWordTimestamps } from '@ugc/test-utils';

import { newUlid } from './ids';
import {
  CompositionSpecSchema,
  CompositionCaptionsSchema,
  CompositionMusicSchema,
  CompositionOutputSchema,
  CompositionSegmentSchema,
  MUSIC_VOLUME_MAX,
  MUSIC_VOLUME_MIN,
} from './composition-spec';

const ulid = (): string => newUlid();

const validSegment = () => ({
  type: 'hook' as const,
  videoAssets: [ulid()],
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

  test('rechaza un videoAssets con un elemento que no es un ULID', () => {
    const bad = { ...validSpec(), segments: [{ ...validSegment(), videoAssets: ['not-a-ulid'] }] };
    expect(CompositionSpecSchema.safeParse(bad).success).toBe(false);
  });

  // T5.8c: `videoAssets` es la LISTA ordenada de clips de la escena (§7.5). Vacía es incoherente (un
  // segmento sin vídeo no es un segmento); varios es el caso legítimo de una escena troceada.
  test('rechaza un videoAssets VACÍO (un segmento sin clip de vídeo no es un segmento)', () => {
    const bad = { ...validSpec(), segments: [{ ...validSegment(), videoAssets: [] }] };
    expect(CompositionSpecSchema.safeParse(bad).success).toBe(false);
  });

  test('acepta VARIOS videoAssets (escena troceada por §7.5, concatenada intra-escena por T5.8c)', () => {
    const clips = [ulid(), ulid(), ulid()];
    const ok = { ...validSpec(), segments: [{ ...validSegment(), videoAssets: clips }] };
    const parsed = CompositionSpecSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
    // El ORDEN se preserva: es el orden temporal del concat (= orden de `clipIndex`).
    expect(parsed.success && parsed.data.segments[0]?.videoAssets).toEqual(clips);
  });

  test('voWords transporta un WordTimestamps válido (T5.4 estrechó el shape) + overlayText', () => {
    const wt = makeWordTimestamps({ words: 3 });
    const parsed = CompositionSegmentSchema.parse({
      ...validSegment(),
      voWords: wt,
      overlayText: '20% off',
    });
    expect(parsed.voWords?.words).toHaveLength(3);
    expect(parsed.overlayText).toBe('20% off');
  });

  test('voWords YA NO acepta un array laxo (T5.4: es WordTimestampsSchema, no z.array(unknown))', () => {
    const bad = { ...validSegment(), voWords: [{ word: 'hola', startMs: 0 }, 'lax'] };
    expect(CompositionSegmentSchema.safeParse(bad).success).toBe(false);
  });

  test('voWords rechaza un WordTimestamps con words vacío (min(1) del schema T4.5)', () => {
    const bad = { ...validSegment(), voWords: { text: 'x', words: [] } };
    expect(CompositionSegmentSchema.safeParse(bad).success).toBe(false);
  });

  test('un segmento sin voWords sigue siendo válido (opcional)', () => {
    expect(CompositionSegmentSchema.safeParse(validSegment()).success).toBe(true);
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

  describe('captions (T5.4, aditivo)', () => {
    test('un spec sin captions sigue siendo válido (opcional/ausente — máster intermedio de T5.3)', () => {
      const parsed = CompositionSpecSchema.parse(validSpec());
      expect(parsed.captions).toBeUndefined();
    });

    test('acepta captions:null (variante sin subtítulos declarada explícitamente)', () => {
      const parsed = CompositionSpecSchema.parse({ ...validSpec(), captions: null });
      expect(parsed.captions).toBeNull();
    });

    test('parsea captions karaoke aplicando defaults de platform/position', () => {
      const parsed = CompositionCaptionsSchema.parse({ style: 'karaoke', maxWordsPerPage: 4 });
      expect(parsed).toEqual({
        style: 'karaoke',
        maxWordsPerPage: 4,
        platform: 'universal',
        position: 'safe_zone',
      });
    });

    test('acepta captions embebido en un spec completo', () => {
      const spec = {
        ...validSpec(),
        captions: { style: 'subtitle' as const, maxWordsPerPage: 6, platform: 'reels' as const },
      };
      const parsed = CompositionSpecSchema.parse(spec);
      expect(parsed.captions?.style).toBe('subtitle');
      expect(parsed.captions?.platform).toBe('reels');
    });

    test.each([
      ['style fuera del enum', { style: 'ticker', maxWordsPerPage: 4 }],
      ['maxWordsPerPage 0', { style: 'karaoke', maxWordsPerPage: 0 }],
      ['maxWordsPerPage no entero', { style: 'karaoke', maxWordsPerPage: 2.5 }],
      ['platform fuera del enum', { style: 'karaoke', maxWordsPerPage: 4, platform: 'youtube' }],
      ['position fuera del enum', { style: 'karaoke', maxWordsPerPage: 4, position: 'anywhere' }],
    ])('rechaza: %s', (_name, bad) => {
      expect(CompositionCaptionsSchema.safeParse(bad).success).toBe(false);
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
