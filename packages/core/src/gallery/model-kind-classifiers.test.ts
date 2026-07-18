// Clasificadores de `model_kind` (T4.11 item 5): el ÚNICO punto de verdad de la taxonomía de vídeo,
// consumido por el sweeper (deadline) y el finalizer de descarga. ANTES estaba TRIPLICADO
// (`VIDEO_MODEL_KINDS` en sweeper, `AVATAR_KINDS`+`BROLL_KINDS` en finalize-download); estos tests
// blindan que las derivaciones son coherentes y exhaustivas sobre TODO el enum `ModelKind`.
import { describe, expect, it } from 'vitest';
import {
  ModelKindSchema,
  isAvatarModelKind,
  isBrollModelKind,
  isVideoModelKind,
  isMusicModelKind,
  videoAssetKindForModelKind,
  type ModelKind,
} from './contracts';

const ALL_KINDS = ModelKindSchema.options as readonly ModelKind[];

describe('clasificadores de model_kind (T4.11)', () => {
  it('isAvatarModelKind reconoce avatar/lipsync y nada más', () => {
    expect(ALL_KINDS.filter(isAvatarModelKind).sort()).toEqual(['avatar', 'lipsync']);
  });

  it('isBrollModelKind reconoce t2v/i2v/r2v y nada más', () => {
    expect(ALL_KINDS.filter(isBrollModelKind).sort()).toEqual(['i2v', 'r2v', 't2v']);
  });

  it('isVideoModelKind = avatar ∪ broll (el conjunto de vídeo que sweeper y finalizer comparten)', () => {
    expect(ALL_KINDS.filter(isVideoModelKind).sort()).toEqual([
      'avatar',
      'i2v',
      'lipsync',
      'r2v',
      't2v',
    ]);
  });

  it('isVideoModelKind excluye image/tts/music/utility (deadline de imagen, no de vídeo)', () => {
    for (const kind of ['image', 'tts', 'music', 'utility'] as const) {
      expect(isVideoModelKind(kind)).toBe(false);
    }
  });

  // El invariante que unifica los TRES consumidores: para todo kind, el asset kind de vídeo se deriva
  // del subconjunto (avatar→avatar_clip, broll→broll_clip; el resto null), y hay asset kind de vídeo SSI
  // el kind es de vídeo. Se tabula el esperado por kind (sin condicionales en el assert).
  const EXPECTED_ASSET_KIND: Record<ModelKind, 'avatar_clip' | 'broll_clip' | null> = {
    avatar: 'avatar_clip',
    lipsync: 'avatar_clip',
    t2v: 'broll_clip',
    i2v: 'broll_clip',
    r2v: 'broll_clip',
    image: null,
    tts: null,
    music: null,
    utility: null,
  };

  it.each(ALL_KINDS)(
    'videoAssetKindForModelKind(%s) deriva el asset kind coherente con las clasificaciones',
    (kind) => {
      const assetKind = videoAssetKindForModelKind(kind);
      expect(assetKind).toBe(EXPECTED_ASSET_KIND[kind]);
      // Coherencia con isVideoModelKind: hay asset kind de vídeo SSI el kind es de vídeo.
      expect(assetKind !== null).toBe(isVideoModelKind(kind));
    },
  );

  it('isMusicModelKind reconoce solo music (no es vídeo)', () => {
    expect(ALL_KINDS.filter(isMusicModelKind)).toEqual(['music']);
    expect(isVideoModelKind('music')).toBe(false);
  });
});
