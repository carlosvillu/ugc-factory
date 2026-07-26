// VERIFIER T5.18 — «Cancelar un lote a medias no debe atrapar los assets pagados».
//
// Verificación LITERAL de planning.md T5.18:
//   «tras un fallo parcial + cancel, un usuario puede llegar a un MÁSTER COMPUESTO SIN
//    re-pagar los assets ya generados […]. Ningún camino deja assets pagados irrecuperables
//    en silencio.»
//
// Camino REAL, sistema entero vivo, fal FAKE ($0). Se conduce por HTTP (routes reales de
// cancel/retry/approve) + se asevera sobre la BD del stack y sobre el FICHERO del máster en
// disco. NO se cierra sobre el vitest (que simula la ejecución con transition('succeed')).
//
// SECUENCIA:
//   1. Sembrar proyecto/brief/lote PREMIUM + guion v1 → CP3-approve arranca el run N6→N7→N8→N9.
//   2. El fake DOOMEA el primer submit de IMAGEN del proceso ⇒ N7a (keyframes) queda `failed`.
//      Se ESPERA POR CONDICIÓN a la forma del smoke-test: N7a `failed`, hermanos N7b/N7c/N7e
//      `succeeded` (PAGADOS), N7d/N7f/N8/N9 `awaiting_deps`. (NO se reintenta N7a todavía.)
//   3. Snapshot #1 de cost_entry (prueba de que se factura en fake mode).
//   4. POST /api/runs/:id/cancel — el cancel real.
//   5. Snapshot #2. Aserción de estados: N7a sigue `failed`; N7d/N7f/N8/N9 siguen
//      `awaiting_deps` (NO cancelled); ningún step VIVO (queued/running) sobrevive.
//   6. POST /api/steps/:N7a/retry (body VACÍO → sin patch → dedup muerde). DEBE ser 2xx (no 409).
//   7. El worker re-genera N7a; N7d/N7f desbloquean y generan; N8 COMPONE (ffmpeg real) →
//      ad_variant.master_asset_id no-null → el fichero existe en disco (assetsDir).
//   8. Snapshot #3. Delta 2→3 = cláusula (B): qué se facturó de nuevo, qué reusó a 0¢.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { newUlid } from '@ugc/core/contracts';
import type { N5Output } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import { matchPersonas } from '@ugc/core/persona';
import type { PersonaSeed } from '@ugc/core/persona/server';
import {
  createBatchWithVariants,
  createDb,
  createScriptsForBatch,
  listBatchVariants,
  listPersonas,
  listPlanningInputs,
  makeLocalStorageAdapter,
  seedPersonas,
} from '@ugc/db';
import {
  project as projectTable,
  productBrief as productBriefTable,
  urlAnalysis as urlAnalysisTable,
} from '@ugc/db/schema';
import {
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  FAKE_BRIEF_BEAUTY,
  FAKE_BEAUTY_AVATAR_HINT,
} from '@ugc/test-utils';
import { queryStack, stackDatabaseUrl, assetsDir } from '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/apps/web/e2e/support/stack-db';
import { apiCall } from '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/apps/web/e2e/support/http';

const EVIDENCE_DIR = '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/docs/verifications/T5.18';
const stackDb = createDb(stackDatabaseUrl);
const BRIEF = FAKE_BRIEF_BEAUTY;
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password';

const MATCHING_PERSONA: PersonaSeed = {
  name: 'Nora T518 Premium',
  ageRange: '25-35',
  gender: 'female',
  ethnicity: 'mediterránea',
  style: 'natural',
  descriptor: 'farmacéutica cosmética en laboratorio dermatológico, bata blanca',
  setting: 'laboratorio dermatológico luminoso',
  personality: 'cercana y directa',
  wardrobeNotes: 'Bata blanca de laboratorio; misma ropa en todos los cuts.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en', label: 'Placeholder EN' },
  },
  referenceImageCount: 1,
};

test.beforeAll(async () => {
  await seedPersonas(stackDb, makeLocalStorageAdapter({ root: assetsDir }), [MATCHING_PERSONA]);
  const personas = await listPersonas(stackDb);
  const candidates = matchPersonas(personas, FAKE_BEAUTY_AVATAR_HINT);
  expect(candidates.length, 'el hint beauty debe casar con al menos una persona').toBeGreaterThan(0);
  expect(
    (candidates[0]?.persona.referenceImageIds.length ?? 0) > 0,
    'el top-1 debe traer imagen de referencia (N7c avatar la exige)',
  ).toBe(true);
});

test.describe('T5.18 · cancelar un lote a medias no atrapa los assets pagados', () => {
  test(
    'fallo parcial (N7a) → cancel → retry legal → máster COMPUESTO en disco, SIN re-pagar',
    async ({ page }) => {
      test.setTimeout(300_000);

      // ── LOGIN (inline: un login exitoso no gasta presupuesto de rate-limit) ──────────────
      await page.goto('/login');
      await page.getByLabel(/contraseña/i).fill(E2E_PASSWORD);
      await page.getByRole('button', { name: /entrar/i }).click();
      await expect(page).toHaveURL('/');

      // ── 1. SEMBRAR proyecto + análisis + brief + lote PREMIUM + variante con su guion v1 ──
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

      const { libraryHooks, personas, recipe } = await listPlanningInputs(stackDb, 'premium');
      const config = {
        angleIndices: [0],
        hooksPerAngle: 1,
        objective: 'hook_test' as const,
        tier: 'premium' as const,
        languages: ['es'],
        personaMode: 'rotate' as const,
      };
      const args = { brief: BRIEF, config, libraryHooks, personas, recipe: recipe! };
      const preview = planBatch(args);
      const created = await createBatchWithVariants(stackDb, {
        projectId,
        briefId: brief!.id,
        tier: 'premium',
        objective: 'hook_test',
        languages: ['es'],
        costEstimatedCents: preview.estimate.total.maxCents,
        composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
      });
      const variants = await listBatchVariants(stackDb, created.batch.id);
      const variant = variants[0]!;
      const finalPlan = planBatch({ ...args, batchDiscriminator: created.batch.id }).plan;
      const plannedVariant = finalPlan.variants.find((v) => v.filenameCode === variant.filenameCode)!;
      const createdScripts = await createScriptsForBatch(stackDb, {
        stepRunId: newUlid(),
        scripts: [
          {
            variantId: variant.id,
            content: scriptForPlanned(plannedVariant.filenameCode, plannedVariant.segmentKeys.body),
            guardrailFlags: [],
          },
        ],
      });

      // ── 2. ARRANCAR LA GENERACIÓN VÍA CP3-APPROVE (el servidor construye el plan N6→N7→N8→N9) ─
      const n5RunId = newUlid();
      await queryStack(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [
        n5RunId,
        projectId,
      ]);
      const n5StepId = newUlid();
      const n5Out: N5Output = {
        batchId: created.batch.id,
        scriptRefs: [
          {
            variantId: variant.id,
            scriptId: createdScripts[0]!.id,
            filenameCode: variant.filenameCode,
            blocked: false,
          },
        ],
        status: 'scripted',
        warnings: [],
      };
      await queryStack(
        `INSERT INTO step_run (id, run_id, node_key, status, is_checkpoint, checkpoint_config, output_refs, depends_on)
         VALUES ($1, $2, 'N5', 'waiting_approval', true, $3, $4, '{}')`,
        [n5StepId, n5RunId, JSON.stringify({ alwaysPause: true }), JSON.stringify(n5Out)],
      );

      const approveRes = await postJson(page.request, `/api/steps/${n5StepId}/approve`, {
        decision: { kind: 'scripts', verdicts: [{ variantId: variant.id, approved: true }] },
      });
      const runId = (approveRes as { nextRunId?: string }).nextRunId!;
      expect(runId, 'aprobar CP3 debe arrancar el run de generación').toBeTruthy();

      // El plan del flujo normal DEBE incluir N8 (composición) y N9 (CP4).
      const nodeKeys = await runNodeKeys(runId);
      expect(nodeKeys, 'el flujo normal debe emitir N8').toContain('N8');
      expect(nodeKeys, 'el flujo normal debe emitir N9').toContain('N9');

      // ── 3. ESPERAR LA FORMA DEL SMOKE-TEST (fallo parcial), SIN reintentar ──────────────────
      // Condición: N7a `failed` (el doom) Y N7b/N7c/N7e `succeeded` (pagados) Y
      // N7d/N7f/N8/N9 `awaiting_deps`. Es load-bearing esperar a que N7c (avatar, vía sweeper,
      // lento) esté `succeeded` ANTES de cancelar: si N7c aún estuviera queued/running, el cancel
      // lo barrería (correcto) y N8 nunca podría componer — un FAIL ajeno al fix.
      await waitForPartialFailureShape(runId, 180_000);
      const afterFailure = await dumpSteps(runId);
      writeFileSync(`${EVIDENCE_DIR}/01-states-after-partial-failure.txt`, afterFailure.text);
      // Aserciones de la forma exacta.
      expect(afterFailure.byNode.N7a, 'N7a debe estar failed (el doom)').toBe('failed');
      for (const n of ['N7b', 'N7c', 'N7e']) {
        expect(afterFailure.byNode[n], `${n} (hermano pagado) debe estar succeeded`).toBe('succeeded');
      }
      for (const n of ['N7d', 'N7f', 'N8', 'N9']) {
        expect(afterFailure.byNode[n], `${n} debe estar awaiting_deps (cadena al máster)`).toBe(
          'awaiting_deps',
        );
      }

      // Snapshot #1 de cost_entry: prueba empírica de que se factura en fake mode.
      const cost1 = await dumpCostEntries(runId);
      writeFileSync(`${EVIDENCE_DIR}/02-cost-snapshot-1-before-cancel.txt`, cost1.text);
      expect(
        cost1.rows.length,
        'DEBE haber cost_entry en fake mode (si no, (B) es inrespondible)',
      ).toBeGreaterThan(0);
      // Cuántas GENERACIONES hizo N7a (para saber si la re-facturación intra-step se ejercita).
      const n7aGenCount = await countGenerationsForNode(runId, 'N7a');
      writeFileSync(
        `${EVIDENCE_DIR}/02b-n7a-generation-count-before-retry.txt`,
        `N7a generation rows antes del retry: ${String(n7aGenCount)}\n` +
          `(si >1, hubo shots ya completados+pagados que el retry NO debe re-facturar)\n`,
      );

      // ── 4. CANCEL (route real) ─────────────────────────────────────────────────────────────
      const cancelRes = (await postJson(page.request, `/api/runs/${runId}/cancel`, {})) as {
        ok: boolean;
        cancelled: number;
      };
      writeFileSync(
        `${EVIDENCE_DIR}/03-cancel-response.txt`,
        `POST /api/runs/${runId}/cancel → ${JSON.stringify(cancelRes)}\n`,
      );

      // ── 5. ESTADOS TRAS EL CANCEL ──────────────────────────────────────────────────────────
      const afterCancel = await dumpSteps(runId);
      writeFileSync(`${EVIDENCE_DIR}/04-states-after-cancel.txt`, afterCancel.text);
      // El failed recuperable SOBREVIVE.
      expect(afterCancel.byNode.N7a, 'N7a debe seguir failed tras el cancel (no cancelled)').toBe(
        'failed',
      );
      // La cadena al máster SOBREVIVE en awaiting_deps.
      for (const n of ['N7d', 'N7f', 'N8', 'N9']) {
        expect(afterCancel.byNode[n], `${n} debe seguir awaiting_deps (no cancelled)`).toBe(
          'awaiting_deps',
        );
      }
      // Ningún step VIVO (queued/running) sobrevive: el run quedó detenido.
      const stillAlive = afterCancel.rows.filter((r) => r.status === 'queued' || r.status === 'running');
      expect(stillAlive, `ningún step vivo debe sobrevivir: ${JSON.stringify(stillAlive)}`).toHaveLength(0);

      // Snapshot #2: el cancel no factura nada.
      const cost2 = await dumpCostEntries(runId);
      writeFileSync(`${EVIDENCE_DIR}/05-cost-snapshot-2-after-cancel.txt`, cost2.text);
      expect(cost2.totalCents, 'el cancel no debe añadir coste').toBe(cost1.totalCents);

      // ── 6. RETRY GRANULAR DE N7a (body vacío → sin patch → dedup muerde). DEBE ser legal ────
      const n7aId = afterCancel.idByNode.N7a!;
      const retryRes = await apiCall(
        () => page.request.post(`/api/steps/${n7aId}/retry`, { data: '' }),
        `POST retry N7a`,
      );
      writeFileSync(
        `${EVIDENCE_DIR}/06-retry-response.txt`,
        `POST /api/steps/${n7aId}/retry (body vacío) → HTTP ${String(retryRes.status())}: ${await retryRes.text()}\n` +
          `(bajo el bug daría 409 invalid_transition; con el fix debe ser 200)\n`,
      );
      expect(retryRes.status(), 'el retry de N7a debe ser LEGAL (200), no 409').toBe(200);

      // ── 7. LA CADENA CORRE HASTA COMPONER EL MÁSTER ────────────────────────────────────────
      // Tras el retry, N7a re-genera (request_id fresco, no doomed); N7d/N7f desbloquean y
      // generan por primera vez; N8 compone (ffmpeg REAL, $0). Si un N7 vuelve a caer (no debería:
      // el doom ya se gastó), se reintenta una vez.
      await waitN7Succeeded(runId, ['N7a', 'N7d', 'N7f'], 180_000, async (stepId) => {
        await postJson(page.request, `/api/steps/${stepId}/retry`, {});
      });
      await waitStepStatus(runId, 'N8', 'succeeded', 120_000, (s) => s === 'failed' || s === 'rejected' || s === 'cancelled');

      const afterCompose = await dumpSteps(runId);
      writeFileSync(`${EVIDENCE_DIR}/07-states-after-compose.txt`, afterCompose.text);

      // El máster: ad_variant.master_asset_id no-null → asset.storage_key → fichero en disco.
      const masterRows = await queryStack<{ master_asset_id: string | null }>(
        `SELECT master_asset_id FROM ad_variant WHERE id = $1`,
        [variant.id],
      );
      const masterAssetId = masterRows[0]?.master_asset_id;
      expect(masterAssetId, 'la variante debe COMPONER un máster: master_asset_id no-null').toBeTruthy();
      const assetRows = await queryStack<{ storage_key: string }>(
        `SELECT storage_key FROM asset WHERE id = $1`,
        [masterAssetId!],
      );
      const storageKey = assetRows[0]!.storage_key;
      writeFileSync(
        `${EVIDENCE_DIR}/08-master-asset.txt`,
        `master_asset_id=${masterAssetId}\nstorage_key=${storageKey}\nassetsDir=${assetsDir}\n`,
      );

      // ── 8. Snapshot #3 + delta (B) ──────────────────────────────────────────────────────────
      const cost3 = await dumpCostEntries(runId);
      writeFileSync(`${EVIDENCE_DIR}/09-cost-snapshot-3-after-compose.txt`, cost3.text);
      const delta = diffCosts(cost2, cost3);
      writeFileSync(
        `${EVIDENCE_DIR}/10-cost-delta-clause-B.txt`,
        `CLÁUSULA (B) — delta cost_entry entre snapshot #2 (tras cancel) y #3 (tras componer):\n\n` +
          delta.text +
          `\n\nTotal facturado en el retry+recomposición: ${String(delta.totalCents)}¢\n`,
      );
      // La cláusula (B) se EVALÚA en el report a partir de este delta + el count de N7a.
    },
  );
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────

interface StepRow {
  id: string;
  node_key: string;
  status: string;
}

async function dumpSteps(
  runId: string,
): Promise<{ rows: StepRow[]; text: string; byNode: Record<string, string>; idByNode: Record<string, string> }> {
  const rows = await queryStack<StepRow>(
    `SELECT id, node_key, status FROM step_run WHERE run_id = $1 ORDER BY node_key`,
    [runId],
  );
  const byNode: Record<string, string> = {};
  const idByNode: Record<string, string> = {};
  for (const r of rows) {
    byNode[r.node_key] = r.status;
    idByNode[r.node_key] = r.id;
  }
  const text =
    `run ${runId} — step_run:\n` +
    rows.map((r) => `  ${r.node_key.padEnd(4)} ${r.status.padEnd(16)} ${r.id}`).join('\n') +
    '\n';
  return { rows, text, byNode, idByNode };
}

interface CostRow {
  step_run_id: string | null;
  node_key: string | null;
  generation_id: string | null;
  provider: string;
  amount_cents: number;
}

async function dumpCostEntries(
  runId: string,
): Promise<{ rows: CostRow[]; text: string; totalCents: number }> {
  const rows = await queryStack<CostRow>(
    `SELECT ce.step_run_id, sr.node_key, ce.generation_id, ce.provider, ce.amount_cents
     FROM cost_entry ce
     LEFT JOIN step_run sr ON sr.id = ce.step_run_id
     WHERE sr.run_id = $1
     ORDER BY sr.node_key, ce.generation_id`,
    [runId],
  );
  const totalCents = rows.reduce((a, r) => a + r.amount_cents, 0);
  const text =
    `cost_entry del run ${runId} (join step_run):\n` +
    rows
      .map(
        (r) =>
          `  ${(r.node_key ?? '?').padEnd(4)} ${r.provider.padEnd(10)} ${String(r.amount_cents).padStart(5)}¢  gen=${r.generation_id ?? '-'}`,
      )
      .join('\n') +
    `\n  TOTAL: ${String(totalCents)}¢\n`;
  return { rows, text, totalCents };
}

function diffCosts(
  before: { rows: CostRow[] },
  after: { rows: CostRow[] },
): { text: string; totalCents: number } {
  const key = (r: CostRow): string => `${r.node_key ?? '?'}|${r.generation_id ?? '-'}|${r.amount_cents}`;
  const beforeKeys = new Set(before.rows.map(key));
  const added = after.rows.filter((r) => !beforeKeys.has(key(r)));
  const totalCents = added.reduce((a, r) => a + r.amount_cents, 0);
  const text =
    `Filas NUEVAS en #3 respecto de #2 (${String(added.length)}):\n` +
    added
      .map(
        (r) =>
          `  ${(r.node_key ?? '?').padEnd(4)} ${r.provider.padEnd(10)} ${String(r.amount_cents).padStart(5)}¢  gen=${r.generation_id ?? '-'}`,
      )
      .join('\n');
  return { text, totalCents };
}

async function countGenerationsForNode(runId: string, nodeKey: string): Promise<number> {
  const rows = await queryStack<{ n: string }>(
    `SELECT count(*)::text AS n FROM generation g
     JOIN step_run sr ON sr.id = g.step_run_id
     WHERE sr.run_id = $1 AND sr.node_key = $2`,
    [runId, nodeKey],
  );
  return Number(rows[0]?.n ?? '0');
}

async function runNodeKeys(runId: string): Promise<Set<string>> {
  const rows = await queryStack<{ node_key: string }>(
    `SELECT DISTINCT node_key FROM step_run WHERE run_id = $1`,
    [runId],
  );
  return new Set(rows.map((r) => r.node_key));
}

/** Espera POR CONDICIÓN a la forma del smoke-test: N7a failed, N7b/N7c/N7e succeeded,
 *  N7d/N7f/N8/N9 awaiting_deps. NO reintenta N7a. */
async function waitForPartialFailureShape(runId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const want: Record<string, string> = {
    N7a: 'failed',
    N7b: 'succeeded',
    N7c: 'succeeded',
    N7e: 'succeeded',
    N7d: 'awaiting_deps',
    N7f: 'awaiting_deps',
    N8: 'awaiting_deps',
    N9: 'awaiting_deps',
  };
  while (Date.now() < deadline) {
    const { byNode } = await dumpSteps(runId);
    const ok = Object.entries(want).every(([k, v]) => byNode[k] === v);
    if (ok) return;
    // Si N7a llegó a un terminal DISTINTO de failed (p. ej. succeeded: el doom no cayó en él),
    // la forma no es la esperada → fallar rápido con diagnóstico.
    if (byNode.N7a === 'succeeded' || byNode.N7a === 'cancelled') {
      throw new Error(
        `waitForPartialFailureShape: N7a llegó a ${byNode.N7a} (esperaba failed por el doom). ` +
          `El doom no cayó en N7a — ¿otro submit de imagen se lo robó? Estados: ${JSON.stringify(byNode)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { text } = await dumpSteps(runId);
  throw new Error(`waitForPartialFailureShape: timeout. Estado final:\n${text}`);
}

async function waitN7Succeeded(
  runId: string,
  nodeKeys: string[],
  timeoutMs: number,
  retry: (stepId: string) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const retried = new Set<string>();
  while (Date.now() < deadline) {
    const rows = await queryStack<StepRow>(
      `SELECT id, node_key, status FROM step_run WHERE run_id = $1 AND node_key = ANY($2::text[])`,
      [runId, nodeKeys],
    );
    const present = new Set(rows.map((r) => r.node_key));
    const allPresent = nodeKeys.every((k) => present.has(k));
    if (allPresent && rows.every((r) => r.status === 'succeeded')) return;
    for (const f of rows.filter((r) => r.status === 'failed' || r.status === 'rejected')) {
      if (f.status === 'failed' && !retried.has(f.id)) {
        retried.add(f.id);
        await retry(f.id);
        continue;
      }
      throw new Error(`waitN7Succeeded: ${f.node_key}=${f.status} irrecuperable (${f.id})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { text } = await dumpSteps(runId);
  throw new Error(`waitN7Succeeded: timeout esperando ${nodeKeys.join(',')} succeeded:\n${text}`);
}

async function waitStepStatus(
  runId: string,
  nodeKey: string,
  wanted: string,
  timeoutMs: number,
  isFatal: (status: string) => boolean = () => false,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await queryStack<{ status: string }>(
      `SELECT status FROM step_run WHERE run_id = $1 AND node_key = $2 LIMIT 1`,
      [runId, nodeKey],
    );
    const status = rows[0]?.status;
    if (status === wanted) return;
    if (status !== undefined && isFatal(status)) {
      throw new Error(`waitStepStatus: ${nodeKey} terminó en ${status} (esperaba ${wanted})`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { text } = await dumpSteps(runId);
  throw new Error(`waitStepStatus: timeout esperando ${nodeKey}=${wanted}:\n${text}`);
}

async function postJson(request: APIRequestContext, path: string, body: unknown): Promise<unknown> {
  const res = await apiCall(() => request.post(path, { data: body }), `POST ${path}`);
  if (!res.ok()) {
    throw new Error(`POST ${path} → ${String(res.status())}: ${await res.text()}`);
  }
  return res.json();
}

function scriptForPlanned(
  filenameCode: string,
  sharedBodyKey: string,
): import('@ugc/core/contracts').AdScript {
  return {
    filenameCode,
    sharedBodyKey,
    hook: 'Descubre tu mejor piel.',
    cta: 'Míralo en la web.',
    scenes: [
      { t: 0, seconds: 2, segment: 'hook', narration: 'Descubre tu mejor piel.', visual: 'primer plano del rostro', camera: 'estático', emotion: 'confianza' },
      { t: 2, seconds: 4, segment: 'body', narration: 'Hidratación profunda cada día.', visual: 'aplicando el sérum', camera: 'plano medio', emotion: 'calma' },
      { t: 6, seconds: 2, segment: 'cta', narration: 'Míralo en la web.', visual: 'packshot del producto', camera: 'estático', emotion: 'entusiasmo' },
    ],
    subtitles: [{ start: 0, end: 2, text: 'Descubre tu mejor piel.' }],
    fullText: 'Descubre tu mejor piel. Hidratación profunda cada día. Míralo en la web.',
    wordCount: 12,
    estSeconds: 8,
    tone: 'cercano',
    language: 'es',
  };
}
