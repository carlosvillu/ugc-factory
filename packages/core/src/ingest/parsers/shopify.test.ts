import { describe, expect, it } from 'vitest';

import {
  SHOPIFY_DEFAULT_TITLE_JSON,
  SHOPIFY_NOT_A_PRODUCT_JSON,
  SHOPIFY_PRODUCT_JSON,
} from '../fixtures/shopify';
import { parseShopifyJson } from './shopify';

describe('parseShopifyJson', () => {
  it('extrae title, precio (string), vendor, variantes e imágenes de un producto real', () => {
    const p = parseShopifyJson(SHOPIFY_PRODUCT_JSON);
    expect(p).not.toBeNull();
    expect(p?.source).toBe('shopify');
    expect(p?.title).toBe('Wool Runner - Natural Black');
    expect(p?.price).toBe('110.00');
    // FIX 5: el `{handle}.json` público de Shopify NO expone la moneda → currency null
    // (fabricarla sería un falso verde; obtenerla exige un fetch shop-level, fuera de T1.3).
    expect(p?.currency).toBeNull();
    expect(p?.brand).toBe('Allbirds');
    expect(p?.variants).toEqual(['US 8', 'US 9', 'US 10']);
    expect(p?.images).toEqual([
      { url: 'https://cdn.shopify.com/s/files/wool-runner-1.jpg', alt: 'Side view' },
      { url: 'https://cdn.shopify.com/s/files/wool-runner-2.jpg', alt: null },
    ]);
  });

  it('precio NUMBER se normaliza a string; "Default Title" NO se lista como variante', () => {
    const p = parseShopifyJson(SHOPIFY_DEFAULT_TITLE_JSON);
    expect(p?.price).toBe('24.5');
    expect(p?.variants).toBeUndefined(); // solo había "Default Title"
    expect(p?.title).toBe('Single Variant Candle');
  });

  it('devuelve null si el JSON no contiene un objeto `product` (fuente ausente)', () => {
    expect(parseShopifyJson(SHOPIFY_NOT_A_PRODUCT_JSON)).toBeNull();
  });

  it('nunca lanza ante entradas basura', () => {
    expect(parseShopifyJson(null)).toBeNull();
    expect(parseShopifyJson('a string')).toBeNull();
    expect(parseShopifyJson(42)).toBeNull();
    expect(parseShopifyJson({ product: null })).toBeNull();
    expect(parseShopifyJson({ product: { variants: 'not-an-array' } })).not.toBeNull();
  });
});
