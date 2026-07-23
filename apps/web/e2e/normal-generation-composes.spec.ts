// REGRESIÓN PERMANENTE de T5.8b · EL FLUJO NORMAL COMPONE MÁSTER + PAUSA EN CP4 (F5, e2e.md §9, DoD
// BLOQUEANTE). Ejercita el flujo NORMAL de generación —aprobar un lote en CP3 (SIN regen)— contra el
// sistema real (web + worker + orquestador + pg-boss + SSE + la op de servidor + BD), con providers FAKE
// ($0 SIEMPRE — el único gasto real es la Verificación 22.4/live del verifier con fal REAL).
//
// EL GAP QUE CIERRA (T5.8b, destapado por T5.8): antes, `approveScriptsForStep` (el efecto de CP3-approve)
// arrancaba un run de generación que EMITÍA SOLO N6→N7 — se cortaba en N7, SIN máster, SIN C2PA, SIN CP4.
// El wiring N8/N9 (T5.5b/c/d) solo se había ejercido con planes de test hechos a mano y con la op de REGEN
// (T5.8). El flujo NORMAL quedó sin dueño de su composición. T5.8b lo cierra: CP3-approve ahora añade la
// cola de composición vía `withComposition` (@ugc/core/orchestrator), el ÚNICO dueño (regen la comparte).
//
// LO QUE MUERDE (control anti-trivial): este spec afirma que un lote aprobado en CP3 (flujo normal, SIN
// regen) llega a COMPONER un máster (N8 persiste `master_asset_id` vía `finalizeVariantMaster`) y PAUSA en
// CP4 (N9 en `waiting_approval`). Antes de T5.8b, N8 y N9 NO existían en el run del flujo normal → este
// spec se pondría ROJO (el run se corta en N7). Es la contra-cara exacta de la conservación-N7 que
// `partial-regeneration.spec.ts` observa sobre el ORIGEN: aquí se prueba que la COLA de composición del
// flujo normal existe y llega a máster+CP4, sin que el verifier lo descubra gastando fal (principio 9).
//
// SE ASSERTA SOBRE N8 (máster) Y N9 (`waiting_approval`), NO sobre el veredicto de QA de N9: sobre media
// sintética (clip fake de ~2s, ASR fake) el `qa_report` puede fallar `av_duration_diff`/`loudness` — eso
// enmascararía el éxito real de la composición. Lo load-bearing de T5.8b es que la cola LLEGA a máster y
// PAUSA en CP4; el veredicto de QA REAL lo mide el verifier con fal REAL (§9.7). El clon-de-CP4 pausado que
// este spec deja es EXACTAMENTE el fixture premium que el verify de T5.8 regenerará (cache HITs).
//
// POR QUÉ SE ARRANCA VÍA EL APPROVE DE CP3 (y NO con `createRun` en-proceso): igual que
// `partial-regeneration.spec.ts` — el loader ESM de Playwright no carga `@ugc/services` (arrastra JSON sin
// `type` attribute), y la disciplina e2e es sembrar por repos de `@ugc/db` + conducir por HTTP + sondear la
// BD. Así el ORIGEN se arranca como en PRODUCCIÓN: se siembra un step N5 pausado y se hace
// `POST /api/steps/:id/approve` con la decisión de guiones → el SERVIDOR (que sí tiene `@ugc/services`)
// construye el plan CON su cola de composición (T5.8b) y arranca el run N6→N7→N8→N9.
import { expect, test, type APIRequestContext } from '@playwright/test';
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
import { queryStack, stackDatabaseUrl, assetsDir } from './support/stack-db';
import { apiCall } from './support/http';

const stackDb = createDb(stackDatabaseUrl);

// El brief beauty (la ÚNICA vertical con template + guard pack sembrados): sin él N6 no casaría template.
const BRIEF = FAKE_BRIEF_BEAUTY;

// Persona premium COMPLETA que casa con el hint beauty (misma que F4/regen): imagen de referencia (N7c la
// exige) + voiceMap es (N7b la exige). Sin ella la generación del servidor lanzaría money-safe.
const MATCHING_PERSONA: PersonaSeed = {
  name: 'Nora Normal Premium',
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
  // Blindaje: el hint beauty debe casar con una persona que tenga imagen (N7c la exige).
  const personas = await listPersonas(stackDb);
  const candidates = matchPersonas(personas, FAKE_BEAUTY_AVATAR_HINT);
  expect(candidates.length, 'el hint beauty debe casar con al menos una persona').toBeGreaterThan(
    0,
  );
  expect(
    (candidates[0]?.persona.referenceImageIds.length ?? 0) > 0,
    'el top-1 debe traer imagen de referencia (N7c avatar la exige)',
  ).toBe(true);
});

test.describe('T5.8b · el flujo normal (CP3-approve) compone máster y pausa en CP4', () => {
  test(
    'un lote aprobado en CP3 arranca un run que compone máster (N8) y pausa en CP4 (N9 waiting_approval)',
    { tag: ['@f5', '@compose'] },
    async ({ page }) => {
      test.setTimeout(240_000);

      // ── 1. SEMBRAR proyecto + análisis + brief + lote PREMIUM + variante con su guion v1 ──────────────
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
      // El plan REAL del lote se compuso con `batchDiscriminator = batchId` (filenameCodes definitivos):
      // se recompone con el mismo id para casar `sharedBodyKey`.
      const finalPlan = planBatch({ ...args, batchDiscriminator: created.batch.id }).plan;
      const plannedVariant = finalPlan.variants.find(
        (v) => v.filenameCode === variant.filenameCode,
      )!;
      // El guion v1 (coherente con el plan real → N6 casa template). El servidor lo re-linteará al aprobar.
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

      // ── 2. ARRANCAR LA GENERACIÓN VÍA EL APPROVE DE CP3 (el SERVIDOR construye el plan CON su cola N8/N9) ─
      // Se siembra un step N5 pausado y se hace `POST /api/steps/:id/approve` con la decisión de guiones. El
      // servidor construye el plan de generación —AHORA con la cola de composición (T5.8b)— y arranca el run
      // N6→N7→N8→N9 en la tx del checkpoint. Su `nextRunId` es el run del flujo normal.
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
        decision: {
          kind: 'scripts',
          verdicts: [{ variantId: variant.id, approved: true }],
        },
      });
      const maybeRunId = (approveRes as { nextRunId?: string }).nextRunId;
      expect(
        maybeRunId,
        'aprobar CP3 debe arrancar el run de generación del flujo normal',
      ).toBeTruthy();
      const runId = maybeRunId!;

      // ── 3. EL RUN EMITE LA COLA DE COMPOSICIÓN (control estructural de T5.8b) ──────────────────────────
      // El plan del flujo normal DEBE incluir N8 (composición) y N9 (CP4): antes de T5.8b se cortaba en N7.
      const nodeKeys = await runNodeKeys(runId);
      expect(nodeKeys, 'el flujo normal debe emitir N8 (composición del máster)').toContain('N8');
      expect(nodeKeys, 'el flujo normal debe emitir N9 (checkpoint CP4)').toContain('N9');

      // ── 4. LA CADENA CORRE HASTA COMPONER EL MÁSTER (N8 succeeded) ─────────────────────────────────────
      // Los N7 del stack pueden caer en el doom de imagen del fake (primer submit de N7a) → se recuperan con
      // el retry granular, patrón F4/regen. Una vez todos los N7 succeeded, N8 compone (ffmpeg REAL, $0).
      const videoNodes = ['N7a', 'N7b', 'N7c', 'N7d', 'N7f'];
      await waitN7Succeeded(runId, videoNodes, 180_000, async (stepId) => {
        await postJson(page.request, `/api/steps/${stepId}/retry`, {});
      });
      await waitStepSucceeded(runId, 'N8', 120_000);

      // N8 persistió un máster nuevo en la variante (vía `finalizeVariantMaster`): master_asset_id no-null.
      // Es la CLÁUSULA TITULAR de T5.8b (el flujo normal COMPONE), la que antes NO ocurría (corte en N7).
      const masterRows = await queryStack<{ master_asset_id: string | null }>(
        `SELECT master_asset_id FROM ad_variant WHERE id = $1`,
        [variant.id],
      );
      expect(
        masterRows[0]?.master_asset_id,
        'el flujo normal debe COMPONER un máster: master_asset_id de la variante no-null',
      ).toBeTruthy();

      // ── 5. EL RUN PAUSA EN CP4 (N9 waiting_approval) ───────────────────────────────────────────────────
      // N9 es un checkpoint `alwaysPause`: el run del flujo normal deja de ser autopilot y ESPERA el juicio
      // humano de CP4. Es lo que antes NO pasaba (el run moría en N7 sin llegar a un checkpoint de QA). El
      // clon-de-CP4 pausado que esto deja es el fixture premium que el verify de T5.8 regenerará.
      await waitStepStatus(runId, 'N9', 'waiting_approval', 60_000);

      // El panel de CP4 renderiza en la UI (la variante llega a QA pausada, no se cortó en N7).
      await page.goto(`/runs/${runId}`);
      await expect(page.locator('[data-slot="qa-panel"]')).toBeVisible({ timeout: 30_000 });
    },
  );
});

/** El conjunto de `node_key` DISTINTOS de un run (para afirmar que la cola N8/N9 se emitió). */
async function runNodeKeys(runId: string): Promise<Set<string>> {
  const rows = await queryStack<{ node_key: string }>(
    `SELECT DISTINCT node_key FROM step_run WHERE run_id = $1`,
    [runId],
  );
  return new Set(rows.map((r) => r.node_key));
}

/** Espera hasta que TODOS los N7 de vídeo/voz del run estén `succeeded`, recuperando el doom del fake (primer
 *  submit de imagen → `failed`) con el retry granular (patrón F4/regen). Sin `retry` cableado, un `failed` es
 *  un fallo real. */
async function waitN7Succeeded(
  runId: string,
  nodeKeys: string[],
  timeoutMs: number,
  retry: (stepId: string) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const retried = new Set<string>();
  while (Date.now() < deadline) {
    const rows = await queryStack<{ id: string; node_key: string; status: string }>(
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
      throw new Error(
        `waitN7Succeeded: un N7 del run ${runId} falló irrecuperable: ${f.node_key}=${f.status} (${f.id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const finalRows = await queryStack<{ node_key: string; status: string }>(
    `SELECT node_key, status FROM step_run WHERE run_id = $1 ORDER BY node_key`,
    [runId],
  );
  throw new Error(
    `waitN7Succeeded: timeout esperando N7 succeeded del run ${runId}. Estados: ${finalRows
      .map((r) => `${r.node_key}=${r.status}`)
      .join(', ')}`,
  );
}

/** Espera hasta que el paso `nodeKey` del run esté `succeeded` (para N8, la composición del máster). Un
 *  `failed`/`rejected` es un fallo real (el doom del fake ya se gastó en los N7). */
async function waitStepSucceeded(runId: string, nodeKey: string, timeoutMs: number): Promise<void> {
  await waitStepStatus(
    runId,
    nodeKey,
    'succeeded',
    timeoutMs,
    (s) => s === 'failed' || s === 'rejected',
  );
}

/** Sondea la BD hasta que el paso `nodeKey` del run alcanza `wanted`. Si `isFatal(status)` es cierto antes,
 *  lanza (un estado terminal distinto del esperado es un fallo real, no un flip transitorio). */
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
      throw new Error(
        `waitStepStatus: ${nodeKey} del run ${runId} terminó en ${status} (esperaba ${wanted})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const finalRows = await queryStack<{ node_key: string; status: string }>(
    `SELECT node_key, status FROM step_run WHERE run_id = $1 ORDER BY node_key`,
    [runId],
  );
  throw new Error(
    `waitStepStatus: timeout esperando ${nodeKey}=${wanted} del run ${runId}. Estados: ${finalRows
      .map((r) => `${r.node_key}=${r.status}`)
      .join(', ')}`,
  );
}

/** POST JSON autenticado (la `page.request` lleva el storageState del login). Lanza si no es 2xx. Envuelto
 *  en `apiCall` (T1.19): el `next dev` local cierra sockets keep-alive ociosos y el `request` de Playwright
 *  los reusa → un POST de seed/retry puede morir con ECONNRESET ANTES de tocar la app. `apiCall` reintenta
 *  SOLO ese corte de transporte (nunca un 4xx/5xx, que llega intacto al guard de abajo). */
async function postJson(request: APIRequestContext, path: string, body: unknown): Promise<unknown> {
  const res = await apiCall(() => request.post(path, { data: body }), `POST ${path}`);
  if (!res.ok()) {
    throw new Error(`POST ${path} → ${String(res.status())}: ${await res.text()}`);
  }
  return res.json();
}

/** Un `AdScript` mínimo COHERENTE con la variante planificada (filenameCode + sharedBodyKey del plan real),
 *  con escena `cta` al final. El texto es beauty-safe (sin claims de salud → sin flag bloqueante). */
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
      {
        t: 0,
        seconds: 2,
        segment: 'hook',
        narration: 'Descubre tu mejor piel.',
        visual: 'primer plano del rostro',
        camera: 'estático',
        emotion: 'confianza',
      },
      {
        t: 2,
        seconds: 4,
        segment: 'body',
        narration: 'Hidratación profunda cada día.',
        visual: 'aplicando el sérum',
        camera: 'plano medio',
        emotion: 'calma',
      },
      {
        t: 6,
        seconds: 2,
        segment: 'cta',
        narration: 'Míralo en la web.',
        visual: 'packshot del producto',
        camera: 'estático',
        emotion: 'entusiasmo',
      },
    ],
    subtitles: [{ start: 0, end: 2, text: 'Descubre tu mejor piel.' }],
    fullText: 'Descubre tu mejor piel. Hidratación profunda cada día. Míralo en la web.',
    wordCount: 12,
    estSeconds: 8,
    tone: 'cercano',
    language: 'es',
  };
}
