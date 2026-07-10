import { describe, expect, it } from 'vitest';

import {
  HTML_JSONLD_GRAPH_MESSY,
  HTML_JSONLD_IMAGE_OBJECT,
  HTML_JSONLD_ITEMLIST_ITEM,
  HTML_JSONLD_MAINENTITY,
  HTML_JSONLD_ONE_BLOCK_BROKEN,
  HTML_JSONLD_PRICESPEC,
  HTML_JSONLD_SIMPLE,
  HTML_NO_SIGNAL,
  HTML_OG_NO_PRICE,
} from '../fixtures/html';
import { parseJsonLd } from './json-ld';

describe('parseJsonLd — variantes messy del mundo real (HEADLINE 2)', () => {
  it('bloque simple: price NUMBER, image ARRAY, brand OBJETO, aggregateRating', () => {
    const p = parseJsonLd(HTML_JSONLD_SIMPLE);
    expect(p?.source).toBe('json-ld');
    expect(p?.title).toBe('Handmade Ceramic Mug');
    expect(p?.price).toBe('28'); // number 28 → "28"
    expect(p?.currency).toBe('EUR');
    expect(p?.brand).toBe('ClayCo'); // desde {name}
    expect(p?.images).toEqual([
      { url: 'https://img.example/mug-a.jpg', alt: null },
      { url: 'https://img.example/mug-b.jpg', alt: null },
    ]);
    expect(p?.rating).toBe(4.7); // "4.7" string → number
    expect(p?.reviewCount).toBe(213);
    // FIX 6: availability se extrae del offer (antes era campo muerto → siempre null).
    expect(p?.availability).toBe('https://schema.org/InStock');
  });

  it('FIX 3: Product bajo WebPage.mainEntity se encuentra (antes devolvía null)', () => {
    const p = parseJsonLd(HTML_JSONLD_MAINENTITY);
    expect(p).not.toBeNull();
    expect(p?.title).toBe('Nested Desk Lamp');
    expect(p?.price).toBe('42.00');
    expect(p?.currency).toBe('USD');
    expect(p?.images).toEqual([{ url: 'https://img.example/desk-lamp.jpg', alt: null }]);
  });

  it('FIX 3: Product bajo itemListElement[].item se encuentra', () => {
    const p = parseJsonLd(HTML_JSONLD_ITEMLIST_ITEM);
    expect(p?.title).toBe('Listed Kettle');
    expect(p?.price).toBe('35.50');
    expect(p?.currency).toBe('GBP');
  });

  it('FIX 4: precio en offers.priceSpecification.price se lee (antes se perdía)', () => {
    const p = parseJsonLd(HTML_JSONLD_PRICESPEC);
    expect(p?.title).toBe('Spec-Priced Blender');
    expect(p?.price).toBe('79.99');
    expect(p?.currency).toBe('USD'); // priceCurrency también dentro de priceSpecification
  });

  it('@graph + varios bloques + offers ARRAY + price STRING + image STRING + brand STRING + @type ARRAY', () => {
    const p = parseJsonLd(HTML_JSONLD_GRAPH_MESSY);
    expect(p).not.toBeNull();
    // Elige el Product anidado en @graph, ignora BreadcrumbList y Organization.
    expect(p?.title).toBe('Trail Backpack 30L');
    expect(p?.brand).toBe('OutdoorCo');
    // offers como array: toma la PRIMERA oferta con precio.
    expect(p?.price).toBe('29.99');
    expect(p?.currency).toBe('USD');
    // image como string única.
    expect(p?.images).toEqual([{ url: 'https://img.example/backpack.jpg', alt: null }]);
  });

  it('image como ImageObject {url}/{contentUrl}; offers sin price cae a lowPrice', () => {
    const p = parseJsonLd(HTML_JSONLD_IMAGE_OBJECT);
    expect(p?.images).toEqual([
      { url: 'https://img.example/lamp-1.jpg', alt: 'Front' },
      { url: 'https://img.example/lamp-2.jpg', alt: null },
    ]);
    expect(p?.price).toBe('59.00');
    expect(p?.currency).toBe('GBP');
  });

  it('un bloque ld+json MALFORMADO se ignora; el bloque válido se usa (no aborta)', () => {
    const p = parseJsonLd(HTML_JSONLD_ONE_BLOCK_BROKEN);
    expect(p?.title).toBe('Resilient Widget');
    expect(p?.price).toBe('9.99');
  });

  it('devuelve null si no hay ningún nodo Product (solo OG, o sin señal)', () => {
    expect(parseJsonLd(HTML_OG_NO_PRICE)).toBeNull();
    expect(parseJsonLd(HTML_NO_SIGNAL)).toBeNull();
    expect(parseJsonLd('')).toBeNull();
  });
});
