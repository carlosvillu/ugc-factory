// Roundtrip real del repo `url_analysis` (T1.3) contra el clon de Testcontainers
// (db-integration.md §6). La Entrega dice "el RawContent PERSISTIDO": este test fija
// que el `RawContent` del fast path va y vuelve intacto por la columna `raw_content`
// jsonb, con `platform`/`url_normalized`/`content_hash`/`status` correctos y una FILA
// VÁLIDA (nunca "rota") — la cláusula observable de la Verificación, codificada como
// test permanente (regla de trabajo 8).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, makeProject, type TestDatabase } from '@ugc/test-utils';

import { createProject } from '../../src/repos/project.repo';
import {
  createUrlAnalysis,
  findManualUrlAnalysisByHash,
  getUrlAnalysis,
  insertManualUrlAnalysisIfAbsent,
} from '../../src/repos/url-analysis.repo';

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

// ── Modo MANUAL (T1.6, §7.4): caché lookup-then-insert ───────────────────────
describe('url_analysis repo — modo manual (T1.6)', () => {
  const manualRaw = {
    source: 'manual' as const,
    url: null,
    platform: 'manual' as const,
    markdown: 'Un sérum hidratante con ácido hialurónico para piel sensible.',
    images: [{ url: '/api/assets/a/download', alt: 'packshot' }],
  };

  it('insertManualUrlAnalysisIfAbsent persiste source=manual, url_normalized=null, status=done', async () => {
    const created = await insertManualUrlAnalysisIfAbsent(tdb.db, {
      projectId,
      contentHash: 'd'.repeat(64),
      rawContent: manualRaw,
    });
    expect(created).toBeDefined();
    expect(created!.source).toBe('manual');
    expect(created!.platform).toBe('manual');
    expect(created!.urlNormalized).toBeNull();
    expect(created!.status).toBe('done');
    expect(created!.contentHash).toBe('d'.repeat(64));
    expect(created!.rawContent).toEqual(manualRaw);
  });

  it('findManualUrlAnalysisByHash encuentra un análisis manual previo del mismo proyecto', async () => {
    const hash = 'e'.repeat(64);
    const created = await insertManualUrlAnalysisIfAbsent(tdb.db, {
      projectId,
      contentHash: hash,
      rawContent: manualRaw,
    });
    const found = await findManualUrlAnalysisByHash(tdb.db, projectId, hash);
    expect(found?.id).toBe(created!.id);
  });

  it('insertManualUrlAnalysisIfAbsent es idempotente: el 2.º insert del mismo (project,hash) devuelve undefined y NO crea fila', async () => {
    const hash = '3'.repeat(64);
    const first = await insertManualUrlAnalysisIfAbsent(tdb.db, {
      projectId,
      contentHash: hash,
      rawContent: manualRaw,
    });
    expect(first).toBeDefined();
    // ON CONFLICT DO NOTHING: la segunda no devuelve fila (la UNIQUE parcial la bloquea).
    const second = await insertManualUrlAnalysisIfAbsent(tdb.db, {
      projectId,
      contentHash: hash,
      rawContent: manualRaw,
    });
    expect(second).toBeUndefined();
    // Solo UNA fila con ese (project, hash).
    const { rows } = await tdb.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM url_analysis WHERE project_id = $1 AND content_hash = $2 AND source = 'manual'`,
      [projectId, hash],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('CARRERA: dos inserts CONCURRENTES del mismo (project,hash) crean EXACTAMENTE una fila', async () => {
    // El guard estructural de la carrera lookup-then-insert (la Verificación SECUENCIAL
    // no lo caza): dos transacciones simultáneas — solo una gana; la otra choca el UNIQUE
    // parcial (ON CONFLICT DO NOTHING) → undefined. Análogo al test de lock-ordering de T0.8.
    const hash = '4'.repeat(64);
    const [a, b] = await Promise.all([
      insertManualUrlAnalysisIfAbsent(tdb.db, {
        projectId,
        contentHash: hash,
        rawContent: manualRaw,
      }),
      insertManualUrlAnalysisIfAbsent(tdb.db, {
        projectId,
        contentHash: hash,
        rawContent: manualRaw,
      }),
    ]);

    // Exactamente uno insertó (fila) y el otro perdió (undefined).
    const created = [a, b].filter((r) => r !== undefined);
    expect(created).toHaveLength(1);

    // Y en la BD hay UNA sola fila.
    const { rows } = await tdb.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM url_analysis WHERE project_id = $1 AND content_hash = $2 AND source = 'manual'`,
      [projectId, hash],
    );
    expect(rows[0]!.n).toBe(1);

    // El re-lookup (lo que hace el perdedor de la carrera) encuentra la fila del ganador.
    const found = await findManualUrlAnalysisByHash(tdb.db, projectId, hash);
    expect(found?.id).toBe(created[0]!.id);
  });

  it('el lookup está gateado por source=manual: un análisis de URL con el mismo hash NO colisiona', async () => {
    const hash = 'f'.repeat(64);
    // Un análisis de URL con el MISMO content_hash (source='url').
    await createUrlAnalysis(tdb.db, {
      projectId,
      platform: 'shopify',
      urlNormalized: 'https://tienda.example/products/x',
      contentHash: hash,
      rawContent,
    });
    // El lookup manual no lo encuentra (source distinto).
    expect(await findManualUrlAnalysisByHash(tdb.db, projectId, hash)).toBeUndefined();
  });

  it('el lookup está gateado por project_id: el mismo hash en otro proyecto no colisiona', async () => {
    const other = await createProject(tdb.db, makeProject({ name: 'Otro proyecto' }));
    const hash = '1'.repeat(64);
    await insertManualUrlAnalysisIfAbsent(tdb.db, {
      projectId,
      contentHash: hash,
      rawContent: manualRaw,
    });
    expect(await findManualUrlAnalysisByHash(tdb.db, other.id, hash)).toBeUndefined();
  });

  it('findManualUrlAnalysisByHash devuelve undefined si no hay caché', async () => {
    expect(await findManualUrlAnalysisByHash(tdb.db, projectId, '2'.repeat(64))).toBeUndefined();
  });
});
