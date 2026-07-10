// Suite del contrato VisualAnalysis (unit-core.md §3): fixture válido + mutaciones
// inválidas sobre los enums de clasificación (hero/broll/unusable, kind, background).
import { makeVisualAnalysis } from '@ugc/test-utils';
import { describe, expect, it } from 'vitest';

import { VisualAnalysisSchema, type VisualAnalysis } from './visual-analysis';

describe('VisualAnalysisSchema', () => {
  it('el fixture canónico valida', () => {
    expect(VisualAnalysisSchema.safeParse(makeVisualAnalysis()).success).toBe(true);
  });

  it('modo manual (sin imágenes, hero null) valida', () => {
    const manual = makeVisualAnalysis({
      images: [],
      hero_image_url: null,
      brand_style: null,
      rendered_social_proof: null,
    });
    expect(VisualAnalysisSchema.safeParse(manual).success).toBe(true);
  });

  const invalid: [name: string, mutate: (v: VisualAnalysis) => unknown][] = [
    [
      'video_suitability fuera del enum',
      (v) => ({ ...v, images: [{ ...v.images[0], video_suitability: 'maybe' }] }),
    ],
    ['kind fuera del enum', (v) => ({ ...v, images: [{ ...v.images[0], kind: 'meme' }] })],
    [
      'background fuera del enum',
      (v) => ({ ...v, images: [{ ...v.images[0], background: 'gradient' }] }),
    ],
    [
      'has_overlay_text ausente (obligatorio en imagen clasificada)',
      (v) => ({ ...v, images: [{ ...v.images[0], has_overlay_text: undefined }] }),
    ],
    ['hero_image_url ausente', (v) => ({ ...v, hero_image_url: undefined })],
    ['images no es array', (v) => ({ ...v, images: {} })],
    [
      'palette no es array de strings',
      (v) => ({ ...v, brand_style: { palette: 'rojo', aesthetic: 'minimal' } }),
    ],
  ];

  it.each(invalid)('rechaza: %s', (_name, mutate) => {
    expect(VisualAnalysisSchema.safeParse(mutate(makeVisualAnalysis())).success).toBe(false);
  });
});
