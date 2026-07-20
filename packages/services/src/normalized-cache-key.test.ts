// Unit test de la derivación PURA de la `normalized_cache_key` (T5.2, §9.7). Co-locado en `src/` →
// corre en `services:unit` (parte del gate), SIN ffmpeg. Es la RED DE SEGURIDAD del gate para el
// contrato de la caché normalize-once: si dos perfiles distintos colapsaran a la misma key, o la misma
// entrada diera keys distintas, la caché se envenenaría en silencio — este test se pondría rojo antes.
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_AUDIO_PROFILE,
  CANONICAL_VIDEO_PROFILE,
  computeNormalizedCacheKey,
  NORMALIZE_RECIPE_VERSION,
  type NormalizeProfile,
} from './normalized-cache-key';

const SRC = 'a'.repeat(64); // un sha256 hex de ejemplo (el checksum del asset origen)

describe('computeNormalizedCacheKey (T5.2)', () => {
  it('es determinista: misma entrada → misma key', () => {
    const k1 = computeNormalizedCacheKey({ sourceChecksum: SRC, profile: CANONICAL_VIDEO_PROFILE });
    const k2 = computeNormalizedCacheKey({ sourceChecksum: SRC, profile: CANONICAL_VIDEO_PROFILE });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('el orden de las propiedades del perfil NO altera la key (serialización canónica)', () => {
    // Un perfil con las MISMAS claves insertadas en otro orden debe dar la MISMA key.
    const reordered: NormalizeProfile = {
      autorotate: CANONICAL_VIDEO_PROFILE.autorotate,
      audioChannels: CANONICAL_VIDEO_PROFILE.audioChannels,
      crf: CANONICAL_VIDEO_PROFILE.crf,
      height: CANONICAL_VIDEO_PROFILE.height,
      width: CANONICAL_VIDEO_PROFILE.width,
      fps: CANONICAL_VIDEO_PROFILE.fps,
      videoCodec: CANONICAL_VIDEO_PROFILE.videoCodec,
      audioCodec: CANONICAL_VIDEO_PROFILE.audioCodec,
      audioSampleRate: CANONICAL_VIDEO_PROFILE.audioSampleRate,
      mediaKind: CANONICAL_VIDEO_PROFILE.mediaKind,
    };
    expect(computeNormalizedCacheKey({ sourceChecksum: SRC, profile: reordered })).toBe(
      computeNormalizedCacheKey({ sourceChecksum: SRC, profile: CANONICAL_VIDEO_PROFILE }),
    );
  });

  it('un checksum de origen distinto → key distinta', () => {
    const k1 = computeNormalizedCacheKey({ sourceChecksum: SRC, profile: CANONICAL_VIDEO_PROFILE });
    const k2 = computeNormalizedCacheKey({
      sourceChecksum: 'b'.repeat(64),
      profile: CANONICAL_VIDEO_PROFILE,
    });
    expect(k1).not.toBe(k2);
  });

  it('vídeo vs audio (mismo origen) → keys distintas (dos normalizados del mismo clip)', () => {
    const video = computeNormalizedCacheKey({
      sourceChecksum: SRC,
      profile: CANONICAL_VIDEO_PROFILE,
    });
    const audio = computeNormalizedCacheKey({
      sourceChecksum: SRC,
      profile: CANONICAL_AUDIO_PROFILE,
    });
    expect(video).not.toBe(audio);
  });

  // CADA parámetro del perfil, mutado uno a uno, DEBE cambiar la key. Es lo que garantiza que un preset
  // por plataforma (otra resolución/fps/CRF) o un cambio de mapeo de audio no reutilice por error el
  // normalizado de otro perfil (T8.3: presets sin envenenar la caché).
  const base = CANONICAL_VIDEO_PROFILE;
  const mutations: [string, NormalizeProfile][] = [
    ['width', { ...base, width: 1440 }],
    ['height', { ...base, height: 2560 }],
    ['fps', { ...base, fps: 60 }],
    ['videoCodec', { ...base, videoCodec: 'hevc' }],
    ['crf', { ...base, crf: 18 }],
    ['audioCodec', { ...base, audioCodec: 'opus' }],
    ['audioSampleRate', { ...base, audioSampleRate: 44_100 }],
    ['audioChannels', { ...base, audioChannels: 1 }],
    ['autorotate', { ...base, autorotate: false }],
  ];
  const baseKey = computeNormalizedCacheKey({ sourceChecksum: SRC, profile: base });
  it.each(mutations)('cambiar %s cambia la key', (_param, mutated) => {
    expect(computeNormalizedCacheKey({ sourceChecksum: SRC, profile: mutated })).not.toBe(baseKey);
  });

  it('cambiar la versión de receta cambia la key', () => {
    const withCurrent = computeNormalizedCacheKey({
      sourceChecksum: SRC,
      profile: base,
      recipeVersion: NORMALIZE_RECIPE_VERSION,
    });
    const withBumped = computeNormalizedCacheKey({
      sourceChecksum: SRC,
      profile: base,
      recipeVersion: NORMALIZE_RECIPE_VERSION + 1,
    });
    expect(withCurrent).toBe(baseKey); // el default ES NORMALIZE_RECIPE_VERSION
    expect(withBumped).not.toBe(baseKey);
  });
});
