// Regresión permanente de CP4 — REVISIÓN DE VARIANTES (T5.6, e2e.md §8/§9, DoD BLOQUEANTE). Ejercita
// el panel de QA COMPLETO (sidebar de variantes, player, overlays de safe zones, resultados de QA y
// aprobar/rechazar) contra el sistema real (web + SSE + store + los routes de approve/reject + BD).
//
// POR QUÉ SE SIEMBRA EN VEZ DE RECORRER EL PIPELINE. La Verificación de T5.6 es de COSTE $0: aprobar/
// rechazar no gastan, y recorrer N6→N8 gastaría fal de verdad. Así que se siembran MÁSTERES SINTÉTICOS
// (fichero mp4 real en el almacén del stack + fila `asset` `final_video` + `ad_variant.master_asset_id`)
// y los steps N9 PAUSADOS a mano (un `waiting_approval` por variante, con su `N9Output`) — el mismo
// atajo que la suite de integración de CP4 (`checkpoints.test.ts`), subido a la capa e2e.
//
// EL MUST-CARRY DE CP4: son N pausas N9 EN PARALELO, no una. Se siembran TRES variantes con TRES N9
// pausados a la vez y se comprueba que las TRES aparecen en el sidebar y se resuelven POR SEPARADO
// (aprobar 2 + rechazar 1, EXACTAMENTE lo que pide la Verificación). Un test con una sola variante
// pasaría en verde ocultando que el caso multi-variante está roto (`usePausedCheckpoint` colapsa a
// `paused[0]`): por eso el mínimo es 3.
import { randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { newUlid } from '@ugc/core/contracts';
import type { N9Output } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import {
  createBatchWithVariants,
  createAsset,
  createDb,
  listBatchVariants,
  listPlanningInputs,
  makeLocalStorageAdapter,
} from '@ugc/db';
import {
  productBrief as productBriefTable,
  project as projectTable,
  urlAnalysis as urlAnalysisTable,
} from '@ugc/db/schema';
import {
  makeAsset,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
} from '@ugc/test-utils';
import { queryStack, stackDatabaseUrl, assetsDir } from './support/stack-db';

const stackDb = createDb(stackDatabaseUrl);
const storage = makeLocalStorageAdapter({ root: assetsDir });

const BRIEF = makeBrief();

/** El artefacto N9 que un step de CP4 lleva en `output_refs` (lo lee el efecto de dominio de approve/
 *  reject Y el panel para el `qaReport`). `passed=false` mete un check en `fail` para que el panel
 *  tenga que pintar un `✕` — la mitad negativa del render de QA. */
function n9Output(variantId: string, passed: boolean): N9Output {
  return {
    variantId,
    passed,
    qaReport: {
      checks: {
        resolution: 'pass',
        fps: 'pass',
        codec: 'pass',
        duration: 'pass',
        loudness: passed ? 'pass' : 'fail',
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

/** Un máster sintético: fichero mp4 real en el almacén + fila `asset` `final_video`. El player lo pide
 *  por `/api/assets/:id/download`; el e2e no reproduce (solo comprueba el `src`), pero el fichero
 *  existe por si algún día se afirma la descarga. */
async function seedMaster(): Promise<string> {
  const bytes = randomBytes(4096);
  const id = newUlid();
  const storageKey = `e2e/cp4-${id}.mp4`;
  const put = await storage.put(storageKey, bytes, { mime: 'video/mp4' });
  const row = await createAsset(
    stackDb,
    makeAsset({
      id,
      kind: 'final_video',
      storageKey,
      mime: 'video/mp4',
      bytes: put.bytes,
      checksum: put.checksum,
    }),
  );
  return row.id;
}

interface SeededRun {
  runId: string;
  /** Las variantes sembradas, en orden de `filename_code`, con su step N9 pausado. */
  variants: { id: string; filenameCode: string; stepId: string; passed: boolean }[];
}

/**
 * Siembra un run de CP4 completo: proyecto + análisis + brief + un lote con 3 variantes (cada una con
 * su máster sintético) + un `pipeline_run` + 3 steps N9 en `waiting_approval` (uno por variante). Una
 * variante se marca `passed=false` para ejercer el render de un check fallido.
 *
 * La siembra de datos EN REPOSO (project/analysis/brief/lote) va por el cliente TIPADO (`createDb` +
 * repos, e2e.md §6); el run + los N9 + el puntero al máster van por SQL crudo (`queryStack`): no hay
 * repo tipado que inserte steps arbitrarios ni que ponga solo el `master_asset_id` — el mismo criterio
 * que `checkpoints.test.ts`.
 */
async function seedCp4Run(): Promise<SeededRun> {
  const [p] = await stackDb.insert(projectTable).values(makeProject()).returning();
  const projectId = p!.id;
  const [ua] = await stackDb
    .insert(urlAnalysisTable)
    .values(makeUrlAnalysis({ projectId }))
    .returning();
  const [brief] = await stackDb
    .insert(productBriefTable)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();

  const { libraryHooks, personas, recipe } = await listPlanningInputs(stackDb, 'test');
  const config = {
    angleIndices: [0, 1, 2],
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'test' as const,
    languages: ['es'],
    personaMode: 'rotate' as const,
  };
  const args = { brief: BRIEF, config, libraryHooks, personas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(stackDb, {
    projectId,
    briefId: brief!.id,
    tier: 'test',
    objective: 'hook_test',
    languages: ['es'],
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
  const dbVariants = await listBatchVariants(stackDb, created.batch.id);
  expect(dbVariants.length).toBeGreaterThanOrEqual(3);
  const chosen = dbVariants.slice(0, 3);

  // Un run de generación (solo necesita id + project_id para que `GET /api/runs/:id` lo sirva).
  const runId = newUlid();
  await queryStack(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [runId, projectId]);

  const variants: SeededRun['variants'] = [];
  for (let i = 0; i < chosen.length; i++) {
    const v = chosen[i]!;
    // Máster sintético + apuntarlo desde la variante (lo que el player lee por `variantActions.get`).
    const masterId = await seedMaster();
    await queryStack(`UPDATE ad_variant SET master_asset_id = $1 WHERE id = $2`, [masterId, v.id]);

    // El step N9 en `waiting_approval`, con su `variant_id` y su `N9Output`. La última se rechaza.
    const passed = i < 2;
    const stepId = newUlid();
    await queryStack(
      `INSERT INTO step_run (id, run_id, node_key, variant_id, status, is_checkpoint, checkpoint_config, output_refs, depends_on)
       VALUES ($1, $2, 'N9', $3, 'waiting_approval', true, $4, $5, '{}')`,
      [
        stepId,
        runId,
        v.id,
        JSON.stringify({ alwaysPause: true }),
        JSON.stringify(n9Output(v.id, passed)),
      ],
    );
    variants.push({ id: v.id, filenameCode: v.filenameCode, stepId, passed });
  }

  return { runId, variants };
}

/** El panel de CP4 entero (sidebar + detalle). Su `data-slot` ES el contrato de testabilidad. */
function panel(page: Page) {
  return page.locator('[data-slot="qa-panel"]');
}

/** Las tarjetas del sidebar izquierdo (una por variante pausada). */
function variantItems(page: Page) {
  return page.locator('[data-slot="qa-variant-item"]');
}

async function variantStatus(variantId: string): Promise<string> {
  const rows = await queryStack<{ status: string }>(`SELECT status FROM ad_variant WHERE id = $1`, [
    variantId,
  ]);
  return rows[0]?.status ?? '(no row)';
}

/** Selecciona una variante en el sidebar por su step-id y espera a que su detalle cargue. */
async function selectVariant(page: Page, stepId: string): Promise<void> {
  await page.locator(`[data-slot="qa-variant-item"][data-step-id="${stepId}"]`).click();
  await expect(
    page.locator(`[data-slot="qa-variant-review"][data-step-id="${stepId}"]`),
  ).toBeVisible({ timeout: 15_000 });
}

/** Aprueba la variante de `stepId` (directo, sin confirmación) y espera a que salga del sidebar. */
async function approveVariant(page: Page, stepId: string): Promise<void> {
  await selectVariant(page, stepId);
  await page.locator('[data-slot="approve-variant"]').click();
  await expect(page.locator(`[data-slot="qa-variant-item"][data-step-id="${stepId}"]`)).toHaveCount(
    0,
    { timeout: 15_000 },
  );
}

/** Rechaza la variante de `stepId` (AlertDialog: el botón abre el diálogo, el confirm resuelve) y
 *  espera a que salga del sidebar (el step deja `waiting_approval` por SSE). */
async function rejectVariant(page: Page, stepId: string): Promise<void> {
  await selectVariant(page, stepId);
  await page.locator('[data-slot="reject-variant"]').click();
  await page.locator('[data-slot="confirm-reject"]').click();
  await expect(page.locator(`[data-slot="qa-variant-item"][data-step-id="${stepId}"]`)).toHaveCount(
    0,
    { timeout: 15_000 },
  );
}

test.describe('CP4 · revisión de variantes (T5.6)', () => {
  test(
    'lista las 3 variantes pausadas, muestra player + overlays de safe zones + resultados de QA',
    { tag: ['@f5', '@checkpoint'] },
    async ({ page }) => {
      const run = await seedCp4Run();
      await page.goto(`/runs/${run.runId}`);

      // El panel de CP4 abre (el store se pobla por SSE desde el snapshot del run).
      await expect(panel(page)).toBeVisible({ timeout: 30_000 });

      // MUST-CARRY: las TRES variantes pausadas aparecen en el sidebar (no una).
      await expect(variantItems(page)).toHaveCount(3, { timeout: 15_000 });

      // El detalle de la primera variante carga: título + código legible.
      const review = page.locator('[data-slot="qa-variant-review"]');
      await expect(review).toBeVisible({ timeout: 15_000 });

      // PLAYER: el <video> apunta al máster de la variante por el endpoint de descarga.
      const video = page.locator('[data-slot="qa-video"]');
      await expect(video).toHaveAttribute('src', /\/api\/assets\/[0-9A-Za-z]+\/download/);

      // OVERLAYS DE SAFE ZONES: el conmutador (Tabs) cambia el preset del frame TRANSPARENTE sobre el
      // vídeo. Por defecto `universal`; al pulsar TikTok/Meta/Sin overlay cambia el `data-preset`.
      const frame = page.locator('[data-slot="qa-safe-zone"]');
      await expect(frame).toHaveAttribute('data-preset', 'universal');
      await page.getByRole('tab', { name: 'TikTok' }).click();
      await expect(frame).toHaveAttribute('data-preset', 'tiktok');
      await page.getByRole('tab', { name: 'Meta' }).click();
      await expect(frame).toHaveAttribute('data-preset', 'meta');
      await page.getByRole('tab', { name: /sin overlay/i }).click();
      await expect(frame).toHaveAttribute('data-preset', 'off');

      // RESULTADOS DE QA: los 8 checks se pintan, cada uno con su veredicto pass/fail.
      await expect(page.locator('[data-slot="qa-check"]')).toHaveCount(8);
      // El veredicto global de la primera variante (passed=true) es «Apto».
      await expect(page.locator('[data-slot="qa-verdict"]')).toHaveText(/apto/i);
    },
  );

  test(
    'aprobar 2 variantes y rechazar 1 desde el navegador actualiza `ad_variant.status` (cada una por separado)',
    { tag: ['@f5', '@checkpoint'] },
    async ({ page }) => {
      const run = await seedCp4Run();
      await page.goto(`/runs/${run.runId}`);
      await expect(panel(page)).toBeVisible({ timeout: 30_000 });
      await expect(variantItems(page)).toHaveCount(3, { timeout: 15_000 });

      // Antes: las 3 en `planned` (createBatchWithVariants no las mueve).
      for (const v of run.variants) {
        expect(await variantStatus(v.id)).toBe('planned');
      }

      // La Verificación pide EXACTAMENTE aprobar 2 + rechazar 1. Las 3 variantes se sembraron con
      // `filename_code` estable: se resuelven por NOMBRE, cada una de forma INDEPENDIENTE (el
      // must-carry de CP4). La rechazada es la última sembrada (la de `passed=false`); las otras dos
      // se aprueban.
      const [approve1, approve2, toReject] = run.variants;

      await rejectVariant(page, toReject!.stepId);
      await approveVariant(page, approve1!.stepId);
      await approveVariant(page, approve2!.stepId);

      // El sidebar quedó vacío: las 3 se resolvieron (cada una salió al dejar `waiting_approval`).
      await expect(variantItems(page)).toHaveCount(0, { timeout: 15_000 });

      // ── LA CLÁUSULA, CONTRA LA BD: 2 approved + 1 rejected, cada una la suya ──────────────
      await expect(async () => {
        expect(await variantStatus(approve1!.id)).toBe('approved');
      }).toPass({ timeout: 10_000 });
      await expect(async () => {
        expect(await variantStatus(approve2!.id)).toBe('approved');
      }).toPass({ timeout: 10_000 });
      await expect(async () => {
        expect(await variantStatus(toReject!.id)).toBe('rejected');
      }).toPass({ timeout: 10_000 });
    },
  );
});
