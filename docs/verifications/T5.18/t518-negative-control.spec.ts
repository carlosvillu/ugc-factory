// CONTROL NEGATIVO T5.18 — con el fix DESACTIVADO (cancelRun barre TODO no-terminal),
// tras el mismo fallo parcial + cancel: N8 (y el failed N7a, y N7d/N7f/N9) quedan
// `cancelled` (terminal), y el retry de N7a devuelve 409 invalid_transition → NO hay
// camino al máster. Es la contra-cara EXACTA del PASS: el journey se corta en el cancel.
//
// Se detiene tras cancel+retry (no compone): el objetivo es ver el corte, no un máster.
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
  name: 'Nora T518 NegCtrl',
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
  expect(candidates.length).toBeGreaterThan(0);
});

test.describe('T5.18 · CONTROL NEGATIVO (fix desactivado)', () => {
  test('cancel barre N8 a cancelled y el retry de N7a da 409 → sin camino al máster', async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto('/login');
    await page.getByLabel(/contraseña/i).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).toHaveURL('/');

    const [p] = await stackDb.insert(projectTable).values(makeProject()).returning();
    const projectId = p!.id;
    const [ua] = await stackDb.insert(urlAnalysisTable).values(makeUrlAnalysis({ projectId })).returning();
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

    const n5RunId = newUlid();
    await queryStack(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [n5RunId, projectId]);
    const n5StepId = newUlid();
    const n5Out: N5Output = {
      batchId: created.batch.id,
      scriptRefs: [
        { variantId: variant.id, scriptId: createdScripts[0]!.id, filenameCode: variant.filenameCode, blocked: false },
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
    expect(runId).toBeTruthy();

    // Esperar la forma del fallo parcial (N7a failed, N7d/N7f/N8/N9 awaiting_deps).
    await waitForPartialFailureShape(runId, 180_000);

    // CANCEL (con el fix desactivado: barre TODO).
    const cancelRes = (await postJson(page.request, `/api/runs/${runId}/cancel`, {})) as {
      ok: boolean;
      cancelled: number;
    };
    const after = await dumpSteps(runId);
    writeFileSync(
      `${EVIDENCE_DIR}/NEG-01-states-after-cancel.txt`,
      `cancel → ${JSON.stringify(cancelRes)}\n\n${after.text}`,
    );

    // BAJO EL BUG: N8 (y N7a, N7d, N7f, N9) quedan cancelled.
    expect(after.byNode.N8, 'CONTROL NEGATIVO: N8 debe quedar cancelled (camino al máster roto)').toBe(
      'cancelled',
    );
    expect(after.byNode.N7a, 'CONTROL NEGATIVO: N7a debe quedar cancelled').toBe('cancelled');

    // Y el retry de N7a (ya cancelled) devuelve 409.
    const n7aId = after.idByNode.N7a!;
    const retryRes = await apiCall(
      () => page.request.post(`/api/steps/${n7aId}/retry`, { data: '' }),
      'POST retry N7a (neg)',
    );
    writeFileSync(
      `${EVIDENCE_DIR}/NEG-02-retry-response.txt`,
      `POST /api/steps/${n7aId}/retry → HTTP ${String(retryRes.status())}: ${await retryRes.text()}\n` +
        `(CONTROL NEGATIVO: debe ser 409 invalid_transition — cancelled es terminal sin arista de retry)\n`,
    );
    expect(retryRes.status(), 'CONTROL NEGATIVO: el retry sobre cancelled debe dar 409').toBe(409);
  });
});

interface StepRow {
  id: string;
  node_key: string;
  status: string;
}
async function dumpSteps(runId: string): Promise<{ rows: StepRow[]; text: string; byNode: Record<string, string>; idByNode: Record<string, string> }> {
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
  const text = `run ${runId}:\n` + rows.map((r) => `  ${r.node_key.padEnd(4)} ${r.status.padEnd(16)} ${r.id}`).join('\n') + '\n';
  return { rows, text, byNode, idByNode };
}
async function waitForPartialFailureShape(runId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const want: Record<string, string> = {
    N7a: 'failed', N7b: 'succeeded', N7c: 'succeeded', N7e: 'succeeded',
    N7d: 'awaiting_deps', N7f: 'awaiting_deps', N8: 'awaiting_deps', N9: 'awaiting_deps',
  };
  while (Date.now() < deadline) {
    const { byNode } = await dumpSteps(runId);
    if (Object.entries(want).every(([k, v]) => byNode[k] === v)) return;
    if (byNode.N7a === 'succeeded' || byNode.N7a === 'cancelled') {
      throw new Error(`N7a llegó a ${byNode.N7a} (esperaba failed). Estados: ${JSON.stringify(byNode)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { text } = await dumpSteps(runId);
  throw new Error(`waitForPartialFailureShape timeout:\n${text}`);
}
async function postJson(request: APIRequestContext, path: string, body: unknown): Promise<unknown> {
  const res = await apiCall(() => request.post(path, { data: body }), `POST ${path}`);
  if (!res.ok()) throw new Error(`POST ${path} → ${String(res.status())}: ${await res.text()}`);
  return res.json();
}
function scriptForPlanned(filenameCode: string, sharedBodyKey: string): import('@ugc/core/contracts').AdScript {
  return {
    filenameCode, sharedBodyKey, hook: 'Descubre tu mejor piel.', cta: 'Míralo en la web.',
    scenes: [
      { t: 0, seconds: 2, segment: 'hook', narration: 'Descubre tu mejor piel.', visual: 'primer plano del rostro', camera: 'estático', emotion: 'confianza' },
      { t: 2, seconds: 4, segment: 'body', narration: 'Hidratación profunda cada día.', visual: 'aplicando el sérum', camera: 'plano medio', emotion: 'calma' },
      { t: 6, seconds: 2, segment: 'cta', narration: 'Míralo en la web.', visual: 'packshot del producto', camera: 'estático', emotion: 'entusiasmo' },
    ],
    subtitles: [{ start: 0, end: 2, text: 'Descubre tu mejor piel.' }],
    fullText: 'Descubre tu mejor piel. Hidratación profunda cada día. Míralo en la web.',
    wordCount: 12, estSeconds: 8, tone: 'cercano', language: 'es',
  };
}
