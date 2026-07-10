// Integración handler-level de `POST /api/analyses` (T1.6) contra Postgres real
// (api.md §2, nivel 1): el intake MANUAL (texto libre). Fija como regresión permanente
// del gate las cláusulas DETERMINISTAS de la Verificación:
//  - crear un análisis solo con texto (y refs de imágenes) → `url_analysis` en `done`,
//    `source='manual'`, SIN ninguna llamada de scraping (el short-circuit no toca el
//    fast-path ingester: no hay red que interceptar aquí — la ausencia de scraping se
//    afirma por el estado `done` inmediato y por la forma del RawContent sintético).
//  - repetir el MISMO texto reutiliza la caché: MISMO id, SIN fila nueva (lookup-then-
//    insert por (project_id, content_hash, source='manual')).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { contentHash } from '@ugc/core/ingest';
import { createTestDatabase, makeProject, type TestDatabase } from '@ugc/test-utils';
import { setDbForTests } from '@/server/db';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { POST } from '@/app/api/analyses/route';

const TEST_MASTER_KEY = 'test-master-key-for-analyses-suite';
function sessionCookieHeader(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

const LONG_TEXT =
  'Un sérum hidratante con ácido hialurónico para piel sensible que hidrata 24 horas.';

let tdb: TestDatabase;

function callPost(body: unknown, opts: { authed?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.authed !== false) headers.cookie = sessionCookieHeader();
  return POST(
    new Request('http://test.local/api/analyses', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

async function seedProject(): Promise<string> {
  const p = makeProject();
  const { rows } = await tdb.pool.query<{ id: string }>(
    `INSERT INTO project (id, name) VALUES ($1, $2) RETURNING id`,
    [newUlid(), p.name],
  );
  return rows[0]!.id;
}

async function analysesOf(projectId: string): Promise<
  {
    id: string;
    status: string;
    source: string;
    url_normalized: string | null;
    content_hash: string | null;
    raw_content: unknown;
  }[]
> {
  const { rows } = await tdb.pool.query(
    `SELECT id, status, source, url_normalized, content_hash, raw_content FROM url_analysis WHERE project_id = $1`,
    [projectId],
  );
  return rows as never;
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:analyses' });
  setDbForTests(tdb.db);
});

afterAll(async () => {
  setDbForTests(undefined);
  setMasterKeyForTests(undefined);
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE url_analysis, project CASCADE');
});
afterEach(async () => {
  await tdb.pool.query('TRUNCATE url_analysis, project CASCADE');
});

describe('POST /api/analyses (intake manual, T1.6)', () => {
  it('sin sesión ⇒ 401 antes de tocar la BD', async () => {
    const res = await callPost(
      { source: 'manual', projectId: 'p', freeText: LONG_TEXT },
      { authed: false },
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });

  it('texto + imágenes ⇒ 201, url_analysis en `done`, source=manual, SIN scraping', async () => {
    const projectId = await seedProject();
    const res = await callPost({
      source: 'manual',
      projectId,
      freeText: LONG_TEXT,
      imageRefs: [
        { url: '/api/assets/a/download', alt: 'packshot' },
        { url: '/api/assets/b/download' },
      ],
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      status: string;
      source: string;
      reused: boolean;
    };
    expect(body.status).toBe('done'); // short-circuit: nace `done`, sin pending→scraping
    expect(body.source).toBe('manual');
    expect(body.reused).toBe(false);

    const rows = await analysesOf(projectId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe('done');
    expect(row.source).toBe('manual');
    // Modo manual: sin URL normalizada (no hubo scraping de ningún dominio).
    expect(row.url_normalized).toBeNull();
    // El hash cubre SOLO el texto (§7.4): coincide con contentHash(freeText).
    expect(row.content_hash).toBe(contentHash(LONG_TEXT));

    // El RawContent sintético: source manual, url null, platform manual, markdown = el
    // texto, images = refs subidas. NINGÚN campo de fast-path (branding/product).
    const raw = row.raw_content as {
      source: string;
      url: string | null;
      platform: string;
      markdown: string;
      images: { url: string; alt: string | null }[];
      branding?: unknown;
      product?: unknown;
    };
    expect(raw.source).toBe('manual');
    expect(raw.url).toBeNull();
    expect(raw.platform).toBe('manual');
    expect(raw.markdown).toBe(LONG_TEXT);
    expect(raw.images).toEqual([
      { url: '/api/assets/a/download', alt: 'packshot' },
      { url: '/api/assets/b/download', alt: null },
    ]);
    expect(raw.branding).toBeUndefined();
    expect(raw.product).toBeUndefined();
  });

  it('sin imágenes ⇒ 201 con RawContent de images vacío', async () => {
    const projectId = await seedProject();
    const res = await callPost({ source: 'manual', projectId, freeText: LONG_TEXT });
    expect(res.status).toBe(201);
    const rows = await analysesOf(projectId);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.raw_content as { images: unknown[] }).images).toEqual([]);
  });

  it('repetir el MISMO texto reutiliza la caché: mismo id, SIN fila nueva', async () => {
    const projectId = await seedProject();
    const first = await callPost({ source: 'manual', projectId, freeText: LONG_TEXT });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };

    const second = await callPost({ source: 'manual', projectId, freeText: LONG_TEXT });
    // 200 (nada nuevo), reused=true, MISMO id (la señal de reutilización).
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string; reused: boolean };
    expect(secondBody.reused).toBe(true);
    expect(secondBody.id).toBe(firstBody.id);

    // Y lo decisivo: NO hay fila nueva.
    expect(await analysesOf(projectId)).toHaveLength(1);
  });

  it('mismo texto + imágenes DISTINTAS: SIGUE reutilizando (el hash cubre solo el texto)', async () => {
    const projectId = await seedProject();
    const first = await callPost({
      source: 'manual',
      projectId,
      freeText: LONG_TEXT,
      imageRefs: [{ url: '/api/assets/a/download' }],
    });
    const firstBody = (await first.json()) as { id: string };

    const second = await callPost({
      source: 'manual',
      projectId,
      freeText: LONG_TEXT,
      imageRefs: [{ url: '/api/assets/z/download' }],
    });
    const secondBody = (await second.json()) as { id: string; reused: boolean };
    expect(secondBody.reused).toBe(true);
    expect(secondBody.id).toBe(firstBody.id);
    expect(await analysesOf(projectId)).toHaveLength(1);
  });

  it('el MISMO texto en OTRO proyecto NO reutiliza (caché gateada por project_id)', async () => {
    const projectA = await seedProject();
    const projectB = await seedProject();
    const a = await callPost({ source: 'manual', projectId: projectA, freeText: LONG_TEXT });
    const b = await callPost({ source: 'manual', projectId: projectB, freeText: LONG_TEXT });
    expect(b.status).toBe(201);
    expect(((await b.json()) as { reused: boolean }).reused).toBe(false);
    // projectA también CREÓ su propia fila (no reutilizó nada de projectB).
    expect(a.status).toBe(201);
    expect(((await a.json()) as { reused: boolean }).reused).toBe(false);
    expect(await analysesOf(projectA)).toHaveLength(1);
    expect(await analysesOf(projectB)).toHaveLength(1);
  });

  it('texto por debajo del mínimo ⇒ 400 validation_error, cero filas', async () => {
    const projectId = await seedProject();
    const res = await callPost({ source: 'manual', projectId, freeText: 'corto' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
    expect(await analysesOf(projectId)).toHaveLength(0);
  });
});
