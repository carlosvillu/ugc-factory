// Integración handler-level de `PUT|DELETE /api/variants/:id/music-bed` (T6.2b, §14 `own_license`) contra
// Postgres real (api.md §2, nivel 1). El endpoint que ATA (o desata) una pista musical propia a una
// variante — «seleccionable en la matriz», la superficie API de la selección de bed propio (sin UI).
// Lo que se prueba: atar escribe puntero + audio_source=own_license; un asset que NO es music_bed se
// rechaza en la frontera (400, nunca reventaría dentro de ffmpeg); desatar limpia; auth y 404.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import {
  createAsset,
  createBatchWithVariants,
  getVariant,
  listBatchVariants,
  listPlanningInputs,
  seedLibrary,
} from '@ugc/db';
import { productBrief, project as projectTable, urlAnalysis } from '@ugc/db/schema';
import {
  createTestDatabase,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { setDbForTests } from '@/server/db';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { DELETE, PUT } from '@/app/api/variants/[id]/music-bed/route';

const TEST_MASTER_KEY = 'test-master-key-for-variant-music-bed';

let tdb: TestDatabase;

function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

function callPut(
  id: string,
  body: unknown,
  opts: { auth: boolean } = { auth: true },
): Promise<Response> {
  return PUT(
    new Request(`http://test.local/api/variants/${id}/music-bed`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(opts.auth ? { cookie: cookie() } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function callDelete(id: string, opts: { auth: boolean } = { auth: true }): Promise<Response> {
  return DELETE(
    new Request(`http://test.local/api/variants/${id}/music-bed`, {
      method: 'DELETE',
      headers: opts.auth ? { cookie: cookie() } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** Un asset `music_bed` real (pista subida por el usuario). */
async function seedMusicBedAsset(): Promise<string> {
  const bed = await createAsset(tdb.db, {
    kind: 'music_bed',
    storageKey: `music/${newUlid()}.mp3`,
    mime: 'audio/mpeg',
    bytes: 4096,
    checksum: 'a'.repeat(64),
  });
  return bed.id;
}

/** Marca una variante como YA compuesta: crea un asset `final_video` y lo apunta como `master_asset_id`
 *  (el estado tras N8). Es lo que dispara el guard de coherencia 409 del endpoint. */
async function markVariantComposed(variantId: string): Promise<void> {
  const master = await createAsset(tdb.db, {
    kind: 'final_video',
    storageKey: `masters/${variantId}/master.mp4`,
    mime: 'video/mp4',
    bytes: 1024,
    checksum: 'c'.repeat(64),
  });
  await tdb.pool.query(`UPDATE ad_variant SET master_asset_id = $1 WHERE id = $2`, [
    master.id,
    variantId,
  ]);
}

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
  tdb = await createTestDatabase({ label: 'web:variant-music-bed' });
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

describe('PUT /api/variants/:id/music-bed (T6.2b · own_license)', () => {
  it('ata un music_bed → 200, puntero + audio_source=own_license persistidos', async () => {
    const variantId = await seedVariant(tdb.db);
    const bedId = await seedMusicBedAsset();

    const res = await callPut(variantId, { assetId: bedId });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      variantId: string;
      ownMusicBedAssetId: string | null;
      audioSource: string | null;
    };
    expect(body.ownMusicBedAssetId).toBe(bedId);
    expect(body.audioSource).toBe('own_license');

    const after = await getVariant(tdb.db, variantId);
    expect(after?.ownMusicBedAssetId).toBe(bedId);
    expect(after?.audioSource).toBe('own_license');
  });

  it('LA BARRERA: un asset que NO es music_bed (reference_image) → 400, nada persistido', async () => {
    const variantId = await seedVariant(tdb.db);
    const img = await createAsset(tdb.db, {
      kind: 'reference_image',
      storageKey: `intake/${newUlid()}.png`,
      mime: 'image/png',
      bytes: 10,
      checksum: 'b'.repeat(64),
    });

    const res = await callPut(variantId, { assetId: img.id });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');

    const after = await getVariant(tdb.db, variantId);
    expect(after?.ownMusicBedAssetId).toBeNull(); // no se ató nada
  });

  it('COHERENCIA: una variante YA compuesta (master_asset_id != null) → 409, no reata', async () => {
    // El máster ya deriva del bed usado al componer; reatar otro dejaría la fila mintiendo sobre la
    // procedencia del máster real → se rechaza (recomponer es regeneración, no un reatado silencioso).
    const variantId = await seedVariant(tdb.db);
    await markVariantComposed(variantId);
    const bedId = await seedMusicBedAsset();

    const res = await callPut(variantId, { assetId: bedId });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');

    const after = await getVariant(tdb.db, variantId);
    expect(after?.ownMusicBedAssetId).toBeNull(); // no se ató nada
  });

  it('asset inexistente → 404 not_found', async () => {
    const variantId = await seedVariant(tdb.db);
    const res = await callPut(variantId, { assetId: newUlid() });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_found');
  });

  it('variante inexistente → 404 not_found', async () => {
    const bedId = await seedMusicBedAsset();
    const res = await callPut(newUlid(), { assetId: bedId });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_found');
  });

  it('body sin assetId → 400 validation_error', async () => {
    const variantId = await seedVariant(tdb.db);
    const res = await callPut(variantId, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('sin sesión → 401 unauthorized', async () => {
    const res = await callPut(newUlid(), { assetId: newUlid() }, { auth: false });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });
});

describe('DELETE /api/variants/:id/music-bed (T6.2b · desatar)', () => {
  it('desata → 200, puntero y audio_source vuelven a NULL', async () => {
    const variantId = await seedVariant(tdb.db);
    const bedId = await seedMusicBedAsset();
    await callPut(variantId, { assetId: bedId });

    const res = await callDelete(variantId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ownMusicBedAssetId: string | null;
      audioSource: string | null;
    };
    expect(body.ownMusicBedAssetId).toBeNull();
    expect(body.audioSource).toBeNull();

    const after = await getVariant(tdb.db, variantId);
    expect(after?.ownMusicBedAssetId).toBeNull();
    expect(after?.audioSource).toBeNull();
  });

  it('NO-OP: DELETE sobre una variante ai_bed (sin bed propio) NO borra su audio_source', async () => {
    // Un DELETE espurio (doble clic, retry, «quitar música» sobre una variante que nunca tuvo bed propio):
    // la variante generó normal (N7e → ai_bed, sin puntero). El máster SÍ tiene música IA → desatar NO debe
    // borrar su procedencia. Devuelve 200 con el estado ACTUAL, sin tocar la fila.
    const variantId = await seedVariant(tdb.db);
    await tdb.pool.query(`UPDATE ad_variant SET audio_source = 'ai_bed' WHERE id = $1`, [
      variantId,
    ]);

    const res = await callDelete(variantId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { audioSource: string | null };
    expect(body.audioSource).toBe('ai_bed'); // preservado

    const after = await getVariant(tdb.db, variantId);
    expect(after?.audioSource).toBe('ai_bed'); // NO borrado a NULL
    expect(after?.ownMusicBedAssetId).toBeNull();
  });

  it('COHERENCIA: DELETE sobre una variante YA compuesta → 409, no toca la fila', async () => {
    const variantId = await seedVariant(tdb.db);
    const bedId = await seedMusicBedAsset();
    await callPut(variantId, { assetId: bedId }); // ata ANTES de componer (permitido)
    await markVariantComposed(variantId); // ahora tiene máster

    const res = await callDelete(variantId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');

    const after = await getVariant(tdb.db, variantId);
    expect(after?.ownMusicBedAssetId).toBe(bedId); // intacto
    expect(after?.audioSource).toBe('own_license');
  });

  it('variante inexistente → 404 not_found', async () => {
    const res = await callDelete(newUlid());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_found');
  });

  it('sin sesión → 401 unauthorized', async () => {
    const res = await callDelete(newUlid(), { auth: false });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });
});
