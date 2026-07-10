import { describe, expect, it } from 'vitest';

import { RawContentSchema } from '../contracts/raw-content';
import { mergeRawContent } from './merge';
import type { RawContentPartial } from './parsers/types';

const shopify: RawContentPartial = {
  source: 'shopify',
  title: 'Shopify Title',
  description: '<p>Shopify desc</p>',
  price: '110.00',
  currency: 'USD',
  variants: ['US 8'],
  images: [{ url: 'https://s.example/shopify.jpg', alt: 'S' }],
};
const jsonLd: RawContentPartial = {
  source: 'json-ld',
  title: 'JSON-LD Title',
  description: 'JSON-LD desc',
  price: '99.00',
  currency: 'EUR',
  images: [{ url: 'https://s.example/jsonld.jpg', alt: null }],
};
const og: RawContentPartial = {
  source: 'opengraph',
  title: 'OG Title',
  price: '49.90',
  images: [{ url: 'https://s.example/og.jpg', alt: null }],
};

const URL = 'https://tienda.example/products/x';

describe('mergeRawContent — precedencia Shopify > JSON-LD > OpenGraph', () => {
  it('con las tres fuentes: gana Shopify en title/price/images', () => {
    const raw = mergeRawContent({ url: URL, platform: 'shopify', partials: [og, jsonLd, shopify] });
    expect(raw.product?.title).toBe('Shopify Title');
    expect(raw.product?.price).toBe('110.00');
    expect(raw.product?.currency).toBe('USD');
    expect(raw.images).toEqual([{ url: 'https://s.example/shopify.jpg', alt: 'S' }]);
    expect(raw.markdown).toBe('Shopify desc'); // body_html limpio de tags
  });

  it('sin Shopify: gana JSON-LD sobre OpenGraph', () => {
    const raw = mergeRawContent({ url: URL, platform: 'custom', partials: [og, jsonLd] });
    expect(raw.product?.title).toBe('JSON-LD Title');
    expect(raw.product?.price).toBe('99.00');
    expect(raw.images).toEqual([{ url: 'https://s.example/jsonld.jpg', alt: null }]);
  });

  it('solo OpenGraph: usa OG', () => {
    const raw = mergeRawContent({ url: URL, platform: 'custom', partials: [og] });
    expect(raw.product?.title).toBe('OG Title');
    expect(raw.product?.price).toBe('49.90');
  });

  it('el orden del array de partials no altera la precedencia (por source, no por posición)', () => {
    const a = mergeRawContent({ url: URL, platform: 'shopify', partials: [shopify, jsonLd, og] });
    const b = mergeRawContent({ url: URL, platform: 'shopify', partials: [og, shopify, jsonLd] });
    expect(a).toEqual(b);
  });
});

describe('mergeRawContent — SIEMPRE produce un RawContent válido (HEADLINE 1)', () => {
  it('sin ninguna fuente: RawContent válido y escaso (markdown="", images=[], product=null)', () => {
    const raw = mergeRawContent({ url: URL, platform: 'custom', partials: [] });
    expect(RawContentSchema.safeParse(raw).success).toBe(true);
    expect(raw.markdown).toBe('');
    expect(raw.images).toEqual([]);
    expect(raw.product).toBeNull();
    expect(raw.source).toBe('url');
    expect(raw.url).toBe(URL);
    expect(raw.platform).toBe('custom');
  });

  it('cualquier combinación de fuentes valida contra RawContentSchema', () => {
    const combos: RawContentPartial[][] = [
      [shopify],
      [jsonLd],
      [og],
      [shopify, og],
      [jsonLd, og],
      [shopify, jsonLd, og],
    ];
    for (const partials of combos) {
      const raw = mergeRawContent({ url: URL, platform: 'shopify', partials });
      expect(RawContentSchema.safeParse(raw).success).toBe(true);
    }
  });

  it('respeta el bicondicional de modo url (url presente, platform != manual)', () => {
    const raw = mergeRawContent({ url: URL, platform: 'woocommerce', partials: [jsonLd] });
    expect(raw.source).toBe('url');
    expect(raw.url).not.toBeNull();
    expect(raw.platform).not.toBe('manual');
  });

  it('dedupe de imágenes por URL dentro del conjunto elegido', () => {
    const dup: RawContentPartial = {
      source: 'json-ld',
      images: [
        { url: 'https://s.example/a.jpg', alt: null },
        { url: 'https://s.example/a.jpg', alt: 'dup' },
        { url: 'https://s.example/b.jpg', alt: null },
      ],
    };
    const raw = mergeRawContent({ url: URL, platform: 'custom', partials: [dup] });
    expect(raw.images).toEqual([
      { url: 'https://s.example/a.jpg', alt: null },
      { url: 'https://s.example/b.jpg', alt: null },
    ]);
  });
});
