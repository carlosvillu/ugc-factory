// Suite del contrato ProductBrief (unit-core.md §3): fixture canónico válido + tabla
// de mutaciones inválidas (una por regla de negocio del schema) + las divergencias
// del Apéndice A. Los inválidos parten del fixture válido y rompen UNA cosa (§2).
import { makeBrief } from '@ugc/test-utils';
import { describe, expect, it } from 'vitest';

import { ProductBriefSchema, type ProductBrief } from './product-brief';

describe('ProductBriefSchema', () => {
  it('el fixture canónico (modo url) valida', () => {
    expect(ProductBriefSchema.safeParse(makeBrief()).success).toBe(true);
  });

  it('modo manual (source_url null, platform manual) valida', () => {
    const manual = makeBrief({
      meta: {
        source_url: null,
        platform: 'manual',
        language: 'es',
        extracted_at: '2026-07-10T12:00:00.000Z',
        extraction_confidence: 'medium',
        warnings: [],
      },
    });
    expect(ProductBriefSchema.safeParse(manual).success).toBe(true);
  });

  const invalid: [name: string, mutate: (b: ProductBrief) => unknown][] = [
    ['sin ángulos', (b) => ({ ...b, angles: [] })],
    ['4 ángulos (mín. 5)', (b) => ({ ...b, angles: b.angles.slice(0, 4) })],
    ['11 ángulos (máx. 10)', (b) => ({ ...b, angles: Array(11).fill(b.angles[0]) })],
    [
      'hook_examples con 1 solo (mín. 2)',
      (b) => ({
        ...b,
        angles: [{ ...b.angles[0], hook_examples: ['solo uno'] }, ...b.angles.slice(1)],
      }),
    ],
    [
      'hook_examples con 4 (máx. 3)',
      (b) => ({
        ...b,
        angles: [
          { ...b.angles[0], hook_examples: ['a b', 'c d', 'e f', 'g h'] },
          ...b.angles.slice(1),
        ],
      }),
    ],
    [
      'source_url no-null con platform=manual',
      (b) => ({ ...b, meta: { ...b.meta, platform: 'manual', source_url: 'https://x.com' } }),
    ],
    [
      'source_url null con platform=shopify',
      (b) => ({ ...b, meta: { ...b.meta, platform: 'shopify', source_url: null } }),
    ],
    [
      'awareness_level fuera del enum',
      (b) => ({
        ...b,
        audience: {
          ...b.audience,
          segments: [{ ...b.audience.segments[0], awareness_level: 'psychic' }],
        },
      }),
    ],
    [
      '5 segments (máx. 4)',
      (b) => ({
        ...b,
        audience: { ...b.audience, segments: Array(5).fill(b.audience.segments[0]) },
      }),
    ],
    [
      '6 quotes (máx. 5)',
      (b) => ({
        ...b,
        social_proof: { ...b.social_proof, quotes: Array(6).fill(b.social_proof.quotes[0]) },
      }),
    ],
    [
      'framework fuera del enum',
      (b) => ({ ...b, angles: [{ ...b.angles[0], framework: 'clickbait' }, ...b.angles.slice(1)] }),
    ],
    [
      'positioning fuera del enum',
      (b) => ({ ...b, pricing: { ...b.pricing, positioning: 'cheap' } }),
    ],
    [
      'counter_source fuera del enum',
      (b) => ({
        ...b,
        objections: [{ ...b.objections[0], counter_source: 'guessed' }],
      }),
    ],
    [
      'video_suitability fuera del enum',
      (b) => ({
        ...b,
        assets: {
          ...b.assets,
          images: [{ ...b.assets.images[0], video_suitability: 'maybe' }],
        },
      }),
    ],
    ['meta.language ausente', (b) => ({ ...b, meta: { ...b.meta, language: undefined } })],
    ['product.name ausente', (b) => ({ ...b, product: { ...b.product, name: undefined } })],
  ];

  it.each(invalid)('rechaza: %s', (_name, mutate) => {
    expect(ProductBriefSchema.safeParse(mutate(makeBrief())).success).toBe(false);
  });
});
