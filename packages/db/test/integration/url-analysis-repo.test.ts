// Roundtrip real del repo `url_analysis` (T1.3) contra el clon de Testcontainers
// (db-integration.md §6). La Entrega dice "el RawContent PERSISTIDO": este test fija
// que el `RawContent` del fast path va y vuelve intacto por la columna `raw_content`
// jsonb, con `platform`/`url_normalized`/`content_hash`/`status` correctos y una FILA
// VÁLIDA (nunca "rota") — la cláusula observable de la Verificación, codificada como
// test permanente (regla de trabajo 8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, makeProject, type TestDatabase } from '@ugc/test-utils';

import { createProject } from '../../src/repos/project.repo';
import { createUrlAnalysis, getUrlAnalysis } from '../../src/repos/url-analysis.repo';

let tdb: TestDatabase;
let projectId: string;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'url-analysis-repo' });
  const project = await createProject(tdb.db, makeProject({ name: 'Ingesta T1.3' }));
  projectId = project.id;
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

// RawContent tal como lo emite el fast path (modo url): título/precio/imágenes del
// merge, markdown base y product estructurado.
const rawContent = {
  source: 'url' as const,
  url: 'https://tienda.example/products/wool-runner',
  platform: 'shopify' as const,
  markdown: 'Our lightest everyday shoe.',
  images: [
    { url: 'https://cdn.example/wool-1.jpg', alt: 'Side' },
    { url: 'https://cdn.example/wool-2.jpg', alt: null },
  ],
  branding: null,
  product: {
    title: 'Wool Runner',
    price: '110.00',
    currency: 'USD',
    availability: null,
    variants: ['US 8', 'US 9'],
  },
  screenshotRef: null,
};

describe('url_analysis repo (T1.3)', () => {
  it('persiste el RawContent completo en raw_content jsonb y lo devuelve intacto', async () => {
    const created = await createUrlAnalysis(tdb.db, {
      projectId,
      platform: 'shopify',
      urlNormalized: 'https://tienda.example/products/wool-runner',
      contentHash: 'a'.repeat(64),
      rawContent,
    });

    expect(created.id).toHaveLength(26); // PK ULID
    expect(created.source).toBe('url');
    expect(created.platform).toBe('shopify');
    expect(created.urlNormalized).toBe('https://tienda.example/products/wool-runner');
    expect(created.contentHash).toBe('a'.repeat(64));
    expect(created.status).toBe('done'); // default del fast path completado
    expect(created.warnings).toEqual([]); // default []
    // El RawContent va y vuelve por jsonb sin pérdida (título/precio/imágenes: la
    // sustancia que verifica el verifier a mano contra la página).
    expect(created.rawContent).toEqual(rawContent);

    const fetched = await getUrlAnalysis(tdb.db, created.id);
    expect(fetched).toEqual(created); // SELECT == RETURNING
  });

  it('persiste una fila ESCASA válida (fast path sin señal): RawContent mínimo, sin fila rota', async () => {
    const scarce = {
      source: 'url' as const,
      url: 'https://brand.example/page',
      platform: 'custom' as const,
      markdown: '',
      images: [],
      branding: null,
      product: null,
      screenshotRef: null,
    };
    const created = await createUrlAnalysis(tdb.db, {
      projectId,
      platform: 'custom',
      urlNormalized: 'https://brand.example/page',
      contentHash: 'b'.repeat(64),
      rawContent: scarce,
    });
    expect(created.rawContent).toEqual(scarce);
    expect(created.status).toBe('done');
    // La fila existe y es recuperable: "sin fila rota" a nivel de persistencia.
    const fetched = await getUrlAnalysis(tdb.db, created.id);
    expect(fetched?.id).toBe(created.id);
  });

  it('acepta warnings de infra degradada y los persiste como jsonb', async () => {
    const created = await createUrlAnalysis(tdb.db, {
      projectId,
      platform: 'custom',
      urlNormalized: 'https://brand.example/degraded',
      contentHash: 'c'.repeat(64),
      rawContent: { ...rawContent, platform: 'custom' },
      warnings: ['html_fetch_status_500'],
    });
    expect(created.warnings).toEqual(['html_fetch_status_500']);
  });

  it('getUrlAnalysis devuelve undefined para un id inexistente', async () => {
    const missing = await getUrlAnalysis(tdb.db, '00000000000000000000000000');
    expect(missing).toBeUndefined();
  });
});
