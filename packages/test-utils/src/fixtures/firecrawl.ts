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

// ── Fixtures del mini-crawl de páginas internas (T1.5, research §3.5) ─────────────
// El mini-crawl usa DOS scrapes del landing (fix del verify): el scrape RICO
// (`onlyMainContent:true`, markdown/branding/product/screenshot — SIN links) y un scrape de
// DESCUBRIMIENTO aparte (`onlyMainContent:false`, `formats:['links']`) que SÍ ve el nav/footer
// donde viven los enlaces internos. Por eso el fixture de links está SEPARADO del rico y se
// ATA a la request de descubrimiento por su `onlyMainContent:false` (así el test prueba el
// contrato real, no inyecta links a ciegas). La respuesta v2 da `data.links` como array<string>.

/** URL del landing del mini-crawl (misma tienda Shopify que el resto de fixtures). */
export const CRAWL_LANDING_URL = 'https://glow.example/products/serum';

/** Scrape RICO del landing (`onlyMainContent:true`): markdown limpio, sin links (el nav/footer
 *  se strippea — por eso los links llegan por el scrape de descubrimiento aparte). `screenshot`
 *  como data-URI (sin red en el handler del screenshot). Invariante T1.4: markdown SIN
 *  boilerplate de nav/footer. */
export const FIRECRAWL_LANDING_RICH = {
  success: true,
  data: {
    markdown: '# GlowSerum\n\nHidratación clínica en 24h.',
    images: ['https://cdn.glow.example/hero.jpg'],
    screenshot:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    metadata: { statusCode: 200 },
  },
} as const;

/** Scrape de DESCUBRIMIENTO del landing (`onlyMainContent:false`, `formats:['links']`): los
 *  links del nav/footer. 4 candidatas same-domain de interés (reviews/opiniones/faq/valoraciones,
 *  todas keyword-al-final tras FIX 1) para probar el cap 3; un off-site (`glow-cdn.net/reviews`)
 *  que el filtro de dominio DEBE descartar pese a casar el path; un slug de producto con basura
 *  tras la keyword (`/reviews-are-fake-serum`) que FIX 1 NO debe casar; y links irrelevantes
 *  (home, cart) que se ignoran por path. */
export const FIRECRAWL_LANDING_DISCOVERY_LINKS = {
  success: true,
  data: {
    links: [
      'https://glow.example/',
      'https://glow.example/cart',
      // Slug de producto con basura tras `reviews` → FIX 1 lo descarta (no keyword-al-final).
      'https://glow.example/reviews-are-fake-serum',
      'https://glow.example/pages/reviews',
      'https://glow.example/es/opiniones',
      'https://glow.example/faq',
      'https://glow.example/valoraciones', // 4ª candidata real → excluida por el cap de 3.
      // Off-site (CDN) con path de interés → DEBE filtrarse por dominio registrable.
      'https://glow-cdn.net/reviews',
    ],
    metadata: { statusCode: 200 },
  },
} as const;

/** Respuesta de la scrape LIGERA (markdown-only) de la página de reviews. Su texto es
 *  reconociblemente de reviews (la 1ª observable: "el markdown anexado contiene texto de
 *  reviews reconocible"). SIN `creditsUsed` → 1 crédito por defecto. */
export const FIRECRAWL_INTERNAL_REVIEWS = {
  success: true,
  data: {
    markdown:
      '# Opiniones de clientes\n\n★★★★★ "Mi piel cambió en una semana" — Marta R.\n★★★★☆ "Buen serum, algo caro" — Luis P.',
    metadata: { statusCode: 200 },
  },
} as const;

/** Fragmento reconocible del markdown de reviews que la 1ª observable busca anexado. */
export const FIRECRAWL_INTERNAL_REVIEWS_SNIPPET = 'Mi piel cambió en una semana';

/** Respuesta de la scrape ligera de la página de opiniones (2ª interna del cap). */
export const FIRECRAWL_INTERNAL_OPINIONES = {
  success: true,
  data: {
    markdown: '# Opiniones\n\nValoración media 4,8/5 sobre 1.240 reseñas verificadas.',
    metadata: { statusCode: 200 },
  },
} as const;

/** Respuesta de la scrape ligera de la página de FAQ (3ª interna del cap). */
export const FIRECRAWL_INTERNAL_FAQ = {
  success: true,
  data: {
    markdown:
      '# Preguntas frecuentes\n\n¿Es apto para piel sensible? Sí, dermatológicamente testado.',
    metadata: { statusCode: 200 },
  },
} as const;

/** Página de reviews que a su vez ENLAZA a una 4ª página interna de interés (`/about`).
 *  Sirve para fijar la NO-RECURSIÓN (Observable #4): la scrape ligera pide markdown-only
 *  (sin `links`), pero aunque la respuesta los traiga, el mini-crawl NUNCA sigue los links
 *  de una página interna. `/about` NO debe rastrearse ni anexarse. */
export const FIRECRAWL_INTERNAL_REVIEWS_WITH_LINKS = {
  success: true,
  data: {
    markdown: '# Opiniones de clientes\n\n★★★★★ "Mi piel cambió en una semana" — Marta R.',
    // Links a una 4ª interna: si hubiera recursión, se rastrearía. NO debe seguirse.
    links: ['https://glow.example/about', 'https://glow.example/faq'],
    metadata: { statusCode: 200 },
  },
} as const;

/** Scrape RICO del landing sin páginas internas (`onlyMainContent:true`): markdown limpio. */
export const FIRECRAWL_LANDING_NO_INTERNAL_RICH = {
  success: true,
  data: {
    markdown: '# Landing sin páginas internas\n\nSolo home y carrito.',
    images: ['https://cdn.shop.example/a.jpg'],
    metadata: { statusCode: 200 },
  },
} as const;

/** Scrape de DESCUBRIMIENTO del landing sin páginas internas: solo enlaces irrelevantes (home,
 *  cart, otro producto) y off-site. El mini-crawl NO descubre nada → resultado `skipped`,
 *  markdown intacto (2ª observable). */
export const FIRECRAWL_LANDING_NO_INTERNAL_DISCOVERY_LINKS = {
  success: true,
  data: {
    links: [
      'https://shop.example/',
      'https://shop.example/cart',
      'https://shop.example/products/other',
      'https://facebook.com/shop',
    ],
    metadata: { statusCode: 200 },
  },
} as const;

/** URL del landing sin páginas internas (2ª observable). */
export const CRAWL_LANDING_NO_INTERNAL_URL = 'https://shop.example/products/thing';
