// Cadena COMPLETA de la Verificación de T1.3 (regla de trabajo 8): el fast path
// ingiere (HTTP mockeado con msw) → se mapea a la fila → se PERSISTE en url_analysis
// → se relee, y el RawContent persistido conserva título/precio/imágenes. Es la
// codificación determinista de la cláusula observable "el RawContent PERSISTIDO
// contiene título/precio/imágenes correctos" — cierra el seam ingester→persistencia
// que los tests de core (paran en FastPathResult) y del repo (parten de un const a
// mano) no cubren juntos.
//
// msw intercepta el `fetch` global (sin red real, skill testing); Testcontainers da
// la BD real. `@ugc/core/ingest` es importable desde db (core es dep de db).
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeFastPathIngester } from '@ugc/core/ingest';
import { createTestDatabase, makeProject, server, type TestDatabase } from '@ugc/test-utils';

import { createProject } from '../../src/repos/project.repo';
import { createUrlAnalysis, getUrlAnalysis } from '../../src/repos/url-analysis.repo';

let tdb: TestDatabase;
let projectId: string;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'ingest-persist' });
  const project = await createProject(tdb.db, makeProject({ name: 'Chain T1.3' }));
  projectId = project.id;
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

const ingester = makeFastPathIngester();

// Página con JSON-LD Product (title, offers.price, image) — el caso "1 con JSON-LD"
// de la Verificación, servido offline por msw.
const HTML_JSONLD = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Persisted Mug",
 "description":"A mug that survives the jsonb round trip.",
 "offers":{"@type":"Offer","price":"19.95","priceCurrency":"EUR"},
 "image":["https://img.example/persisted-1.jpg","https://img.example/persisted-2.jpg"]}
</script></head><body></body></html>`;

describe('cadena fast path → persistencia (Verificación T1.3)', () => {
  it('ingiere una página JSON-LD, la persiste y el RawContent persistido conserva título/precio/imágenes', async () => {
    const url = 'https://brand.example/product/persisted-mug';
    server.use(http.get(url, () => HttpResponse.text(HTML_JSONLD)));

    // 1) Fast path (HTTP vía msw).
    const result = await ingester.ingest(url);
    expect(result.platform).toBe('woocommerce'); // /product/ singular

    // 2) Mapea FastPathResult → fila y PERSISTE (el seam real).
    const created = await createUrlAnalysis(tdb.db, {
      projectId,
      platform: result.platform,
      urlNormalized: result.urlNormalized,
      contentHash: result.contentHash,
      rawContent: result.raw,
      warnings: result.warnings,
    });

    // 3) Relee de la BD y comprueba la sustancia de la Verificación.
    const fetched = await getUrlAnalysis(tdb.db, created.id);
    expect(fetched).toBeDefined();
    const raw = fetched?.rawContent as typeof result.raw;
    expect(raw.product?.title).toBe('Persisted Mug');
    expect(raw.product?.price).toBe('19.95');
    expect(raw.product?.currency).toBe('EUR');
    expect(raw.images).toEqual([
      { url: 'https://img.example/persisted-1.jpg', alt: null },
      { url: 'https://img.example/persisted-2.jpg', alt: null },
    ]);
    // Metadatos derivados persistidos.
    expect(fetched?.platform).toBe('woocommerce');
    expect(fetched?.urlNormalized).toBe('https://brand.example/product/persisted-mug');
    expect(fetched?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fetched?.status).toBe('done');
  });

  it('fallback transparente: .json 404 → persiste una fila VÁLIDA con lo del HTML (sin fila rota)', async () => {
    // URL Shopify (dispara el probe del `.json`) que devuelve 404 en el `.json`
    // pero JSON-LD en el HTML: la fila persistida debe ser válida y recuperable.
    const url = 'https://tienda.example/products/capped-store';
    server.use(
      http.get(`${url}.json`, () => new HttpResponse(null, { status: 404 })),
      http.get(url, () => HttpResponse.text(HTML_JSONLD)),
    );

    const result = await ingester.ingest(url);
    const created = await createUrlAnalysis(tdb.db, {
      projectId,
      platform: result.platform,
      urlNormalized: result.urlNormalized,
      contentHash: result.contentHash,
      rawContent: result.raw,
      warnings: result.warnings,
    });

    const fetched = await getUrlAnalysis(tdb.db, created.id);
    expect(fetched?.id).toBe(created.id); // fila existe y es recuperable
    const raw = fetched?.rawContent as typeof result.raw;
    expect(raw.product?.title).toBe('Persisted Mug'); // vino del JSON-LD, transparente
    expect(fetched?.platform).toBe('shopify');
    expect(fetched?.warnings).toEqual([]); // el .json ausente NO es warning
  });
});
