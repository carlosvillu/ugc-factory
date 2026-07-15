// Integración handler-level de la API de la GALERÍA (T3.8) contra Postgres real (api.md §2, nivel
// 1). NADA de mocks: la búsqueda facetada depende de los GIN de T3.1 y el versionado del UNIQUE
// (template, version) — un doble ocultaría justo lo que la Verificación exige.
//
// Fija como regresión permanente las cláusulas DETERMINISTAS y gratuitas de la Verificación de
// T3.8 (regla de trabajo 8, dentro de `pnpm gate`):
//   1. FILTRAR por 2 facetas → `GET /api/templates?formats=...&verticals=...` devuelve solo las
//      que contienen AMBAS.
//   2. SLOT INVÁLIDO → `PATCH /api/templates/:id` con un `{slot}` no §10.4 es un `validation_error`
//      (la MISMA regla que el editor aplica en vivo, ahora en la frontera del servidor).
//   3. GUARDAR crea v2 con el par v1↔v2 para el diff → el PATCH devuelve `previous`(v1)+`created`(v2)
//      y la ficha lista ambas versiones.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { createTemplate } from '@ugc/db';
import { promptTemplate, promptVersion, type NewPromptTemplate } from '@ugc/db/schema';
import { setDbForTests } from '@/server/db';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { GET as listRoute, POST as createRoute } from '@/app/api/templates/route';
import { GET as fichaRoute, PATCH as editRoute } from '@/app/api/templates/[id]/route';
import { PATCH as statusRoute } from '@/app/api/templates/[id]/status/route';

const TEST_MASTER_KEY = 'test-master-key-for-templates';
function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

let tdb: TestDatabase;

/** El body de creación de un template (§10.1). Slug único por test para no chocar con el UNIQUE. */
function templateBody(over: Partial<NewPromptTemplate> = {}): NewPromptTemplate {
  return {
    slug: `t-${String(Date.now())}-${String(Math.random()).slice(2, 7)}`,
    title: 'Template de prueba',
    kind: 'video',
    body: 'Cuerpo con {product.name} y {benefit.primary}.',
    language: 'es',
    formats: ['grwm'],
    hookAngles: ['pain-point'],
    verticals: ['beauty'],
    platforms: ['tiktok'],
    aesthetics: ['clean'],
    ...over,
  };
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'api-templates' });
  setDbForTests(tdb.db);
  setMasterKeyForTests(TEST_MASTER_KEY);
});

afterAll(async () => {
  setDbForTests(undefined);
  setMasterKeyForTests(undefined);
  await tdb.close();
});

beforeEach(async () => {
  // Cada test parte de una galería limpia (los conteos y filtros se asertan con conteos exactos).
  await tdb.db.delete(promptVersion);
  await tdb.db.delete(promptTemplate);
});

describe('GET /api/templates — lista facetada', () => {
  it('sin sesión responde 401', async () => {
    const res = await listRoute(new Request('http://test.local/api/templates'), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });

  it('filtrar por 2 facetas devuelve EXACTAMENTE las que contienen ambas', async () => {
    await createTemplate(
      tdb.db,
      templateBody({ slug: 'ba-beauty', formats: ['before-after'], verticals: ['beauty'] }),
    );
    await createTemplate(
      tdb.db,
      templateBody({ slug: 'grwm-beauty', formats: ['grwm'], verticals: ['beauty'] }),
    );
    await createTemplate(
      tdb.db,
      templateBody({ slug: 'ba-food', formats: ['before-after'], verticals: ['food'] }),
    );

    const res = await listRoute(
      new Request('http://test.local/api/templates?formats=before-after&verticals=beauty', {
        headers: { cookie: cookie() },
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: { slug: string }[]; total: number };
    expect(body.templates.map((t) => t.slug)).toEqual(['ba-beauty']);
    expect(body.total).toBe(1);
  });

  it('devuelve conteos por faceta y por estado para el rail', async () => {
    await createTemplate(
      tdb.db,
      templateBody({ slug: 'a', verticals: ['beauty'], status: 'published' }),
    );
    await createTemplate(
      tdb.db,
      templateBody({ slug: 'b', verticals: ['beauty'], status: 'draft' }),
    );

    const res = await listRoute(
      new Request('http://test.local/api/templates', { headers: { cookie: cookie() } }),
      { params: Promise.resolve({}) },
    );
    const body = (await res.json()) as {
      facets: { verticals: { value: string; count: number }[] };
      statusCounts: { value: string; count: number }[];
    };
    expect(body.facets.verticals.find((f) => f.value === 'beauty')?.count).toBe(2);
    const statusMap = Object.fromEntries(body.statusCounts.map((s) => [s.value, s.count]));
    expect(statusMap.published).toBe(1);
    expect(statusMap.draft).toBe(1);
  });
});

describe('POST /api/templates — crear', () => {
  it('crea un template en draft y devuelve 201', async () => {
    const res = await createRoute(
      new Request('http://test.local/api/templates', {
        method: 'POST',
        headers: { cookie: cookie(), 'content-type': 'application/json' },
        body: JSON.stringify(templateBody({ slug: 'nuevo-tpl' })),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string; status: string };
    expect(body.slug).toBe('nuevo-tpl');
    expect(body.status).toBe('draft');
  });

  it('un slug duplicado es un validation_error anclado al campo slug', async () => {
    await createTemplate(tdb.db, templateBody({ slug: 'dup' }));
    const res = await createRoute(
      new Request('http://test.local/api/templates', {
        method: 'POST',
        headers: { cookie: cookie(), 'content-type': 'application/json' },
        body: JSON.stringify(templateBody({ slug: 'dup' })),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      details: { fieldErrors: { slug?: string[] } };
    };
    expect(body.code).toBe('validation_error');
    expect(body.details.fieldErrors.slug).toBeDefined();
  });
});

describe('GET /api/templates/:id — ficha', () => {
  it('devuelve el template, sus versiones y los guards que aplican (§9.5)', async () => {
    const created = await createTemplate(
      tdb.db,
      templateBody({ slug: 'ficha', verticals: ['beauty'], platforms: ['tiktok'] }),
    );
    const res = await fichaRoute(
      new Request(`http://test.local/api/templates/${created.id}`, {
        headers: { cookie: cookie() },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      template: { slug: string; body: string };
      versions: unknown[];
      appliedGuards: unknown[];
    };
    expect(body.template.slug).toBe('ficha');
    expect(body.template.body).toContain('{product.name}');
    // Sin guard packs sembrados, appliedGuards es []; la clave existe y es array.
    expect(Array.isArray(body.appliedGuards)).toBe(true);
    // Un template recién creado no tiene versiones materializadas aún.
    expect(body.versions).toHaveLength(0);
  });

  it('un id inexistente responde 404', async () => {
    const res = await fichaRoute(
      new Request('http://test.local/api/templates/nope', { headers: { cookie: cookie() } }),
      { params: Promise.resolve({ id: 'nope' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/templates/:id — guardar edición (crea v2)', () => {
  it('un slot inválido §10.4 es un validation_error EN LA FRONTERA del servidor', async () => {
    const created = await createTemplate(tdb.db, templateBody({ slug: 'edit-invalid' }));
    const res = await editRoute(
      new Request(`http://test.local/api/templates/${created.id}`, {
        method: 'PATCH',
        headers: { cookie: cookie(), 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'cuerpo con {producto.nombre} inválido' }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      details: { fieldErrors: { body?: string[] } };
    };
    expect(body.code).toBe('validation_error');
    expect(body.details.fieldErrors.body?.[0]).toContain('producto.nombre');
  });

  it('guardar una edición válida crea v2 con el par v1↔v2 para el diff', async () => {
    const created = await createTemplate(
      tdb.db,
      templateBody({ slug: 'edit-ok', body: 'cuerpo original v1 con {product.name}' }),
    );
    const res = await editRoute(
      new Request(`http://test.local/api/templates/${created.id}`, {
        method: 'PATCH',
        headers: { cookie: cookie(), 'content-type': 'application/json' },
        body: JSON.stringify({
          body: 'cuerpo EDITADO v2 con {product.name} y {benefit.primary}',
          changelog: 'add',
        }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      previous: { version: number; body: string };
      created: { version: number; body: string };
      template: { headVersion: number };
    };
    // v1 = original materializada; v2 = editada. El diff se renderiza sobre este par.
    expect(body.previous.version).toBe(1);
    expect(body.previous.body).toBe('cuerpo original v1 con {product.name}');
    expect(body.created.version).toBe(2);
    expect(body.created.body).toContain('EDITADO v2');
    expect(body.template.headVersion).toBe(2);

    // La ficha ahora lista las 2 versiones (más nueva primero).
    const ficha = await fichaRoute(
      new Request(`http://test.local/api/templates/${created.id}`, {
        headers: { cookie: cookie() },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    const fichaBody = (await ficha.json()) as { versions: { version: number }[] };
    expect(fichaBody.versions.map((v) => v.version)).toEqual([2, 1]);
  });
});

describe('PATCH /api/templates/:id/status — transición de estado (§10.2)', () => {
  it('cambia draft→review→published', async () => {
    const created = await createTemplate(
      tdb.db,
      templateBody({ slug: 'status-tpl', status: 'draft' }),
    );
    const toReview = await statusRoute(
      new Request(`http://test.local/api/templates/${created.id}/status`, {
        method: 'PATCH',
        headers: { cookie: cookie(), 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'review' }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(((await toReview.json()) as { status: string }).status).toBe('review');

    const toPublished = await statusRoute(
      new Request(`http://test.local/api/templates/${created.id}/status`, {
        method: 'PATCH',
        headers: { cookie: cookie(), 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(((await toPublished.json()) as { status: string }).status).toBe('published');
  });
});
