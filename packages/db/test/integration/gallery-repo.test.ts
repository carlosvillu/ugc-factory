// Repo de LECTURA + versionado de la galería (T3.8) contra el clon de Testcontainers
// (db-integration.md §6). NADA de mocks: la búsqueda facetada depende de los GIN de T3.1 y de la
// semántica REAL de `@>` sobre text[]; el versionado inmutable depende del UNIQUE
// (template, version) de T3.1 — un doble ocultaría justo lo que la Verificación exige.
//
// Cláusulas de la Verificación de T3.8 codificadas como red permanente del gate (regla 8):
//   · «filtrar por 2 facetas» → `listTemplates` con dos facetas devuelve EXACTAMENTE las filas
//     que contienen ambos valores (y ni una más).
//   · «guardar crea prompt_version v2 con diff visible contra v1» → `createTemplateVersion` sobre
//     un template SIN versiones (el caso del seed de T3.7) materializa v1, inserta v2 con el body
//     editado, deja v1 INTACTA (§10.1 inmutable) y sube `head_version` a 2.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { promptTemplate, promptVersion, type NewPromptTemplate } from '../../src/schema/gallery';
import {
  createTemplateVersion,
  getTemplateWithVersions,
  listTemplates,
  setTemplateStatus,
} from '../../src/repos/gallery.repo';

let tdb: TestDatabase;

/** Un template con facetas controladas. El body lleva un slot §10.4 válido (lo que la ficha
 *  resalta). */
function tpl(
  over: Partial<NewPromptTemplate> & Pick<NewPromptTemplate, 'slug'>,
): NewPromptTemplate {
  return {
    title: `T ${over.slug}`,
    kind: 'video',
    body: `Cuerpo de ${over.slug} con {product.name}.`,
    language: 'es',
    formats: [],
    hookAngles: [],
    verticals: [],
    platforms: [],
    aesthetics: [],
    status: 'draft',
    ...over,
  };
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'gallery-repo' });
  await tdb.db.insert(promptTemplate).values([
    // Casa beauty + before-after (el objetivo de la 2-facet query).
    tpl({
      slug: 'ba-beauty',
      formats: ['before-after'],
      hookAngles: ['visual-proof'],
      verticals: ['beauty'],
      status: 'published',
    }),
    // beauty pero NO before-after → NO debe salir del filtro de 2 facetas.
    tpl({ slug: 'grwm-beauty', formats: ['grwm'], verticals: ['beauty'], status: 'draft' }),
    // before-after pero NO beauty → NO debe salir.
    tpl({ slug: 'ba-food', formats: ['before-after'], verticals: ['food'], status: 'published' }),
    // Otro que casa ambas → el filtro devuelve 2.
    tpl({
      slug: 'ba-beauty-2',
      formats: ['before-after', 'demo'],
      verticals: ['beauty', 'apps'],
      status: 'review',
    }),
  ]);
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto vitest no termina.
});

describe('listTemplates — búsqueda facetada (§10.1, GIN de T3.1)', () => {
  it('filtrar por 2 facetas (before-after + beauty) devuelve EXACTAMENTE las que contienen ambas', async () => {
    const res = await listTemplates(tdb.db, {
      formats: ['before-after'],
      verticals: ['beauty'],
    });
    const slugs = res.templates.map((t) => t.slug).sort();
    expect(slugs).toEqual(['ba-beauty', 'ba-beauty-2']);
    expect(res.total).toBe(2);
  });

  it('sin filtro devuelve todo el catálogo y conteos GLOBALES por faceta', async () => {
    const res = await listTemplates(tdb.db);
    expect(res.total).toBe(4);
    // Conteo global de la faceta `verticals`: beauty aparece en 3 filas.
    const beauty = res.facets.verticals.find((f) => f.value === 'beauty');
    expect(beauty?.count).toBe(3);
    // before-after aparece en 3 filas de `formats`.
    const ba = res.facets.formats.find((f) => f.value === 'before-after');
    expect(ba?.count).toBe(3);
  });

  it('los conteos por estado reflejan draft/review/published', async () => {
    const res = await listTemplates(tdb.db);
    const map = Object.fromEntries(res.statusCounts.map((s) => [s.value, s.count]));
    expect(map.published).toBe(2);
    expect(map.draft).toBe(1);
    expect(map.review).toBe(1);
  });

  it('filtrar por estado acota las tarjetas (no los conteos, que son globales)', async () => {
    const res = await listTemplates(tdb.db, { status: 'published' });
    expect(res.templates.map((t) => t.slug).sort()).toEqual(['ba-beauty', 'ba-food']);
    // El conteo de facetas sigue siendo global: beauty = 3 aunque solo 1 published sea beauty.
    expect(res.facets.verticals.find((f) => f.value === 'beauty')?.count).toBe(3);
  });
});

describe('createTemplateVersion — versionado inmutable (§10.1)', () => {
  it('sobre un template SIN versiones (caso seed T3.7): materializa v1, inserta v2, v1 intacta, head_version=2', async () => {
    // Un template fresco, tal como lo deja el seed (head_version=0, cero prompt_version).
    const [seeded] = await tdb.db
      .insert(promptTemplate)
      .values(tpl({ slug: 'ver-1', body: 'cuerpo original v1 con {product.name}' }))
      .returning();
    expect(seeded).toBeDefined();
    const id = seeded!.id;
    expect(seeded!.headVersion).toBe(0);

    const result = await createTemplateVersion(tdb.db, id, {
      body: 'cuerpo EDITADO v2 con {product.name} y {benefit.primary}',
      changelog: 'añadido beneficio',
    });
    expect(result).toBeDefined();

    // v1 (materializada) = el body ORIGINAL; v2 = el editado.
    expect(result!.previous.version).toBe(1);
    expect(result!.previous.body).toBe('cuerpo original v1 con {product.name}');
    expect(result!.created.version).toBe(2);
    expect(result!.created.body).toContain('EDITADO v2');

    // El template vive en su cabeza: body editado + head_version=2.
    expect(result!.template.headVersion).toBe(2);
    expect(result!.template.body).toContain('EDITADO v2');

    // La ficha devuelve las 2 versiones, la más nueva primero.
    const withVersions = await getTemplateWithVersions(tdb.db, id);
    expect(withVersions!.versions.map((v) => v.version)).toEqual([2, 1]);

    // §10.1 INMUTABLE: v1 en la BD sigue siendo el original — la edición NO la mutó.
    const [v1Row] = await tdb.db
      .select()
      .from(promptVersion)
      .where(eq(promptVersion.templateId, id))
      .orderBy(promptVersion.version)
      .limit(1);
    expect(v1Row!.body).toBe('cuerpo original v1 con {product.name}');
  });

  it('una segunda edición NO re-materializa v1: inserta v3 sobre la cabeza existente', async () => {
    const [seeded] = await tdb.db
      .insert(promptTemplate)
      .values(tpl({ slug: 'ver-2', body: 'base' }))
      .returning();
    const id = seeded!.id;

    await createTemplateVersion(tdb.db, id, { body: 'edición A' }); // v1(base) + v2
    const second = await createTemplateVersion(tdb.db, id, { body: 'edición B' }); // v3
    expect(second!.created.version).toBe(3);
    expect(second!.previous.version).toBe(2);
    expect(second!.previous.body).toBe('edición A');

    const withVersions = await getTemplateWithVersions(tdb.db, id);
    expect(withVersions!.versions.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it('un id inexistente devuelve undefined (el endpoint → 404)', async () => {
    const res = await createTemplateVersion(tdb.db, 'nope-no-existe', { body: 'x' });
    expect(res).toBeUndefined();
  });
});

describe('setTemplateStatus — transición de estado (§10.2)', () => {
  it('cambia draft→review→published', async () => {
    const [seeded] = await tdb.db
      .insert(promptTemplate)
      .values(tpl({ slug: 'st-1', status: 'draft' }))
      .returning();
    const id = seeded!.id;

    const review = await setTemplateStatus(tdb.db, id, 'review');
    expect(review!.status).toBe('review');
    const published = await setTemplateStatus(tdb.db, id, 'published');
    expect(published!.status).toBe('published');
  });
});
