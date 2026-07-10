import { describe, expect, it } from 'vitest';

import { classifyUrl, contentHash, normalizeUrl } from './url';

describe('classifyUrl (regex §7.2 N1)', () => {
  const cases: [url: string, expected: ReturnType<typeof classifyUrl>][] = [
    // Shopify por subdominio myshopify.com
    ['https://acme.myshopify.com/products/serum', 'shopify'],
    ['https://acme.myshopify.com/', 'shopify'],
    // Shopify por path de producto en dominio propio
    ['https://tienda.com/products/wool-runner', 'shopify'],
    ['https://tienda.com/products/wool-runner?variant=42', 'shopify'],
    // WooCommerce por permalink /product/ (singular)
    ['https://shop.example/product/ceramic-mug', 'woocommerce'],
    ['https://shop.example/product/ceramic-mug/', 'woocommerce'],
    // Custom: dominio y path sin señal
    ['https://brand.example/shop/lamp', 'custom'],
    ['https://brand.example/', 'custom'],
    // Amazon FUERA de alcance (D9): NO se casa como amazon → custom
    ['https://www.amazon.com/dp/B0ABCDEFG', 'custom'],
    ['https://www.amazon.es/gp/product/B0XYZ', 'custom'],
    // URL inválida → custom, sin lanzar
    ['not a url', 'custom'],
    ['', 'custom'],
  ];

  it.each(cases)('%s → %s', (url, expected) => {
    expect(classifyUrl(url)).toBe(expected);
  });
});

describe('normalizeUrl (cache key §12 — determinista e idempotente)', () => {
  it('es idempotente: normalize(normalize(x)) === normalize(x)', () => {
    const urls = [
      'https://Tienda.COM/Products/Serum/?utm_source=ig&a=1#frag',
      'http://x.com:80/path/',
      'https://y.com',
      'https://y.com/',
      'https://z.com/a?b=2&a=1',
    ];
    for (const u of urls) {
      const once = normalizeUrl(u);
      expect(normalizeUrl(once)).toBe(once);
    }
  });

  it('es determinista: misma entrada → misma salida', () => {
    const u = 'https://x.com/p?z=1&a=2';
    expect(normalizeUrl(u)).toBe(normalizeUrl(u));
  });

  const cases: [input: string, expected: string][] = [
    // host a minúsculas, fragmento fuera, query ordenada, barra final del path fuera
    [
      'https://Tienda.COM/Products/Serum/?b=2&a=1#frag',
      'https://tienda.com/Products/Serum?a=1&b=2',
    ],
    // raíz con y sin barra colapsan al mismo canónico (host desnudo)
    ['https://y.com', 'https://y.com'],
    ['https://y.com/', 'https://y.com'],
    // puerto por defecto fuera
    ['http://x.com:80/path', 'http://x.com/path'],
    ['https://x.com:443/path', 'https://x.com/path'],
    // query ya presente se ordena
    ['https://z.com/a?z=1&a=2', 'https://z.com/a?a=2&z=1'],
  ];

  it.each(cases)('%s → %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it('una URL inválida se devuelve tal cual (trim), sin lanzar', () => {
    expect(normalizeUrl('  garbage  ')).toBe('garbage');
  });
});

describe('contentHash (cache key §12 — determinista, estable ante orden de claves)', () => {
  it('es determinista para el mismo string', () => {
    expect(contentHash('hola')).toBe(contentHash('hola'));
  });

  it('devuelve sha256 hex (64 chars)', () => {
    expect(contentHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mismo objeto con distinto ORDEN de claves → mismo hash (serialización estable)', () => {
    const a = { title: 'X', price: '10', images: [{ url: 'u', alt: null }] };
    const b = { images: [{ alt: null, url: 'u' }], price: '10', title: 'X' };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('objetos con distinto contenido → distinto hash', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it('el orden de un array SÍ importa (es significativo)', () => {
    expect(contentHash({ x: [1, 2] })).not.toBe(contentHash({ x: [2, 1] }));
  });
});
