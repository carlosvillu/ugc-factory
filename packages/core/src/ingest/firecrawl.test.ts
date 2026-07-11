// Unit del ingester N2 (T1.4): Firecrawl `/v2/scrape` → fallback Jina, con msw
// interceptando el `fetch` global a nivel de red. PROHIBIDA la red real (skill testing):
// `onUnhandledRequest: 'error'` revienta cualquier fuga — un scrape real gasta dinero.
// Los fixtures son de autoría (shape de docs.firecrawl.dev), no grabaciones.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from '@ugc/test-utils';

import {
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
import { FIRECRAWL_CENTS_PER_CREDIT, makeFirecrawlIngester } from './firecrawl';

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
    // creditsUsed AUSENTE en la respuesta → default 1 crédito.
    expect(res.credits).toBe(1);
    // Derivados de T1.3.
    expect(res.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.warnings).toEqual([]);
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
    // creditsUsed:5 PRESENTE → se lee (escalada stealth de proxy:auto).
    expect(res.credits).toBe(5);
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
    server.use(http.post(FIRECRAWL_SCRAPE, () => HttpResponse.json(FIRECRAWL_SCRAPE_MANY_CREDITS)));
    const res = await ingester.ingest(TARGET_URL);
    expect(res.credits).toBe(100);
    // El mapeo créditos→céntimos que el servicio aplica (Math.round(credits × constante)).
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
  it('POST /scrape con formats, onlyMainContent, proxy:auto y Authorization Bearer', async () => {
    let captured: { auth: string | null; body: unknown } | undefined;
    server.use(
      http.post(FIRECRAWL_SCRAPE, async ({ request }) => {
        captured = {
          auth: request.headers.get('authorization'),
          body: await request.json(),
        };
        return HttpResponse.json(FIRECRAWL_SCRAPE_LEGACY_BRANDING);
      }),
    );

    await ingester.ingest('https://studio.example/product/chair');

    expect(captured?.auth).toBe('Bearer fc-test-key');
    const body = captured?.body as {
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
    // screenshot es un objeto {type, fullPage} (full-page, research §5).
    expect(body.formats).toContainEqual({ type: 'screenshot', fullPage: true });
  });
});
