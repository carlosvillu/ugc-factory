// Integración handler-level de `GET /api/variants/:id` (T5.6) contra Postgres real (api.md §2, nivel
// 1). El endpoint que CP4 usa para el player: el artefacto de N9 NO lleva el `masterAssetId` (solo
// `{variantId, passed, qaReport}`), así que el panel pide la FILA de la variante por aquí para resolver
// el `src` del `<video>`. Lo que se prueba: devuelve el `master_asset_id` de la variante (nullable) +
// su identidad, exige sesión (withAuth) y da 404 para una variante inexistente.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import {
  createAsset,
  createBatchWithVariants,
  listBatchVariants,
  listPlanningInputs,
  seedLibrary,
} from '@ugc/db';
import { productBrief, project as projectTable, urlAnalysis } from '@ugc/db/schema';
import {
  createTestDatabase,
  makeAsset,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { setDbForTests } from '@/server/db';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { GET as getVariant } from '@/app/api/variants/[id]/route';

const TEST_MASTER_KEY = 'test-master-key-for-variant-detail-suite';

let tdb: TestDatabase;

function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

function call(id: string, opts: { auth: boolean } = { auth: true }): Promise<Response> {
  return getVariant(
    new Request(`http://test.local/api/variants/${id}`, {
      headers: opts.auth ? { cookie: cookie() } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** Siembra proyecto + análisis + brief + un lote con 1 variante en `planned`. Devuelve el id de la
 *  variante (el mismo camino tipado que `qa-checkpoint.test.ts`). */
async function seedVariant(db: TestDatabase['db']): Promise<string> {
  const [p] = await db.insert(projectTable).values(makeProject()).returning();
  const [ua] = await db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const brief = makeBrief();
  const [briefRow] = await db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: brief }))
    .returning();

  const { libraryHooks, personas, recipe } = await listPlanningInputs(db, 'test');
  const config = {
    angleIndices: [0],
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'test' as const,
    languages: ['es'],
    personaMode: 'rotate' as const,
  };
  const args = { brief, config, libraryHooks, personas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(db, {
    projectId: p!.id,
    briefId: briefRow!.id,
    tier: 'test',
    objective: 'hook_test',
    languages: ['es'],
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
  const [variant] = await listBatchVariants(db, created.batch.id);
  return variant!.id;
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:variant-detail' });
  setDbForTests(tdb.db);
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
});

afterEach(async () => {
  await tdb.pool.query(
    'TRUNCATE ad_script, ad_variant, ad_batch, asset, product_brief, url_analysis, project CASCADE',
  );
});

afterAll(async () => {
  setDbForTests(undefined);
  setMasterKeyForTests(undefined);
  await tdb.close();
});

describe('GET /api/variants/:id (T5.6)', () => {
  it('devuelve el `masterAssetId` de la variante + su identidad', async () => {
    const variantId = await seedVariant(tdb.db);

    // Un máster sintético apuntado desde la variante (lo que CP4 lee para el player).
    const master = await createAsset(
      tdb.db,
      makeAsset({ kind: 'final_video', mime: 'video/mp4', bytes: 1, checksum: 'x'.repeat(64) }),
    );
    await tdb.pool.query('UPDATE ad_variant SET master_asset_id = $1 WHERE id = $2', [
      master.id,
      variantId,
    ]);

    const res = await call(variantId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      masterAssetId: string | null;
      filenameCode: string;
      angleName: string;
      language: string;
      status: string;
    };
    expect(body.id).toBe(variantId);
    // LA CLÁUSULA: el máster viaja (sin él el player no tiene `src`).
    expect(body.masterAssetId).toBe(master.id);
    expect(body.filenameCode).toBeTruthy();
    expect(body.language).toBe('es');
    expect(body.status).toBe('planned');
  });

  it('una variante SIN máster devuelve `masterAssetId: null` (no un hueco raro)', async () => {
    const variantId = await seedVariant(tdb.db);

    const body = (await (await call(variantId)).json()) as { masterAssetId: string | null };
    // El máster es nullable: N8 aún no lo escribió (o se soltó). El panel lo trata como "sin player".
    expect(body.masterAssetId).toBeNull();
  });

  it('una variante inexistente → 404 not_found', async () => {
    const res = await call(newUlid());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_found');
  });

  it(':id malformado (no ULID) → 400 validation_error', async () => {
    const res = await call('not-a-ulid');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('sin sesión → 401 unauthorized (withAuth es la barrera real)', async () => {
    const res = await call(newUlid(), { auth: false });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });
});
