// Los READ-MODELS de `/library` (T5.7, §9.7 N10) contra Postgres REAL (Testcontainers). Lo que se prueba y
// no se puede en otra capa:
//   1. `getVariantLineage` resuelve del máster hasta el hook line y el `template@version` EXACTOS + persona
//      + destino del lote (§14) — el linaje que la Verificación exige que la UI muestre.
//   2. TOLERA los punteros NULL: una variante con hook del BRIEF (`hook_line_id` null) NO lanza — devuelve
//      `hook: null` (leftJoin, no innerJoin: un inner join la perdería). Igual con persona/template ausentes.
//   3. `listLibraryVariants` lista SOLO las `approved` y filtra por objetivo/idioma/plataforma.
//   4. El `destination` sale de `ad_batch.matrix->>'destination'` con COALESCE a 'organic' (matriz legacy sin él).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { newUlid } from '@ugc/core/contracts';
import {
  adBatch,
  adVariant,
  asset,
  hookLine,
  persona,
  productBrief,
  promptTemplate,
  urlAnalysis,
} from '@ugc/db/schema';
import { createProject } from '../../src/repos/project.repo';
import { getVariantLineage, listLibraryVariants } from '../../src/repos/batch.repo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'db:library-read-models' });
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query(
    'TRUNCATE ad_variant, ad_batch, product_brief, url_analysis, asset, hook_line, persona, prompt_template, project CASCADE',
  );
});

/** Siembra project → urlAnalysis → brief y devuelve `{ projectId, briefId }`. */
async function seedProjectAndBrief(): Promise<{ projectId: string; briefId: string }> {
  const proj = await createProject(tdb.db, makeProject());
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: proj.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: { name: 'x' } }))
    .returning();
  return { projectId: proj.id, briefId: brief!.id };
}

/** Un lote con su `matrix` (jsonb) — donde vive `destination` (§14). */
async function seedBatch(
  projectId: string,
  briefId: string,
  matrix: Record<string, unknown>,
): Promise<string> {
  const batchId = newUlid();
  await tdb.db.insert(adBatch).values({
    id: batchId,
    projectId,
    briefId,
    matrix,
    tier: 'premium',
    objective: 'hook_test',
    languages: ['es'],
  });
  return batchId;
}

describe('read-models de /library (T5.7)', () => {
  it('getVariantLineage resuelve hook line + template@version + persona + destino EXACTOS', async () => {
    const { projectId, briefId } = await seedProjectAndBrief();
    const batchId = await seedBatch(projectId, briefId, { destination: 'both' });

    // Sembrar el hook line, la persona y el template de la librería.
    const [hook] = await tdb.db
      .insert(hookLine)
      .values({ angle: 'pain_point', text: 'La vitamina C que sí se nota', language: 'es' })
      .returning();
    const [pers] = await tdb.db
      .insert(persona)
      .values({
        name: 'Lucía',
        ageRange: '25-34',
        gender: 'female',
        ethnicity: 'latina',
        style: 'casual',
        descriptor: 'mujer de 29 años, latina, look casual',
        setting: 'baño luminoso',
        personality: 'cercana',
      })
      .returning();
    const [tpl] = await tdb.db
      .insert(promptTemplate)
      .values({
        slug: 'before-after-skincare',
        title: 'Before/After skincare',
        kind: 'video',
        body: '{persona.descriptor} muestra {product.name}',
        language: 'es',
      })
      .returning();

    // El máster final (final_video) al que apunta la variante.
    const [master] = await tdb.db
      .insert(asset)
      .values({
        kind: 'final_video',
        storageKey: `masters/${newUlid()}.mp4`,
        mime: 'video/mp4',
        bytes: 10_000_000,
        checksum: 'master-checksum',
        width: 1080,
        height: 1920,
        durationS: 15,
      })
      .returning();

    const variantId = newUlid();
    await tdb.db.insert(adVariant).values({
      id: variantId,
      batchId,
      angleName: 'A1 · Antes/después visible',
      framework: 'pain_point',
      hookLineId: hook!.id,
      personaId: pers!.id,
      promptTemplateId: tpl!.id,
      templateVersion: 3,
      language: 'es',
      durationTarget: 15,
      platformTargets: ['tiktok', 'meta'],
      filenameCode: 'nuvela-a1-h2-lucia-es-15s',
      status: 'approved',
      audioSource: 'ai_bed',
      masterAssetId: master!.id,
      score: 100,
    });

    const lineage = await getVariantLineage(tdb.db, variantId);
    expect(lineage).toBeDefined();
    if (lineage === undefined) return;

    // El hook line EXACTO.
    expect(lineage.hook).toEqual({
      id: hook!.id,
      text: 'La vitamina C que sí se nota',
      angle: 'pain_point',
    });
    // El template@version EXACTO (la versión es la de la VARIANTE, no la última del template).
    expect(lineage.template).toEqual({
      id: tpl!.id,
      slug: 'before-after-skincare',
      title: 'Before/After skincare',
      version: 3,
    });
    // La persona.
    expect(lineage.persona).toEqual({ id: pers!.id, name: 'Lucía' });
    // El máster.
    expect(lineage.master?.id).toBe(master!.id);
    expect(lineage.master?.durationS).toBe(15);
    // El destino del lote (§14) desde el jsonb `matrix`.
    expect(lineage.batch.destination).toBe('both');
    expect(lineage.batch.objective).toBe('hook_test');
    expect(lineage.batch.briefId).toBe(briefId);
    expect(lineage.variant.audioSource).toBe('ai_bed');
  });

  it('TOLERA un hook del BRIEF (hook_line_id null): devuelve hook null, no lanza', async () => {
    const { projectId, briefId } = await seedProjectAndBrief();
    const batchId = await seedBatch(projectId, briefId, {});

    const variantId = newUlid();
    await tdb.db.insert(adVariant).values({
      id: variantId,
      batchId,
      angleName: 'A2',
      framework: 'curiosity',
      // hookLineId, personaId, promptTemplateId, masterAssetId TODOS ausentes → null.
      language: 'en',
      durationTarget: 30,
      platformTargets: ['tiktok'],
      filenameCode: 'brief-hook-en-30s',
      status: 'approved',
    });

    const lineage = await getVariantLineage(tdb.db, variantId);
    expect(lineage).toBeDefined();
    if (lineage === undefined) return;
    expect(lineage.hook).toBeNull();
    expect(lineage.persona).toBeNull();
    expect(lineage.template).toBeNull();
    expect(lineage.master).toBeNull();
    // El destino cae a 'organic' cuando la matriz no lo declara (legacy).
    expect(lineage.batch.destination).toBe('organic');
  });

  it('getVariantLineage devuelve undefined para una variante inexistente', async () => {
    expect(await getVariantLineage(tdb.db, newUlid())).toBeUndefined();
  });

  it('listLibraryVariants lista SOLO las approved y filtra por objetivo/idioma/plataforma', async () => {
    const { projectId, briefId } = await seedProjectAndBrief();
    const batchId = await seedBatch(projectId, briefId, { destination: 'organic' });

    // 3 variantes: approved+es+tiktok, approved+en+meta, qa (no aprobada).
    const mk = async (overrides: Partial<typeof adVariant.$inferInsert>): Promise<string> => {
      const id = newUlid();
      await tdb.db.insert(adVariant).values({
        id,
        batchId,
        angleName: 'A',
        framework: 'pain_point',
        language: 'es',
        durationTarget: 15,
        platformTargets: ['tiktok'],
        filenameCode: `v-${id.slice(-8).toLowerCase()}`,
        status: 'approved',
        ...overrides,
      });
      return id;
    };
    const approvedEsTikTok = await mk({ language: 'es', platformTargets: ['tiktok'] });
    const approvedEnMeta = await mk({ language: 'en', platformTargets: ['meta'] });
    await mk({ status: 'qa' }); // no aprobada → nunca aparece

    const all = await listLibraryVariants(tdb.db);
    const ids = all.map((r) => r.id);
    expect(ids).toContain(approvedEsTikTok);
    expect(ids).toContain(approvedEnMeta);
    expect(all).toHaveLength(2); // la `qa` no está

    // Filtro por idioma.
    const es = await listLibraryVariants(tdb.db, { language: 'es' });
    expect(es.map((r) => r.id)).toEqual([approvedEsTikTok]);

    // Filtro por plataforma (`@>` sobre platform_targets).
    const meta = await listLibraryVariants(tdb.db, { platform: 'meta' });
    expect(meta.map((r) => r.id)).toEqual([approvedEnMeta]);

    // Filtro por objetivo del lote (todas son hook_test aquí).
    const conv = await listLibraryVariants(tdb.db, { objective: 'conversion' });
    expect(conv).toHaveLength(0);

    // El destino viaja en cada fila desde el matrix del lote.
    expect(all.every((r) => r.destination === 'organic')).toBe(true);
  });
});
