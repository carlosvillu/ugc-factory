// Unit del ingester N2 (T1.4): Firecrawl `/v2/scrape` → fallback Jina, con msw
// interceptando el `fetch` global a nivel de red. PROHIBIDA la red real (skill testing):
// `onUnhandledRequest: 'error'` revienta cualquier fuga — un scrape real gasta dinero.
// Los fixtures son de autoría (shape de docs.firecrawl.dev), no grabaciones.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from '@ugc/test-utils';

import {
  CRAWL_LANDING_NO_INTERNAL_URL,
  CRAWL_LANDING_URL,
  FIRECRAWL_INTERNAL_FAQ,
  FIRECRAWL_INTERNAL_OPINIONES,
  FIRECRAWL_INTERNAL_REVIEWS,
  FIRECRAWL_INTERNAL_REVIEWS_SNIPPET,
  FIRECRAWL_INTERNAL_REVIEWS_WITH_LINKS,
  FIRECRAWL_LANDING_DISCOVERY_LINKS,
  FIRECRAWL_LANDING_NO_INTERNAL_DISCOVERY_LINKS,
  FIRECRAWL_LANDING_NO_INTERNAL_RICH,
  FIRECRAWL_LANDING_RICH,
  FIRECRAWL_RICH_TYPOGRAPHY,
  FIRECRAWL_SCRAPE_LEGACY_BRANDING,
  FIRECRAWL_SCRAPE_MANY_CREDITS,
  FIRECRAWL_SCRAPE_RICH,
  FIRECRAWL_SCREENSHOT_BYTES,
  FIRECRAWL_SCREENSHOT_URL,
  JINA_MARKDOWN,
  JINA_MARKDOWN_BODY,
} from '@ugc/test-utils/fixtures/firecrawl';

import { RawContentSchema } from '../contracts/raw-content';
import {
  discoverInternalUrls,
  FIRECRAWL_CENTS_PER_CREDIT,
  makeFirecrawlIngester,
} from './firecrawl';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v2';
const FIRECRAWL_SCRAPE = `${FIRECRAWL_BASE}/scrape`;
const JINA_BASE = 'https://r.jina.ai';
const TARGET_URL = 'https://glow.example/products/serum';

// Deps con una key de prueba (nunca sale a la red real: msw intercepta). Sin timeout
// override → el default de 60s no molesta porque los handlers responden al instante.
const ingester = makeFirecrawlIngester({ apiKey: 'fc-test-key' });

describe('ingester N2 — camino feliz Firecrawl (Verificación #1/#4)', () => {
  it('mapea markdown, ≥3 imágenes, branding.palette, product y descarga el screenshot', async () => {
    server.use(
      http.post(FIRECRAWL_SCRAPE, () => HttpResponse.json(FIRECRAWL_SCRAPE_RICH)),
      http.get(FIRECRAWL_SCREENSHOT_URL, () =>
        HttpResponse.arrayBuffer(FIRECRAWL_SCREENSHOT_BYTES.buffer, {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );

    const res = await ingester.ingest(TARGET_URL);

    expect(res.provider).toBe('firecrawl');
    expect(res.platform).toBe('shopify'); // /products/ → shopify
    // markdown legible (Verificación exige markdown).
    expect(res.raw.markdown).toContain('GlowSerum');
    // ≥3 imágenes (Verificación).
    expect(res.raw.images.length).toBeGreaterThanOrEqual(3);
    expect(res.raw.images[0]).toEqual({
      url: 'https://cdn.glow.example/hero.jpg',
      alt: 'GlowSerum packshot',
    });
    // string suelta → {url, alt:null}.
    expect(res.raw.images[1]).toEqual({ url: 'https://cdn.glow.example/lifestyle.jpg', alt: null });
    // branding.palette poblada desde el OBJETO de roles hex REAL (Verificación exige
    // paleta): Object.values del BrandingProfile.colors, en orden de inserción.
    expect(res.raw.branding?.palette).toEqual([
      '#0EA5A4',
      '#F8FAFC',
      '#F59E0B',
      '#FFFFFF',
      '#0F172A',
      '#475569',
    ]);
    // typography derivada de typography.fontFamilies (forma REAL), de-duplicada.
    expect(res.raw.branding?.typography).toBe(FIRECRAWL_RICH_TYPOGRAPHY);
    // product derivado de la PRIMERA variante (precio/moneda/disponibilidad por variante).
    expect(res.raw.product?.title).toBe('GlowSerum Ácido Hialurónico');
    expect(res.raw.product?.price).toBe('29.9');
    expect(res.raw.product?.currency).toBe('EUR');
    expect(res.raw.product?.availability).toBe('En stock');
    expect(res.raw.product?.variants).toEqual(['30ml', '50ml']);
    // El screenshot se DESCARGA (bytes) y viaja aparte; el ref lo estampa el caller.
    expect(res.raw.screenshotRef).toBeNull();
    expect(res.screenshot).not.toBeNull();
    expect(res.screenshot?.mime).toBe('image/png');
    expect(res.screenshot?.data).toEqual(FIRECRAWL_SCREENSHOT_BYTES);
    // Créditos: 1 (landing rico, creditsUsed ausente → default) + 1 (scrape de descubrimiento
    // full-page de T1.5; este handler devuelve el mismo fixture rich, sin `links` → discovery
    // vacío → mini-crawl skipped, sin internas). = 2.
    expect(res.credits).toBe(2);
    // Derivados de T1.3.
    expect(res.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.internalPages).toEqual([]);
    // T1.5: el descubrimiento no devolvió links → el único warning es el skip del mini-crawl.
    expect(res.warnings).toEqual(['internal_crawl_skipped']);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });

  it('branding legado (colors array + fonts[]) → palette/typography; data-URI; creditsUsed:5', async () => {
    server.use(
      http.post(FIRECRAWL_SCRAPE, () => HttpResponse.json(FIRECRAWL_SCRAPE_LEGACY_BRANDING)),
    );

    const res = await ingester.ingest('https://studio.example/product/chair');

    expect(res.provider).toBe('firecrawl');
    // colors como ARRAY de hex (forma legada de las docs) → palette directa.
    expect(res.raw.branding?.palette).toEqual(['#1D4ED8', '#93C5FD', '#F59E0B']);
    // typography desde el array `fonts` legado (fallback), de-duplicado.
    expect(res.raw.branding?.typography).toBe('Helvetica Neue, Georgia');
    // data-URI base64 → bytes decodificados SIN red (no hay handler de descarga y msw
    // reventaría si se saliera a la red).
    expect(res.screenshot).not.toBeNull();
    expect(res.screenshot?.mime).toBe('image/png');
    expect(res.screenshot?.data.length).toBeGreaterThan(0);
    // Variante única agotada.
    expect(res.raw.product?.price).toBe('349');
    expect(res.raw.product?.currency).toBe('USD');
    expect(res.raw.product?.availability).toBe('Agotado');
    // creditsUsed:5 PRESENTE → se lee (escalada stealth de proxy:auto). Este handler único
    // responde a AMBAS scrapes del landing (rica + descubrimiento) con el mismo fixture → 5 + 5
    // = 10. El descubrimiento no trae `links` → mini-crawl skipped, sin internas.
    expect(res.credits).toBe(10);
    expect(res.internalPages).toEqual([]);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });
});

describe('ingester N2 — coste en céntimos (guard del bug de magnitud 100×)', () => {
  it('la constante es CÉNTIMOS/crédito (0,083), no dólares (0,00083)', () => {
    // Plan Standard: $83 / 100.000 créditos = 0,083 CÉNTIMOS/crédito. La constante mala
    // (83/100_000 = 0,00083) son DÓLARES/crédito, 100× menor.
    expect(FIRECRAWL_CENTS_PER_CREDIT).toBeCloseTo(0.083, 6);
  });

  it('un recuento GRANDE de créditos da amount_cents NO CERO (100 créditos → 8 céntimos)', async () => {
    // El bug 100× sobrevivió porque ningún fixture cruzaba el umbral de 1 céntimo (1–5
    // créditos redondean a 0 con AMBAS constantes). Este assert lo cierra: con la constante
    // correcta, 100 × 0,083 = 8,3 → round = 8; con la mala, 100 × 0,00083 = 0,083 → 0.
    // El scrape RICO del landing (main-content) devuelve 100 créditos; el de descubrimiento
    // (main-content:false) devuelve un fixture SIN creditsUsed → default 1. Total 101. Lo que
    // este test blinda es el mapeo créditos→céntimos con la constante correcta (no el total).
    server.use(
      http.post(FIRECRAWL_SCRAPE, async ({ request }) => {
        const body = (await request.json()) as { onlyMainContent: boolean };
        return HttpResponse.json(
          body.onlyMainContent
            ? FIRECRAWL_SCRAPE_MANY_CREDITS
            : { success: true, data: { links: [], metadata: {} } },
        );
      }),
    );
    const res = await ingester.ingest(TARGET_URL);
    expect(res.credits).toBe(101); // 100 (landing rico) + 1 (descubrimiento, default)
    // El mapeo créditos→céntimos que el servicio aplica (Math.round(credits × constante)) sobre
    // el recuento acumulado: 101 × 0,083 = 8,38 → round = 8; con la constante mala (100× menor),
    // 101 × 0,00083 = 0,084 → 0. El guard end-to-end usa el valor REAL de res.credits.
    expect(Math.round(res.credits * FIRECRAWL_CENTS_PER_CREDIT)).toBe(8);
  });
});

describe('ingester N2 — FALLBACK transparente a Jina (Verificación #3)', () => {
  it('Firecrawl 401 (key inválida) → Jina produce al menos el markdown, RawContent válido', async () => {
    server.use(
      // 401 = key de Firecrawl inválida (ES la Verificación).
      http.post(FIRECRAWL_SCRAPE, () => new HttpResponse(null, { status: 401 })),
      // Jina Reader devuelve el markdown de la página.
      http.get(`${JINA_BASE}/*`, () => HttpResponse.text(JINA_MARKDOWN)),
    );

    const res = await ingester.ingest(TARGET_URL);

    expect(res.provider).toBe('jina');
    // Al MENOS el markdown (la Verificación lo exige con key Firecrawl inválida).
    expect(res.raw.markdown).toContain(JINA_MARKDOWN_BODY);
    // Jina es solo lectura: branding/product/screenshot pueden faltar.
    expect(res.raw.branding).toBeUndefined();
    expect(res.raw.product).toBeUndefined();
    expect(res.raw.images).toEqual([]);
    expect(res.raw.screenshotRef).toBeNull();
    expect(res.screenshot).toBeNull();
    // Sin créditos de Firecrawl (el fallback no facturó por scrape).
    expect(res.credits).toBe(0);
    // El warning documenta por qué se cayó a Jina (401), sin romper la ingesta.
    expect(res.warnings).toContain('firecrawl_status_401');
    // El RawContent SIGUE siendo válido pese a la degradación.
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });

  it('Firecrawl 5xx → también cae a Jina (degradación transparente)', async () => {
    server.use(
      http.post(FIRECRAWL_SCRAPE, () => new HttpResponse(null, { status: 503 })),
      http.get(`${JINA_BASE}/*`, () => HttpResponse.text(JINA_MARKDOWN)),
    );

    const res = await ingester.ingest(TARGET_URL);
    expect(res.provider).toBe('jina');
    expect(res.raw.markdown).toContain(JINA_MARKDOWN_BODY);
    expect(res.warnings).toContain('firecrawl_status_503');
  });

  it('Firecrawl Y Jina caídos → RawContent válido con markdown vacío (nunca fila rota)', async () => {
    server.use(
      http.post(FIRECRAWL_SCRAPE, () => new HttpResponse(null, { status: 401 })),
      http.get(`${JINA_BASE}/*`, () => new HttpResponse(null, { status: 429 })),
    );

    const res = await ingester.ingest(TARGET_URL);
    expect(res.provider).toBe('jina');
    expect(res.raw.markdown).toBe('');
    // Aun con ambos caídos, el contrato se cumple (source='url', images:[]).
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
    expect(res.warnings).toContain('jina_status_429');
  });
});

describe('ingester N2 — el request a Firecrawl lleva el contrato de la Entrega', () => {
  it('scrape RICO del landing: formats, onlyMainContent:true, proxy:auto, Bearer; SIN links', async () => {
    // Captura la request RICA del landing (onlyMainContent:true). El ingest también emite un
    // scrape de descubrimiento (onlyMainContent:false, ver el test de CONTRATO DE REQUEST); se
    // filtra por el flag para no confundir ambas.
    let captured: { auth: string | null; body: Record<string, unknown> } | undefined;
    server.use(
      http.post(FIRECRAWL_SCRAPE, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.onlyMainContent === true) {
          captured = { auth: request.headers.get('authorization'), body };
        }
        return HttpResponse.json(FIRECRAWL_SCRAPE_LEGACY_BRANDING);
      }),
    );

    await ingester.ingest('https://studio.example/product/chair');

    expect(captured?.auth).toBe('Bearer fc-test-key');
    const body = captured?.body as unknown as {
      url: string;
      formats: unknown[];
      onlyMainContent: boolean;
      proxy: string;
    };
    expect(body.url).toBe('https://studio.example/product/chair');
    expect(body.onlyMainContent).toBe(true);
    expect(body.proxy).toBe('auto');
    expect(body.formats).toContain('markdown');
    expect(body.formats).toContain('images');
    expect(body.formats).toContain('branding');
    expect(body.formats).toContain('product');
    // El scrape RICO ya NO pide `links` (T1.5 fix): los links llegan por el scrape de
    // descubrimiento full-page aparte (onlyMainContent:false), no de este main-content scrape.
    expect(body.formats).not.toContain('links');
    // screenshot es un objeto {type, fullPage} (full-page, research §5).
    expect(body.formats).toContainEqual({ type: 'screenshot', fullPage: true });
  });
});

// ── T1.5: descubrimiento PURO de URLs internas (unit determinista) ───────────────
describe('discoverInternalUrls — filtro same-domain, path, dedupe y cap (T1.5)', () => {
  const LANDING = 'https://glow.example/products/serum';

  it('descubre reviews/faq/opiniones same-domain (variantes idioma/CMS), cap 3 duro', () => {
    const found = discoverInternalUrls(LANDING, [
      'https://glow.example/pages/reviews',
      'https://glow.example/es/opiniones',
      'https://glow.example/faq',
      'https://glow.example/valoraciones', // 4ª candidata REAL → excluida por cap
    ]);
    // Cap 3 duro: la 4ª candidata NO entra (todas casan el patrón → prueba el cap, no el filtro).
    expect(found).toHaveLength(3);
    expect(found).toEqual([
      'https://glow.example/pages/reviews',
      'https://glow.example/es/opiniones',
      'https://glow.example/faq',
    ]);
  });

  it('FIX 1: la keyword debe TERMINAR el segmento — casa páginas reales, NO slugs con basura', () => {
    const found = discoverInternalUrls(LANDING, [
      // Convenciones REALES de página (keyword al final del segmento) → casan.
      'https://glow.example/reviews',
      'https://glow.example/product-reviews',
      'https://glow.example/about',
      // Slugs de producto con basura detrás de la keyword → NO casan (evita desplazar
      // la página real bajo el cap).
      'https://glow.example/reviews-are-fake-serum',
      'https://glow.example/about-our-coffee',
      'https://glow.example/faq-lite-serum',
    ]);
    expect(found).toEqual([
      'https://glow.example/reviews',
      'https://glow.example/product-reviews',
      'https://glow.example/about',
    ]);
  });

  it('filtra off-site (mismo path de interés, distinto dominio registrable)', () => {
    const found = discoverInternalUrls(LANDING, [
      'https://glow-cdn.net/reviews', // off-site → fuera
      'https://facebook.com/glow/reviews', // off-site → fuera
      'https://shop.glow.example/reviews', // subdominio del MISMO registrable → dentro
    ]);
    expect(found).toEqual(['https://shop.glow.example/reviews']);
  });

  it('ignora links irrelevantes (home, cart, otros productos)', () => {
    const found = discoverInternalUrls(LANDING, [
      'https://glow.example/',
      'https://glow.example/cart',
      'https://glow.example/products/other',
    ]);
    expect(found).toEqual([]);
  });

  it('FIX 2: deduplica por pathname (ignora query) y excluye el propio landing', () => {
    const found = discoverInternalUrls('https://glow.example/reviews', [
      'https://glow.example/reviews', // el propio landing → excluido
      'https://glow.example/reviews/', // misma página (barra final) → dedupe con el landing
      'https://glow.example/faq',
      'https://glow.example/faq?ref=nav', // MISMA página que /faq (query de tracking) → dedupe
    ]);
    // /faq y /faq?ref=nav son la MISMA página → una sola entrada (la primera vista). Antes
    // de FIX 2 sobrevivían ambas (dedupe por URL completa con query): doble scrape + heading
    // duplicado + expulsión de una interna genuina bajo el cap. Se conserva la 1ª forma vista.
    expect(found).toEqual(['https://glow.example/faq']);
  });

  it('sin links → vacío (semilla del skipped)', () => {
    expect(discoverInternalUrls(LANDING, [])).toEqual([]);
  });
});

// ── T1.5: mini-crawl integrado en ingest() (msw switch por url + onlyMainContent) ─
describe('mini-crawl de páginas internas — ingest() (Verificación T1.5)', () => {
  /**
   * Handler único de `POST /scrape` que despacha por (url, onlyMainContent) del body — msw
   * casa por ENDPOINT, no por body → el switch vive aquí. CLAVE del fix del verify: el scrape
   * de DESCUBRIMIENTO del landing (`onlyMainContent:false`, `formats:['links']`) devuelve
   * `discoveryLinks`; el scrape RICO del landing (`onlyMainContent:true`) devuelve `landingRich`
   * SIN links. Así los links SOLO llegan por la request full-page real — un test que los
   * inyectara al scrape rico no probaría el contrato (era el hueco del ciclo anterior).
   */
  function scrapeRouter(
    landingRich: object,
    discoveryLinks: object,
    internals: Record<string, object>,
    failPaths = new Set<string>(),
  ) {
    return http.post(FIRECRAWL_SCRAPE, async ({ request }) => {
      const body = (await request.json()) as { url: string; onlyMainContent: boolean };
      const path = new URL(body.url).pathname;
      if (failPaths.has(path)) return new HttpResponse(null, { status: 503 });
      const internal = internals[path];
      if (internal) return HttpResponse.json(internal);
      // Landing: el scrape de descubrimiento (main-content:false) da los links; el rico, no.
      return HttpResponse.json(body.onlyMainContent ? landingRich : discoveryLinks);
    });
  }

  it('Observable #1: landing con links → anexa markdown de reviews (heading por página, cap 3)', async () => {
    server.use(
      scrapeRouter(FIRECRAWL_LANDING_RICH, FIRECRAWL_LANDING_DISCOVERY_LINKS, {
        '/pages/reviews': FIRECRAWL_INTERNAL_REVIEWS,
        '/es/opiniones': FIRECRAWL_INTERNAL_OPINIONES,
        '/faq': FIRECRAWL_INTERNAL_FAQ,
      }),
    );

    const res = await ingester.ingest(CRAWL_LANDING_URL);

    expect(res.provider).toBe('firecrawl');
    // El markdown del landing SIGUE presente (no se reemplaza, se anexa).
    expect(res.raw.markdown).toContain('# GlowSerum');
    // Texto de reviews RECONOCIBLE anexado (la 1ª observable literal).
    expect(res.raw.markdown).toContain(FIRECRAWL_INTERNAL_REVIEWS_SNIPPET);
    // Un heading `## <path>` por página anexada.
    expect(res.raw.markdown).toContain('## /pages/reviews');
    expect(res.raw.markdown).toContain('## /es/opiniones');
    expect(res.raw.markdown).toContain('## /faq');
    // Cap 3 respetado (/valoraciones era la 4ª candidata REAL → NO se rastrea).
    expect(res.internalPages).toHaveLength(3);
    expect(res.raw.markdown).not.toContain('## /valoraciones');
    // FIX 1: el slug basura /reviews-are-fake-serum NO se rastrea (no keyword-al-final).
    expect(res.raw.markdown).not.toContain('reviews-are-fake-serum');
    // Créditos: 1 (landing rico) + 1 (scrape de descubrimiento full-page) + 3 internas = 5.
    expect(res.credits).toBe(5);
    expect(res.warnings).not.toContain('internal_crawl_skipped');
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });

  it('Observable #2: landing SIN páginas internas → skipped, markdown intacto, cero error', async () => {
    server.use(
      scrapeRouter(
        FIRECRAWL_LANDING_NO_INTERNAL_RICH,
        FIRECRAWL_LANDING_NO_INTERNAL_DISCOVERY_LINKS,
        {},
      ),
    );

    const res = await ingester.ingest(CRAWL_LANDING_NO_INTERNAL_URL);

    expect(res.provider).toBe('firecrawl');
    // El markdown queda EXACTAMENTE el del landing (nada anexado).
    expect(res.raw.markdown).toBe('# Landing sin páginas internas\n\nSolo home y carrito.');
    expect(res.raw.markdown).not.toContain('## ');
    expect(res.internalPages).toEqual([]);
    // Marca de skipped presente; el descubrimiento SÍ facturó (1) aunque no descubriera nada.
    expect(res.warnings).toContain('internal_crawl_skipped');
    // Créditos: 1 (landing rico) + 1 (scrape de descubrimiento) = 2. Sin internas.
    expect(res.credits).toBe(2);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });

  it('CONTRATO DE REQUEST (fix verify): descubrimiento full-page con onlyMainContent:false; rico main-content sin links', async () => {
    // Captura TODAS las requests a /scrape para el landing y separa por onlyMainContent.
    const requests: { onlyMainContent: boolean; formats: unknown[] }[] = [];
    server.use(
      http.post(FIRECRAWL_SCRAPE, async ({ request }) => {
        const body = (await request.json()) as {
          url: string;
          onlyMainContent: boolean;
          formats: unknown[];
        };
        requests.push({ onlyMainContent: body.onlyMainContent, formats: body.formats });
        // Landing rico (main-content) vs descubrimiento (links). Sin internas descubiertas
        // aquí (los discovery links no casan) → el foco es el contrato de request.
        return HttpResponse.json(
          body.onlyMainContent
            ? FIRECRAWL_LANDING_RICH
            : FIRECRAWL_LANDING_NO_INTERNAL_DISCOVERY_LINKS,
        );
      }),
    );

    await ingester.ingest(CRAWL_LANDING_URL);

    // El scrape RICO del landing: onlyMainContent:true, con markdown+screenshot, SIN links.
    const rich = requests.find((r) => r.onlyMainContent);
    expect(rich).toBeDefined();
    expect(rich?.formats).toContain('markdown');
    expect(rich?.formats).toContainEqual({ type: 'screenshot', fullPage: true });
    expect(rich?.formats).not.toContain('links');

    // El scrape de DESCUBRIMIENTO: onlyMainContent:FALSE (ve el nav/footer) y formats:['links'].
    // Este es el assert que cierra el hueco: sin onlyMainContent:false, los links del nav/footer
    // NUNCA llegan y el mini-crawl skipea en toda tienda real (la causa raíz del verify FAIL).
    const discovery = requests.find((r) => !r.onlyMainContent);
    expect(discovery).toBeDefined();
    expect(discovery?.formats).toEqual(['links']);
  });

  it('Observable #3: una interna que falla al scrape → warning, NO error, el resto se anexa', async () => {
    server.use(
      scrapeRouter(
        FIRECRAWL_LANDING_RICH,
        FIRECRAWL_LANDING_DISCOVERY_LINKS,
        {
          '/es/opiniones': FIRECRAWL_INTERNAL_OPINIONES,
          '/faq': FIRECRAWL_INTERNAL_FAQ,
        },
        // /pages/reviews falla con 5xx en Firecrawl.
        new Set(['/pages/reviews']),
      ),
      // El fallback Jina de la interna fallida también cae → esa página se salta.
      http.get(`${JINA_BASE}/*`, () => new HttpResponse(null, { status: 503 })),
    );

    const res = await ingester.ingest(CRAWL_LANDING_URL);

    // NO lanza; las otras dos internas SÍ se anexan.
    expect(res.raw.markdown).toContain('## /es/opiniones');
    expect(res.raw.markdown).toContain('## /faq');
    // La fallida no se anexa.
    expect(res.raw.markdown).not.toContain('## /pages/reviews');
    expect(res.internalPages).toEqual([
      'https://glow.example/es/opiniones',
      'https://glow.example/faq',
    ]);
    // Warning de degradación (Firecrawl 503 sobre la interna), no error.
    expect(res.warnings).toContain('firecrawl_status_503');
    // Créditos: 1 (landing rico) + 1 (descubrimiento) + 2 internas OK = 4 (la fallida no factura).
    expect(res.credits).toBe(4);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });

  it('FIX 3: contentHash es determinista del LANDING — un fallo transitorio de interna no lo cambia', async () => {
    // Pasada A: todas las internas OK.
    server.use(
      scrapeRouter(FIRECRAWL_LANDING_RICH, FIRECRAWL_LANDING_DISCOVERY_LINKS, {
        '/pages/reviews': FIRECRAWL_INTERNAL_REVIEWS,
        '/es/opiniones': FIRECRAWL_INTERNAL_OPINIONES,
        '/faq': FIRECRAWL_INTERNAL_FAQ,
      }),
    );
    const healthy = await ingester.ingest(CRAWL_LANDING_URL);

    server.resetHandlers();

    // Pasada B: MISMO landing, pero una interna falla transitoriamente (5xx en Firecrawl y
    // Jina) → su markdown NO se anexa. El markdown ENRIQUECIDO difiere entre A y B...
    server.use(
      scrapeRouter(
        FIRECRAWL_LANDING_RICH,
        FIRECRAWL_LANDING_DISCOVERY_LINKS,
        {
          '/es/opiniones': FIRECRAWL_INTERNAL_OPINIONES,
          '/faq': FIRECRAWL_INTERNAL_FAQ,
        },
        new Set(['/pages/reviews']),
      ),
      http.get(`${JINA_BASE}/*`, () => new HttpResponse(null, { status: 503 })),
    );
    const degraded = await ingester.ingest(CRAWL_LANDING_URL);

    // ...pero el contentHash NO (se calcula sobre el markdown PROPIO del landing, idéntico en
    // ambas pasadas). La identidad del análisis es el LANDING; las internas son best-effort.
    expect(degraded.raw.markdown).not.toBe(healthy.raw.markdown); // el enriquecido SÍ difiere
    expect(degraded.contentHash).toBe(healthy.contentHash); // el hash NO
  });

  it('Observable #4: SIN recursión — los links de una página interna NO se siguen', async () => {
    // El descubrimiento enlaza a UNA sola interna (reviews). Esa página de reviews trae a su
    // vez links a /about y /faq: si hubiera recursión, se rastrearían. NO deben seguirse — el
    // mini-crawl NUNCA pide `links` de una página interna (solo markdown), así que aunque la
    // respuesta interna los traiga, no se leen.
    const discoveryOneLink = {
      success: true,
      data: {
        links: ['https://glow.example/pages/reviews'],
        metadata: { statusCode: 200 },
      },
    };
    server.use(
      scrapeRouter(FIRECRAWL_LANDING_RICH, discoveryOneLink, {
        '/pages/reviews': FIRECRAWL_INTERNAL_REVIEWS_WITH_LINKS,
      }),
    );

    const res = await ingester.ingest(CRAWL_LANDING_URL);

    // La reviews SÍ se anexa.
    expect(res.raw.markdown).toContain('## /pages/reviews');
    expect(res.internalPages).toEqual(['https://glow.example/pages/reviews']);
    // Pero las páginas que la REVIEWS enlaza (/about, /faq) NO se rastrean (sin recursión).
    expect(res.raw.markdown).not.toContain('## /about');
    expect(res.raw.markdown).not.toContain('## /faq');
    expect(res.internalPages).not.toContain('https://glow.example/about');
    // Créditos: 1 (landing rico) + 1 (descubrimiento) + 1 (reviews) = 3. Si recursara, más.
    expect(res.credits).toBe(3);
  });

  it('fallback Jina en el landing (Firecrawl 401) → sin links → mini-crawl skipped', async () => {
    server.use(
      http.post(FIRECRAWL_SCRAPE, () => new HttpResponse(null, { status: 401 })),
      http.get(`${JINA_BASE}/*`, () => HttpResponse.text(JINA_MARKDOWN)),
    );

    const res = await ingester.ingest(CRAWL_LANDING_URL);

    expect(res.provider).toBe('jina');
    // El mini-crawl solo corre en el camino Firecrawl (Jina no devuelve links). En el
    // fallback NO se intenta → no hay páginas internas ni markdown anexado. Es el skip
    // NATURAL (correcto, no un gap): el warning explícito 'internal_crawl_skipped' es del
    // camino Firecrawl-con-links-vacíos, no de este.
    expect(res.internalPages).toEqual([]);
    expect(res.raw.markdown).toContain(JINA_MARKDOWN_BODY);
    expect(res.raw.markdown).not.toContain('## /');
  });
});
