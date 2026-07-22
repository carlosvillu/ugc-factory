// LA VERIFICACIÓN DE T5.5c en su parte DETERMINISTA de la CAPA SERVER (regla de trabajo 8: vive en
// `pnpm gate`). Prueba los efectos de dominio de CP4 (QA, N9) contra Postgres real, al nivel del SEAM
// (server/qa-checkpoint.ts), donde vive la lógica que ninguna otra capa cubre:
//
//   · APROBAR CP4 → `ad_variant.status='approved'` (el máster es publicable).
//   · RECHAZAR CP4 → `ad_variant.status='rejected'` (el máster se descarta). CP4 es el PRIMER checkpoint
//     con efecto de dominio en la rama de RECHAZO.
//   · La discriminación por SCHEMA: un artefacto que no es N9 → no-op (no muta ninguna variante).
//
// La pausa del checkpoint (N9 → waiting_approval) se prueba en el worker (n9-checkpoint.test.ts); aquí el
// foco es el WRITER del veredicto + su despacho por la forma del artefacto. Se invoca `approveQaForStep`/
// `rejectQaForStep` DENTRO de un `withDomainTransaction` — EXACTAMENTE como los route handlers de
// approve/reject: así el status de la variante y la transición del step van en UNA tx (atomicidad CP4).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';
import type { N9Output } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import { stepExecuteJob } from '@ugc/core/jobs';
import {
  createBatchWithVariants,
  ensureQueue,
  listBatchVariants,
  listPlanningInputs,
  seedLibrary,
  withDomainTransaction,
  type Db,
} from '@ugc/db';
import { productBrief, project, urlAnalysis } from '@ugc/db/schema';
import {
  createTestDatabase,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeTestLogger,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { applyQaVerdict } from '@/server/qa-checkpoint';

let tdb: TestDatabase;
let boss: PgBoss;

const BRIEF = makeBrief();

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'web:qa-checkpoint' });
  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* irrelevante */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
});

afterAll(async () => {
  await boss.stop({ graceful: true, timeout: 10_000 });
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query(
    'TRUNCATE ad_script, ad_variant, ad_batch, step_run, pipeline_run, product_brief, url_analysis, project CASCADE',
  );
});

/** Siembra proyecto + análisis + brief + un lote con `n` variantes en `planned`. Devuelve los ids de variante. */
async function seedBatchVariants(db: Db, n: number): Promise<string[]> {
  const [p] = await db.insert(project).values(makeProject()).returning();
  const [ua] = await db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();

  const { libraryHooks, personas, recipe } = await listPlanningInputs(db, 'test');
  const config = {
    angleIndices: Array.from({ length: n }, (_, i) => i),
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'test' as const,
    languages: ['es'],
    personaMode: 'rotate' as const,
  };
  const args = { brief: BRIEF, config, libraryHooks, personas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(db, {
    projectId: p!.id,
    briefId: brief!.id,
    tier: 'test',
    objective: 'hook_test',
    languages: ['es'],
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
  const variants = await listBatchVariants(db, created.batch.id);
  return variants.map((v) => v.id);
}

/** El artefacto N9 que un step de CP4 lleva en su `output_refs` (lo lee el efecto de dominio). */
function n9Output(variantId: string, passed = true): N9Output {
  return {
    variantId,
    passed,
    qaReport: {
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
      metrics: {},
      passed,
      score: passed ? 100 : 88,
    },
  };
}

async function variantStatus(variantId: string): Promise<string> {
  const { rows } = await tdb.pool.query<{ status: string }>(
    'SELECT status FROM ad_variant WHERE id = $1',
    [variantId],
  );
  return rows[0]!.status;
}

/** Invoca un efecto de CP4 DENTRO de un `withDomainTransaction` (como los route handlers de approve/reject). */
async function inTx(fn: (db: Db) => Promise<void>): Promise<void> {
  await withDomainTransaction(tdb.db, boss, makeTestLogger(), ({ db }) => fn(db));
}

describe('CP4 · qa-checkpoint (T5.5c): el veredicto de QA sobre la variante', () => {
  it('APROBAR (status `approved`) un artefacto N9 → la variante pasa a `approved`', async () => {
    const [v1] = await seedBatchVariants(tdb.db, 1);
    expect(await variantStatus(v1!)).toBe('planned');

    await inTx((db) => applyQaVerdict(db, n9Output(v1!), 'approved'));

    expect(await variantStatus(v1!)).toBe('approved');
  });

  it('RECHAZAR (status `rejected`) un artefacto N9 → la variante pasa a `rejected` (efecto de dominio en el reject)', async () => {
    const [v1] = await seedBatchVariants(tdb.db, 1);

    await inTx((db) => applyQaVerdict(db, n9Output(v1!, false), 'rejected'));

    expect(await variantStatus(v1!)).toBe('rejected');
  });

  it('aprobar UNA y rechazar OTRA muta solo su propia variante (aislamiento por variantId del artefacto)', async () => {
    const [v1, v2] = await seedBatchVariants(tdb.db, 2);

    await inTx((db) => applyQaVerdict(db, n9Output(v1!), 'approved'));
    await inTx((db) => applyQaVerdict(db, n9Output(v2!, false), 'rejected'));

    expect(await variantStatus(v1!)).toBe('approved');
    expect(await variantStatus(v2!)).toBe('rejected');
  });

  it('no-op si el artefacto NO es N9 (no muta ninguna variante): discriminación por schema', async () => {
    const [v1] = await seedBatchVariants(tdb.db, 1);

    // Un artefacto que no valida N9OutputSchema (p. ej. un N8Output sin `passed`): el efecto no-opea, en
    // AMBAS ramas (approved y rejected).
    await inTx((db) =>
      applyQaVerdict(db, { variantId: v1, masterAssetId: 'm', thumbnailAssetId: 't' }, 'approved'),
    );
    await inTx((db) => applyQaVerdict(db, { foo: 'bar' }, 'rejected'));

    expect(await variantStatus(v1!)).toBe('planned');
  });

  it('ROLLBACK: si algo falla tras escribir el veredicto, la variante NO queda mutada (atomicidad de la tx)', async () => {
    // El invariante de atomicidad CP4: el efecto escribe `approved` DENTRO de la tx; un throw posterior en
    // el mismo callback (simula el fallo de la transición del step o de persistir la decisión) deshace el
    // status. Sin la tx compartida, la variante quedaría `approved` sobre un step no aprobado.
    const [v1] = await seedBatchVariants(tdb.db, 1);

    await expect(
      inTx(async (db) => {
        await applyQaVerdict(db, n9Output(v1!), 'approved');
        throw new Error('fallo forzado tras escribir el veredicto');
      }),
    ).rejects.toThrow(/fallo forzado/);

    // El rollback deshizo el `approved`: la variante sigue en `planned`.
    expect(await variantStatus(v1!)).toBe('planned');
  });
});
