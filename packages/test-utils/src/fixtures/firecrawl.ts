// Fixtures de la respuesta de Firecrawl `/v2/scrape` (T1.4), fieles a la forma REAL
// documentada en docs.firecrawl.dev (BrandingProfile, product por variante, envelope
// `{success, data:{...}}`). NO son grabaciones de red (el sandbox está bloqueado, como
// en T1.3) pero SÍ reproducen el shape real para que los tests ejerciten el camino que
// el verifier golpeará con red real — evitando el trap de "fixture inventado" de T1.3:
//  - `branding.colors` es un OBJETO de roles con valores HEX STRING (`{primary:"#..."}`,
//    la forma real); se cubre además la forma legada de array de hex con un fixture aparte.
//  - `branding.typography.fontFamilies` (`{primary, heading, code}`) — las fuentes NO son
//    un array `fonts` de strings de nivel superior.
//  - `product` NO tiene price/currency/availability de nivel superior: viven por variante.
//  - `screenshot` como URL http(s) (expira 24h → se descarga) y como data-URI base64.
//  - `metadata.creditsUsed` NO lo reporta la scrape de página única (solo el batch) → hay
//    una variante SIN él (default) y otra CON él (lectura del valor).
//
// Viven en @ugc/test-utils (subpath `./fixtures/firecrawl`, stack-setup.md §4) porque los
// COMPARTEN el unit del ingester en @ugc/core y la cadena de persistencia en apps/web.

/** Respuesta rica con la forma REAL: markdown, ≥3 imágenes, `branding` como BrandingProfile
 *  (colors objeto de roles hex + typography.fontFamilies), product por variante, screenshot
 *  como URL http(s). SIN `creditsUsed` (el caso real del endpoint de página única → default). */
export const FIRECRAWL_SCRAPE_RICH = {
  success: true,
  data: {
    markdown:
      '# GlowSerum\n\nHidratación clínica en 24h. Ácido hialurónico + niacinamida.\n\n**4,9/5** · +12.000 clientes.',
    images: [
      { url: 'https://cdn.glow.example/hero.jpg', alt: 'GlowSerum packshot' },
      'https://cdn.glow.example/lifestyle.jpg',
      { url: 'https://cdn.glow.example/detail.jpg', alt: null },
      { url: 'https://cdn.glow.example/ingredients.jpg', alt: 'Ingredientes' },
    ],
    branding: {
      colorScheme: 'light',
      logo: 'https://cdn.glow.example/logo.svg',
      colors: {
        primary: '#0EA5A4',
        secondary: '#F8FAFC',
        accent: '#F59E0B',
        background: '#FFFFFF',
        textPrimary: '#0F172A',
        textSecondary: '#475569',
      },
      typography: {
        fontFamilies: { primary: 'Inter', heading: 'Fraunces', code: 'Roboto Mono' },
        fontSizes: { h1: '48px', body: '16px' },
      },
      spacing: { baseUnit: 8, borderRadius: '8px' },
      images: {
        logo: 'https://cdn.glow.example/logo.svg',
        favicon: 'https://cdn.glow.example/favicon.ico',
      },
    },
    product: {
      title: 'GlowSerum Ácido Hialurónico',
      brand: 'Glow',
      variants: [
        {
          title: '30ml',
          price: { amount: 29.9, currency: 'EUR', formatted: '29,90 €' },
          availability: { inStock: true, text: 'En stock' },
        },
        {
          title: '50ml',
          price: { amount: 44.9, currency: 'EUR', formatted: '44,90 €' },
          availability: { inStock: true, text: 'En stock' },
        },
      ],
    },
    screenshot: 'https://storage.firecrawl.dev/screenshots/glow-abc123.png',
    metadata: { title: 'GlowSerum', sourceURL: 'https://glow.example/serum', statusCode: 200 },
  },
} as const;

/** Familias de fuente esperadas de `FIRECRAWL_SCRAPE_RICH` (de `typography.fontFamilies`,
 *  de-duplicadas por orden) — el string que `mapTypography` debe producir. */
export const FIRECRAWL_RICH_TYPOGRAPHY = 'Inter, Fraunces, Roboto Mono';

/** URL del screenshot de `FIRECRAWL_SCRAPE_RICH` (para montar su handler de descarga). */
export const FIRECRAWL_SCREENSHOT_URL = 'https://storage.firecrawl.dev/screenshots/glow-abc123.png';

/** Bytes PNG mínimos (firma PNG) que devuelve el handler del screenshot. */
export const FIRECRAWL_SCREENSHOT_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

/** Variante con `branding.colors` como array de hex LEGADO (la otra forma que las docs
 *  muestran) + `fonts` legado, y `screenshot` como data-URI base64 (sin red). CON
 *  `creditsUsed:5` en metadata (escalada stealth de `proxy:auto`) → el ingester DEBE leer
 *  ese 5. Cubre a la vez: forma de colors legada, typography legada (`fonts`) y créditos. */
export const FIRECRAWL_SCRAPE_LEGACY_BRANDING = {
  success: true,
  data: {
    markdown: '# Studio Chair\n\nErgonomía premium.',
    images: [
      'https://cdn.studio.example/chair-1.jpg',
      'https://cdn.studio.example/chair-2.jpg',
      'https://cdn.studio.example/chair-3.jpg',
    ],
    branding: {
      colors: ['#1D4ED8', '#93C5FD', '#F59E0B'],
      fonts: ['Helvetica Neue', 'Georgia'],
    },
    product: {
      title: 'Studio Chair',
      variants: [
        {
          title: 'Negro',
          price: { amount: 349, currency: 'USD' },
          availability: { inStock: false, text: 'Agotado' },
        },
      ],
    },
    // data-URI: 1x1 PNG transparente en base64 (se decodifica sin red).
    screenshot:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    metadata: { creditsUsed: 5, statusCode: 200 },
  },
} as const;

/** Recuento de créditos GRANDE para asertar un `amount_cents` NO CERO (el bug 100× de la
 *  constante sobrevivió porque ningún fixture cruzaba el umbral de 1 céntimo). 100 créditos
 *  × 0,083 céntimos/crédito = 8,3 → `Math.round` = 8 céntimos. */
export const FIRECRAWL_SCRAPE_MANY_CREDITS = {
  success: true,
  data: {
    markdown: '# Bulk Page\n\nPágina que costó muchos créditos (stealth acumulado).',
    images: ['https://cdn.bulk.example/a.jpg'],
    metadata: { creditsUsed: 100, statusCode: 200 },
  },
} as const;

/** Markdown que devuelve el fallback Jina Reader, con el PREÁMBULO real de `r.jina.ai`
 *  (`Title:/URL Source:/Markdown Content:`) antes del cuerpo. Los asserts usan `.toContain`
 *  del cuerpo, no `.toBe` exacto: el preámbulo es contexto legítimo (la cláusula del verifier
 *  es "Jina produce AL MENOS el markdown"), y un fixture fiel evita ocultar regresiones. */
export const JINA_MARKDOWN =
  'Title: GlowSerum\n\nURL Source: https://glow.example/products/serum\n\nMarkdown Content:\n# GlowSerum\n\nHidratación clínica en 24h. Contenido leído por Jina Reader.';

/** El cuerpo (sin preámbulo) que los asserts buscan con `.toContain`. */
export const JINA_MARKDOWN_BODY = 'Hidratación clínica en 24h. Contenido leído por Jina Reader.';
