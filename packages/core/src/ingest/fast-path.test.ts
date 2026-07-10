// Fallback transparente end-to-end del cliente HTTP fino (HEADLINE 1). msw
// intercepta el `fetch` global a nivel de red; los tests montan handlers que
// devuelven los fixtures reales (incluidos 404/401 del `.json`). PROHIBIDA la red
// real (skill testing): `onUnhandledRequest: 'error'` revienta cualquier fuga.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from '@ugc/test-utils';

import { RawContentSchema } from '../contracts/raw-content';
import {
  HTML_JSONLD_AND_OG,
  HTML_JSONLD_SIMPLE,
  HTML_NO_SIGNAL,
  HTML_OG_WITH_PRICE,
} from './fixtures/html';
import { SHOPIFY_PRODUCT_JSON } from './fixtures/shopify';
import { makeFastPathIngester } from './fast-path';

// Hooks de msw manejados a mano (los handlers cambian por test con server.use()).
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const ingester = makeFastPathIngester();

const SHOPIFY_URL = 'https://tienda.example/products/wool-runner';
const SHOPIFY_JSON_URL = 'https://tienda.example/products/wool-runner.json';
const CUSTOM_URL = 'https://brand.example/shop/mug';

describe('fast path — camino feliz Shopify .json', () => {
  it('con .json 200 usa la fuente Shopify (no depende del HTML)', async () => {
    server.use(
      http.get(SHOPIFY_JSON_URL, () => HttpResponse.json(SHOPIFY_PRODUCT_JSON)),
      http.get(SHOPIFY_URL, () => HttpResponse.text(HTML_NO_SIGNAL)),
    );
    const res = await ingester.ingest(SHOPIFY_URL);
    expect(res.platform).toBe('shopify');
    expect(res.raw.product?.title).toBe('Wool Runner - Natural Black');
    expect(res.raw.product?.price).toBe('110.00');
    expect(res.raw.images.length).toBe(2);
    expect(res.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.urlNormalized).toBe(SHOPIFY_URL);
    expect(res.warnings).toEqual([]);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });
});

describe('fast path — FALLBACK TRANSPARENTE del .json (el discriminador)', () => {
  it('.json 404 → degrada SILENCIOSAMENTE al JSON-LD del HTML, sin error ni warning', async () => {
    server.use(
      http.get(SHOPIFY_JSON_URL, () => new HttpResponse(null, { status: 404 })),
      http.get(SHOPIFY_URL, () => HttpResponse.text(HTML_JSONLD_SIMPLE)),
    );
    const res = await ingester.ingest(SHOPIFY_URL);
    expect(res.raw.product?.title).toBe('Handmade Ceramic Mug'); // vino del JSON-LD
    expect(res.raw.product?.price).toBe('28');
    expect(res.warnings).toEqual([]); // un .json ausente NO es un warning
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });

  it('.json 401 → degrada al JSON-LD, transparente', async () => {
    server.use(
      http.get(SHOPIFY_JSON_URL, () => new HttpResponse(null, { status: 401 })),
      http.get(SHOPIFY_URL, () => HttpResponse.text(HTML_JSONLD_SIMPLE)),
    );
    const res = await ingester.ingest(SHOPIFY_URL);
    expect(res.raw.product?.title).toBe('Handmade Ceramic Mug');
    expect(res.warnings).toEqual([]);
  });

  it('.json 404 y SIN JSON-LD → cae a OpenGraph, transparente', async () => {
    server.use(
      http.get(SHOPIFY_JSON_URL, () => new HttpResponse(null, { status: 404 })),
      http.get(SHOPIFY_URL, () => HttpResponse.text(HTML_OG_WITH_PRICE)),
    );
    const res = await ingester.ingest(SHOPIFY_URL);
    expect(res.raw.product?.title).toBe('Linen Shirt & Co.'); // desde OG
    expect(res.raw.product?.price).toBe('49.90');
    expect(res.warnings).toEqual([]);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });

  it('.json devuelve HTML de error (no JSON) → degrada sin lanzar', async () => {
    server.use(
      http.get(SHOPIFY_JSON_URL, () =>
        HttpResponse.text('<html>404 not found</html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
      http.get(SHOPIFY_URL, () => HttpResponse.text(HTML_JSONLD_SIMPLE)),
    );
    const res = await ingester.ingest(SHOPIFY_URL);
    expect(res.raw.product?.title).toBe('Handmade Ceramic Mug');
    expect(res.warnings).toEqual([]);
  });
});

describe('fast path — content_hash estable ante variantes de la misma URL', () => {
  it('mismo contenido en dos variantes de URL (barra final) → mismo content_hash', async () => {
    server.use(
      http.get('https://brand.example/shop/mug', () => HttpResponse.text(HTML_JSONLD_SIMPLE)),
      http.get('https://brand.example/shop/mug/', () => HttpResponse.text(HTML_JSONLD_SIMPLE)),
    );
    const a = await ingester.ingest('https://brand.example/shop/mug');
    const b = await ingester.ingest('https://brand.example/shop/mug/');
    // La URL cruda difiere (barra final) pero el CONTENIDO es idéntico ⇒ el hash
    // debe colisionar (el url_normalized aparte los reconcilia en el cache key).
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.urlNormalized).toBe(b.urlNormalized);
  });
});

describe('fast path — precedencia end-to-end a través de parsers+merge', () => {
  it('página con JSON-LD y OG: gana el JSON-LD (title/price), a través del chain real', async () => {
    server.use(http.get(CUSTOM_URL, () => HttpResponse.text(HTML_JSONLD_AND_OG)));
    const res = await ingester.ingest(CUSTOM_URL);
    expect(res.raw.product?.title).toBe('JSON-LD Title (should win)');
    expect(res.raw.product?.price).toBe('12.00'); // no el 99.00 de OG
    expect(res.raw.images).toEqual([{ url: 'https://img.example/jsonld.jpg', alt: null }]);
  });
});

describe('fast path — URL no-Shopify (no se prueba el .json)', () => {
  it('custom con JSON-LD: no toca ningún .json, parsea el HTML', async () => {
    server.use(http.get(CUSTOM_URL, () => HttpResponse.text(HTML_JSONLD_SIMPLE)));
    const res = await ingester.ingest(CUSTOM_URL);
    expect(res.platform).toBe('custom');
    expect(res.raw.product?.title).toBe('Handmade Ceramic Mug');
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
  });
});

describe('fast path — nunca fila rota (HEADLINE 1)', () => {
  it('página SIN ninguna señal → RawContent válido y escaso, sin lanzar', async () => {
    server.use(http.get(CUSTOM_URL, () => HttpResponse.text(HTML_NO_SIGNAL)));
    const res = await ingester.ingest(CUSTOM_URL);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
    expect(res.raw.markdown).toBe('');
    expect(res.raw.images).toEqual([]);
    expect(res.raw.product).toBeNull();
    expect(res.warnings).toEqual([]);
  });

  it('fallo REAL de infra al traer el HTML (5xx) → warning, no crash, RawContent válido', async () => {
    server.use(http.get(CUSTOM_URL, () => new HttpResponse(null, { status: 500 })));
    const res = await ingester.ingest(CUSTOM_URL);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
    expect(res.warnings).toContain('html_fetch_status_500');
  });

  it('error de red al traer el HTML → warning, no propaga la excepción', async () => {
    server.use(http.get(CUSTOM_URL, () => HttpResponse.error()));
    const res = await ingester.ingest(CUSTOM_URL);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
    expect(res.warnings.some((w) => w.startsWith('html_fetch_failed'))).toBe(true);
  });

  it('shopify: .json 404 Y HTML 500 → sigue produciendo RawContent válido escaso', async () => {
    server.use(
      http.get(SHOPIFY_JSON_URL, () => new HttpResponse(null, { status: 404 })),
      http.get(SHOPIFY_URL, () => new HttpResponse(null, { status: 500 })),
    );
    const res = await ingester.ingest(SHOPIFY_URL);
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
    expect(res.raw.platform).toBe('shopify');
    expect(res.warnings).toContain('html_fetch_status_500');
  });
});

describe('fast path — FIX 1: timeout no cuelga ingest()', () => {
  // `fetch` inyectado que NUNCA resuelve por sí solo pero HONRA el AbortSignal
  // (rechaza con AbortError cuando el signal se dispara), como el fetch real. Un
  // `timeoutMs` pequeño hace la prueba rápida y determinista, sin red ni fake timers.
  const hangingFetch: typeof globalThis.fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        });
      }
    });

  it('un servidor que cuelga se aborta por timeout → RawContent válido, no bloqueo eterno', async () => {
    const ingesterWithTimeout = makeFastPathIngester({ fetch: hangingFetch, timeoutMs: 20 });
    // Sin timeout, esta promesa NUNCA resolvería (el fetch cuelga). Con timeout, el
    // AbortSignal.timeout(20) la resuelve como fuente ausente / warning de infra.
    const res = await ingesterWithTimeout.ingest('https://slow.example/product/x');
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
    // El HTML colgado se registra como fallo de infra (timeout), no cuelga.
    expect(res.warnings.some((w) => w.startsWith('html_fetch_failed'))).toBe(true);
    expect(res.warnings.some((w) => w.includes('timeout'))).toBe(true);
  });

  it('shopify: .json que cuelga se aborta y degrada silenciosamente al HTML', async () => {
    // El `.json` cuelga (abort→null, sin warning); el HTML cuelga también (abort→
    // warning). El resultado sigue siendo un RawContent válido, sin bloqueo.
    const ingesterWithTimeout = makeFastPathIngester({ fetch: hangingFetch, timeoutMs: 20 });
    const res = await ingesterWithTimeout.ingest('https://tienda.example/products/slow');
    expect(RawContentSchema.safeParse(res.raw).success).toBe(true);
    expect(res.raw.platform).toBe('shopify');
  });
});
