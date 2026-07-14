import { describe, expect, it } from 'vitest';

import { classifyUrl, contentHash, detectRedirectMismatch, normalizeUrl } from './url';

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

// ── T2.7 · el comparador de redirección significativa ────────────────────────
//
// Los DOS lados importan igual (skill testing, principio 9): el fixture cómodo aquí es una
// redirección BENIGNA (que pasa con cualquier comparador, incluso uno roto), así que la tabla
// lleva los casos que MUERDEN — el de dr-squatch (ruta profunda → raíz, MISMO host: no basta
// con comparar hosts) y el cambio de host — junto a los benignos que NO pueden avisar (si el
// aviso saliera con un `http→https`, saldría siempre y nadie volvería a mirarlo).
describe('detectRedirectMismatch (T2.7 — criterio ESTRECHO)', () => {
  const benign: [name: string, requested: string, final: string | null][] = [
    ['idéntica', 'https://glow.example/products/serum', 'https://glow.example/products/serum'],
    ['http→https', 'http://glow.example/products/serum', 'https://glow.example/products/serum'],
    [
      'añade www.',
      'https://glow.example/products/serum',
      'https://www.glow.example/products/serum',
    ],
    [
      'quita www.',
      'https://www.glow.example/products/serum',
      'https://glow.example/products/serum',
    ],
    ['barra final', 'https://glow.example/products/serum', 'https://glow.example/products/serum/'],
    [
      'añade ?utm_* (tracking)',
      'https://glow.example/products/serum',
      'https://glow.example/products/serum?utm_source=ig&utm_medium=cpc',
    ],
    [
      'reordena la query (canonicalización)',
      'https://glow.example/products/serum?b=2&a=1',
      'https://glow.example/products/serum?a=1&b=2',
    ],
    [
      'locale/geo en el path (sigue siendo una página de producto)',
      'https://glow.example/products/serum',
      'https://glow.example/es/products/serum',
    ],
    [
      'subdominio → dominio (canonicalización interna del mismo comerciante)',
      'https://shop.glow.example/products/serum',
      'https://glow.example/products/serum',
    ],
    [
      'rename del slug (mismo host, sigue siendo un producto)',
      'https://glow.example/products/serum',
      'https://glow.example/products/serum-v2',
    ],
    [
      'raíz → raíz (se pidió la home y llegó la home)',
      'https://glow.example',
      'https://glow.example/',
    ],
    ['sin URL final (un camino que no la expone: NO se inventa)', 'https://glow.example/x', null],
    // Guards del DISCRIMINADOR nuevo (el PADRE, no el último segmento). Si alguien "endurece"
    // el criterio a «cambió el slug», estos tres se ponen rojos — y con razón: son las
    // redirecciones más frecuentes de una tienda real.
    [
      'rename del slug con sufijo de campaña',
      'https://glow.example/products/serum',
      'https://glow.example/products/serum-hidratante-24h',
    ],
    [
      'locale + rename a la vez (el padre `products` sobrevive)',
      'https://glow.example/products/serum',
      'https://glow.example/es-es/products/serum-v2',
    ],
    [
      'canonicalización que AÑADE directorio (`/serum` → `/products/serum`)',
      'https://glow.example/serum',
      'https://glow.example/products/serum',
    ],
    [
      'se pidió la HOME y llegó una landing (no había página concreta que perder)',
      'https://glow.example',
      'https://glow.example/es/home',
    ],
  ];

  it.each(benign)('BENIGNA — %s → NO avisa', (_name, requested, final) => {
    expect(detectRedirectMismatch(requested, final)).toBeNull();
  });

  it('MALIGNA — ruta profunda → RAÍZ desnuda, MISMO host (el caso vivo de dr-squatch)', () => {
    const hit = detectRedirectMismatch(
      'https://www.dr-squatch.com/products/pine-tar-bar-soap',
      'https://www.dr-squatch.com/',
    );
    expect(hit).toEqual({
      requested: 'https://www.dr-squatch.com/products/pine-tar-bar-soap',
      final: 'https://www.dr-squatch.com',
      reason: 'path_to_root',
    });
  });

  it('MALIGNA — producto descatalogado que redirige a la home (el caso NORMAL, sin dominio secuestrado)', () => {
    const hit = detectRedirectMismatch(
      'https://glow.example/products/serum-discontinued',
      'https://glow.example',
    );
    expect(hit?.reason).toBe('path_to_root');
  });

  it('MALIGNA — producto descatalogado → CATEGORÍA (el caso que el criterio "solo la raíz" tragaba)', () => {
    // La otra mitad del caso de uso (planning F2b: los descatalogados «redirigen a la home O A LA
    // CATEGORÍA»). Mismo host, path NO vacío: un criterio de "solo raíz desnuda" lo dejaba pasar
    // en silencio — el usuario pide UN jabón y el sistema analiza el catálogo entero.
    const hit = detectRedirectMismatch(
      'https://www.dr-squatch.com/products/pine-tar-bar-soap',
      'https://www.dr-squatch.com/collections/soaps',
    );
    expect(hit).toEqual({
      requested: 'https://www.dr-squatch.com/products/pine-tar-bar-soap',
      final: 'https://www.dr-squatch.com/collections/soaps',
      reason: 'path_diverged',
    });
  });

  it('MALIGNA — la página sale de su directorio (`/products/x` → `/x`)', () => {
    expect(
      detectRedirectMismatch('https://glow.example/products/serum', 'https://glow.example/serum')
        ?.reason,
    ).toBe('path_diverged');
  });

  it('MALIGNA — cambio de HOST (dominio caducado que redirige a otro sitio)', () => {
    const hit = detectRedirectMismatch(
      'https://glow.example/products/serum',
      'https://marketplace.otro-sitio.com/listing/42',
    );
    expect(hit).toEqual({
      requested: 'https://glow.example/products/serum',
      final: 'https://marketplace.otro-sitio.com/listing/42',
      reason: 'host_changed',
    });
  });

  it('MALIGNA — cambio de host a la raíz: manda `host_changed` (es el hallazgo más grave)', () => {
    expect(
      detectRedirectMismatch('https://glow.example/products/serum', 'https://parking.example/')
        ?.reason,
    ).toBe('host_changed');
  });

  it('una URL no parseable NO es un hallazgo (el comparador nunca rompe la ingesta)', () => {
    expect(detectRedirectMismatch('basura', 'https://glow.example')).toBeNull();
    expect(detectRedirectMismatch('https://glow.example/x', 'basura')).toBeNull();
  });
});
