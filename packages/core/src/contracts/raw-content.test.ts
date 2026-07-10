// Suite del contrato RawContent (unit-core.md §3): fixture válido + mutaciones
// inválidas, con foco en el bicondicional de modo (manual sin URL, url con URL).
import { makeRawContent } from '@ugc/test-utils';
import { describe, expect, it } from 'vitest';

import { RawContentSchema, type RawContent } from './raw-content';

describe('RawContentSchema', () => {
  it('el fixture canónico (modo url, shopify con precio) valida', () => {
    expect(RawContentSchema.safeParse(makeRawContent()).success).toBe(true);
  });

  it('modo manual (source manual, url null, platform manual, sin fast path) valida', () => {
    const manual = makeRawContent({
      source: 'manual',
      url: null,
      platform: 'manual',
      markdown: 'Texto pegado por el usuario sobre el producto.',
      images: [],
      branding: null,
      product: null,
      screenshotRef: null,
    });
    expect(RawContentSchema.safeParse(manual).success).toBe(true);
  });

  const invalid: [name: string, mutate: (r: RawContent) => unknown][] = [
    [
      'manual con url no-null',
      (r) => ({ ...r, source: 'manual', url: 'https://x.com', platform: 'manual' }),
    ],
    [
      'manual con platform ≠ manual',
      (r) => ({ ...r, source: 'manual', url: null, platform: 'shopify' }),
    ],
    ['url con url null', (r) => ({ ...r, source: 'url', url: null })],
    ['url con platform manual', (r) => ({ ...r, source: 'url', platform: 'manual' })],
    ['source fuera del enum', (r) => ({ ...r, source: 'ftp' })],
    ['platform fuera del enum', (r) => ({ ...r, platform: 'magento' })],
    ['markdown ausente', (r) => ({ ...r, markdown: undefined })],
    ['images no es array', (r) => ({ ...r, images: 'x' })],
  ];

  it.each(invalid)('rechaza: %s', (_name, mutate) => {
    expect(RawContentSchema.safeParse(mutate(makeRawContent())).success).toBe(false);
  });
});
