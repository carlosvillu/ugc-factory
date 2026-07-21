// La RUTA SQL de la persistencia del pase final (T5.5), contra Postgres REAL (Testcontainers). Es la 2ª
// capa de test del patrón T5.2/T5.3: la media (ffmpeg/c2patool) corre en la imagen del worker; la
// PERSISTENCIA (crear las filas `asset` del máster + thumbnail con linaje, y actualizar la variante) se
// verifica aquí, en el gate, con SQL real. Lo que se prueba y no se puede en otra capa:
//   1. El máster es una fila `asset` PROPIA (`kind:'final_video'`) con checksum y `parent_asset_ids`
//      (el LINAJE que T5.7 recorre del máster hasta el hook) — NO un update suelto de jsonb.
//   2. El thumbnail es su propia fila (`kind:'thumbnail'`) con `parent_asset_ids:[masterId]`.
//   3. `ad_variant.{master_asset_id, thumbnail_asset_id, qa_report, score}` quedan poblados.
//   4. ATOMICIDAD: si la variante no existe, NO queda ninguna fila `asset` (todo en una tx).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createTestDatabase,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { newUlid } from '@ugc/core/contracts';
import type { QaReport } from '@ugc/core/contracts';
import { adBatch, adVariant, productBrief, urlAnalysis } from '@ugc/db/schema';
import { createProject } from '../../src/repos/project.repo';
import { createAsset, getAsset } from '../../src/repos/asset.repo';
import { finalizeVariantMaster } from '../../src/repos/batch.repo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'db:finalize-variant-master' });
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query(
    'TRUNCATE ad_variant, ad_batch, product_brief, url_analysis, asset, project CASCADE',
  );
});

/** Un `qa_report` con todos los checks en pass (el objeto que persiste la columna jsonb). */
function passingQaReport(): QaReport {
  return {
    checks: {
      resolution: 'pass',
      fps: 'pass',
      codec: 'pass',
      duration: 'pass',
      loudness: 'pass',
      av_duration_diff: 'pass',
      captions_safe_zone: 'pass',
      filesize: 'pass',
    },
    metrics: {
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: 'h264',
      pixFmt: 'yuv420p',
      videoDurationS: 20,
      audioDurationS: 20,
      loudnessLufs: -14,
      filesizeBytes: 10_000_000,
      captionViolations: 0,
    },
    passed: true,
    score: 100,
  };
}

/** Siembra project → urlAnalysis → brief → batch → variant y devuelve el variantId. */
async function seedVariant(): Promise<string> {
  const proj = await createProject(tdb.db, makeProject());
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: proj.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: { name: 'x' } }))
    .returning();
  const batchId = newUlid();
  const filenameCode = `t55-${batchId.slice(-6).toLowerCase()}-es-30s`;
  await tdb.db.insert(adBatch).values({
    id: batchId,
    projectId: proj.id,
    briefId: brief!.id,
    matrix: {},
    tier: 'premium',
    objective: 'conversion',
    languages: ['es'],
  });
  const variantId = newUlid();
  await tdb.db.insert(adVariant).values({
    id: variantId,
    batchId,
    angleName: 'pain_point',
    framework: 'pain_point',
    language: 'es',
    durationTarget: 30,
    filenameCode,
    status: 'scripted',
  });
  return variantId;
}

/** Siembra los assets ORIGEN (clips/voces) que serán el linaje del máster. */
async function seedParentAssets(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = await createAsset(tdb.db, {
      kind: i % 2 === 0 ? 'broll_clip' : 'tts_audio',
      storageKey: `seg/${newUlid()}.mp4`,
      mime: 'video/mp4',
      bytes: 2048,
      checksum: `parent-${String(i)}-checksum`,
    });
    ids.push(a.id);
  }
  return ids;
}

describe('finalizeVariantMaster (persistencia del pase final, T5.5)', () => {
  it('crea el máster (final_video) con linaje + el thumbnail + puebla la variante', async () => {
    const variantId = await seedVariant();
    const parents = await seedParentAssets(3);
    const qa = passingQaReport();

    const result = await finalizeVariantMaster(tdb.db, {
      variantId,
      master: {
        storageKey: `masters/${variantId}.mp4`,
        mime: 'video/mp4',
        bytes: 10_000_000,
        checksum: 'master-checksum-abc',
        width: 1080,
        height: 1920,
        durationS: 20,
      },
      thumbnail: {
        storageKey: `thumbs/${variantId}.jpg`,
        mime: 'image/jpeg',
        bytes: 50_000,
        checksum: 'thumb-checksum-xyz',
        width: 1080,
        height: 1920,
      },
      parentAssetIds: parents,
      qaReport: qa,
    });

    // 1) El máster es su propia fila `asset` (final_video) con checksum y LINAJE.
    expect(result.master.kind).toBe('final_video');
    expect(result.master.checksum).toBe('master-checksum-abc');
    expect(result.master.parentAssetIds).toEqual(parents);
    const masterRow = await getAsset(tdb.db, result.master.id);
    expect(masterRow?.storageKey).toBe(`masters/${variantId}.mp4`);
    expect(masterRow?.parentAssetIds).toHaveLength(3);

    // 2) El thumbnail es su propia fila, con parent = el máster.
    expect(result.thumbnail.kind).toBe('thumbnail');
    expect(result.thumbnail.parentAssetIds).toEqual([result.master.id]);

    // 3) La variante quedó poblada.
    expect(result.variant.masterAssetId).toBe(result.master.id);
    expect(result.variant.thumbnailAssetId).toBe(result.thumbnail.id);
    expect(result.variant.score).toBe(100);
    const [reread] = await tdb.db.select().from(adVariant).where(eq(adVariant.id, variantId));
    expect(reread?.qaReport).toMatchObject({ passed: true, checks: { resolution: 'pass' } });
    expect(reread?.masterAssetId).toBe(result.master.id);
  });

  it('el score se deriva del qa_report (un report con checks en fail baja el score)', async () => {
    const variantId = await seedVariant();
    const parents = await seedParentAssets(1);
    const qa = passingQaReport();
    // 6/8 en pass → score 75.
    qa.checks.fps = 'fail';
    qa.checks.filesize = 'fail';
    qa.passed = false;
    qa.score = 75;

    const result = await finalizeVariantMaster(tdb.db, {
      variantId,
      master: {
        storageKey: `masters/${variantId}.mp4`,
        mime: 'video/mp4',
        bytes: 10_000_000,
        checksum: 'm2',
      },
      thumbnail: {
        storageKey: `thumbs/${variantId}.jpg`,
        mime: 'image/jpeg',
        bytes: 50_000,
        checksum: 't2',
      },
      parentAssetIds: parents,
      qaReport: qa,
    });
    expect(result.variant.score).toBe(75);
  });

  it('ATOMICIDAD: si la variante no existe, no queda ninguna fila `asset`', async () => {
    const parents = await seedParentAssets(1);
    const before = (
      await tdb.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM asset')
    ).rows[0]?.count;

    await expect(
      finalizeVariantMaster(tdb.db, {
        variantId: newUlid(), // no existe
        master: {
          storageKey: 'masters/ghost.mp4',
          mime: 'video/mp4',
          bytes: 1,
          checksum: 'g',
        },
        thumbnail: {
          storageKey: 'thumbs/ghost.jpg',
          mime: 'image/jpeg',
          bytes: 1,
          checksum: 'g',
        },
        parentAssetIds: parents,
        qaReport: passingQaReport(),
      }),
    ).rejects.toThrow(/no existe la variante/);

    // El INSERT del máster + thumbnail se revirtió con la tx: el conteo de assets no cambió.
    const after = (
      await tdb.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM asset')
    ).rows[0]?.count;
    expect(after).toBe(before);
  });
});
