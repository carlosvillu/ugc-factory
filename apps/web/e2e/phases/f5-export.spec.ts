// E2E DE FASE — F5 · EXPORT (T5.9, criterios 22.1/22.2/22.8; e2e.md §9, regla 10 — DoD BLOQUEANTE).
// El journey COMPLETO de la fase, con el sistema entero vivo (web + worker + orquestador + pg-boss + SSE +
// los nodos reales N6→N9 + la op de servidor + BD + storage + los routes de library/bundle) y fal FINGIDO
// ($0). Es la unión de las dos mitades que hoy viven en specs separados —
// `normal-generation-composes.spec.ts` (llega hasta N9 `waiting_approval` con máster compuesto) y
// `library.spec.ts` (biblioteca + bundle sobre variantes SEMBRADAS)— cerrando la COSTURA que ninguna prueba:
// un máster COMPUESTO POR EL PIPELINE que atraviesa CP4-aprobar → `/library` → bundle íntegro.
//
//   lote PREMIUM (guion v1) → CP3-aprobar → run N6→N7→N8 (COMPONE máster + C2PA) → N9 (CP4 pausa) →
//   CP4-APROBAR desde el navegador → la variante queda `approved` → aparece en `/library` → DESCARGAR el
//   bundle → el sha256 del MP4 extraído == el `asset.checksum` del MÁSTER COMPUESTO (no un checksum sembrado).
//
// QUÉ AFIRMA (las cláusulas de la Entrega de T5.9 observables con fal FAKE):
//   · un lote aprobado en CP3 (flujo normal) COMPONE un máster (N8 → `master_asset_id`) y pausa en CP4 (N9);
//   · CP4-aprobar desde la UI (el panel de QA de T5.6) transiciona la variante a `approved`;
//   · esa variante APROBADA aparece en `/library` y su bundle descarga un ZIP cuyo MP4 tiene el checksum del
//     MÁSTER COMPUESTO por el pipeline (íntegro, no re-encodeado en la request) + el header lo espeja;
//   · `synthetic_product=true` en la `generation` de N7a de la variante aprobada (cláusula (b), ver abajo).
//
// LO QUE NO ESTÁ AQUÍ (lo mide el verifier con fal REAL, §9.7/cua): el coste <$15 y el tiempo <45 min del
// lote de 12 variantes, la corrección de las captions karaoke, la firma C2PA real, y la naturalidad nativa de
// las voces es/en (criterio 22.8, juicio humano). Sobre media sintética (clip fake ~2s, ASR fake) el
// `qa_report` puede fallar loudness/duración — por eso NO se asserta el veredicto de QA, solo que la cola LLEGA
// a máster+CP4 y que CP4-aprobar promueve la variante (paridad con `normal-generation-composes`).
//
// TIER PREMIUM a propósito (Reconciliación de tier de T5.9, regla 6): es el ÚNICO generation-ready — test/
// standard dejan `broll` como etiqueta no resoluble y `buildVariantGenerationPlan` lanza `PermanentStepError`
// ANTES de gastar (build-variant-generation-plan.ts §13.1). Un lote no-premium REVIENTA en plan-build aunque
// los providers sean fake, así que el journey de generación debe ser premium.
//
// CLÁUSULA (b) · TEXTO LIBRE SIN IMÁGENES → PACKSHOT SINTÉTICO. Se cubre en DOS asserts, a lo largo de la
// costura que el código realmente tiene (no una cadena que el mundo mockeado no permite):
//   (b1) la DECISIÓN packshot-IA en CP1: un intake por TEXTO LIBRE sin imágenes → brief sin hero → CP1 pide
//        imágenes → el usuario elige «Generar packshot con IA» → aprobar. Se asserta que la decisión persistida
//        es `ai_packshot`. Se DETIENE en CP1: el brief manual del fake es vertical `skincare` (default de
//        `makeBrief`), que NINGÚN template de galería lista → N6 no casaría y el sub-DAG N7 fallaría en el
//        compilador; empujarlo a generación es imposible en el mundo mockeado (ver informe).
//   (b2) `synthetic_product=true` en una variante APROBADA: se lee de la `generation` de N7a de la variante
//        aprobada del journey principal. Es HONESTO — `n7aConfig.route` está HARDCODEADO a `ai_packshot`
//        (build-variant-generation-plan.ts:106, deuda anotada: «la ruta real la decidiría CP1»), así que
//        CUALQUIER run premium marca `synthetic_product=true`. El vínculo real 0-imágenes→ruta NO existe en
//        código todavía; NO se cablea aquí para «morder más» (sería hacer el arnés más estricto que la
//        realidad en la dirección equivocada). El vínculo encadenado real lo cubre el verifier con fal REAL.
import { createHash } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { unzipSync } from 'fflate';
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
import { briefEditor, runManualAnalysisToCp1, stepIdOf } from '../support/brief';
import { queryStack, stackDatabaseUrl, assetsDir } from '../support/stack-db';
import { apiCall } from '../support/http';

const stackDb = createDb(stackDatabaseUrl);

// El brief beauty (la ÚNICA vertical con template + guard pack sembrados): sin él N6 no casaría template.
const BRIEF = FAKE_BRIEF_BEAUTY;

// Persona premium COMPLETA que casa con el hint beauty (misma que F4/regen/normal-composes): imagen de
// referencia (N7c la exige) + voiceMap es (N7b la exige). Sin ella la generación del servidor lanzaría
// money-safe y CP3 no arrancaría el run.
const MATCHING_PERSONA: PersonaSeed = {
  name: 'Nora F5 Export',
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
  // Blindaje del matching (patrón F4): el top-1 candidato para el hint beauty debe traer imagen (N7c la
  // exige; sin ella la generación 500ea aguas abajo). No se afirma el nombre exacto (varias personas
  // placeholder pueden casar por tokens genéricos con score menor) — solo que el top-1 tiene imagen.
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

test.describe('F5 · journey de export: lote → generación → CP4 → biblioteca → bundle íntegro', () => {
  test(
    'un lote premium compone máster, se aprueba en CP4, aparece en /library y su bundle tiene el checksum del máster compuesto',
    { tag: ['@f5', '@phase'] },
    async ({ page }) => {
      test.setTimeout(300_000);

      // ── 1. SEMBRAR proyecto + análisis + brief + lote PREMIUM + variante con su guion v1 ──────────────
      // Se siembra el ORIGEN en reposo (como `normal-generation-composes`): recorrer URL→CP1→CP2→CP3 por la
      // UI ya lo prueban f2/f4; aquí la costura NUEVA es CP4→biblioteca→bundle sobre un máster COMPUESTO.
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
      // El plan REAL del lote se compuso con `batchDiscriminator = batchId`: se recompone con el mismo id
      // para casar `sharedBodyKey`/`filenameCode`.
      const finalPlan = planBatch({ ...args, batchDiscriminator: created.batch.id }).plan;
      const plannedVariant = finalPlan.variants.find(
        (v) => v.filenameCode === variant.filenameCode,
      )!;
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
      // servidor construye el plan de generación (con la cola de composición T5.8b) y arranca el run
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
      const runId = (approveRes as { nextRunId?: string }).nextRunId;
      expect(runId, 'aprobar CP3 debe arrancar el run de generación del flujo normal').toBeTruthy();
      const generationRunId = runId!;

      // ── 3. LA CADENA CORRE HASTA COMPONER EL MÁSTER (N8 succeeded) Y PAUSAR EN CP4 (N9) ────────────────
      // Los N7 del stack pueden caer en el doom de imagen del fake (primer submit de N7a del PROCESO) → se
      // recuperan con el retry granular (patrón F4/regen/normal-composes). Este spec NO es el dueño del doom
      // (f4 lo es): su proyecto propio depende de `chromium`, así que f4 ya lo reclamó y los submits de aquí
      // reciben request_ids frescos — pero se cablea el retry por robustez (si algún submit cae, se recupera).
      const videoNodes = ['N7a', 'N7b', 'N7c', 'N7d', 'N7f'];
      await waitN7Succeeded(generationRunId, videoNodes, 240_000, async (stepId) => {
        await postJson(page.request, `/api/steps/${stepId}/retry`, {});
      });
      await waitStepSucceeded(generationRunId, 'N8', 120_000);

      // N8 persistió un máster nuevo en la variante (vía `finalizeVariantMaster`): master_asset_id no-null.
      const masterId = await variantMasterAssetId(variant.id);
      expect(
        masterId,
        'N8 debe COMPONER un máster: master_asset_id de la variante no-null',
      ).toBeTruthy();

      // El run pausa en CP4 (N9 `waiting_approval`): deja de ser autopilot y espera el juicio humano.
      await waitStepStatus(generationRunId, 'N9', 'waiting_approval', 60_000);
      // Localizar el step N9 de la variante (el panel de CP4 lo dirige por step-id, T5.6).
      const n9StepId = await n9StepIdOf(generationRunId, variant.id);
      expect(n9StepId, 'debe existir un N9 pausado para la variante').not.toBe('');

      // ── 4. CP4-APROBAR desde el navegador (el panel de QA de T5.6) → la variante queda `approved` ──────
      await page.goto(`/runs/${generationRunId}`);
      await expect(page.locator('[data-slot="qa-panel"]')).toBeVisible({ timeout: 30_000 });
      // Antes de aprobar, la variante no está `approved` (N8 no la mueve a approved; CP4 lo hace).
      expect(await variantStatus(variant.id)).not.toBe('approved');

      // Seleccionar la variante en el sidebar por su step-id y aprobar (mismo gesto que `variant-review`).
      await page.locator(`[data-slot="qa-variant-item"][data-step-id="${n9StepId}"]`).click();
      await expect(
        page.locator(`[data-slot="qa-variant-review"][data-step-id="${n9StepId}"]`),
      ).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-slot="approve-variant"]').click();
      // La variante sale del sidebar (dejó `waiting_approval` por SSE) y su fila queda `approved` en BD.
      await expect(
        page.locator(`[data-slot="qa-variant-item"][data-step-id="${n9StepId}"]`),
      ).toHaveCount(0, { timeout: 15_000 });
      await expect(async () => {
        expect(await variantStatus(variant.id)).toBe('approved');
      }).toPass({ timeout: 15_000 });

      // ── 6. LA VARIANTE APROBADA APARECE EN /library ────────────────────────────────────────────────────
      await page.goto('/library');
      await expect(page.locator('[data-slot="library-browser"]')).toBeVisible({ timeout: 15_000 });
      const item = page.locator(
        `[data-slot="library-variant-item"][data-variant-id="${variant.id}"]`,
      );
      await expect(item, 'la variante aprobada del pipeline debe listarse en /library').toBeVisible(
        {
          timeout: 15_000,
        },
      );

      // ── 7. DESCARGAR EL BUNDLE → el MP4 extraído tiene el checksum del MÁSTER COMPUESTO por el pipeline ──
      // El checksum NO se hardcodea: se lee de la fila `asset` del máster que N8 compuso (ffmpeg REAL sobre
      // media fake → bytes no conocidos a priori). El bundle debe empaquetar ESE máster íntegro.
      const masterChecksum = await assetChecksum(masterId!);
      expect(
        masterChecksum,
        'el máster compuesto debe tener checksum en la fila asset',
      ).toBeTruthy();

      const bundleUrl = `/api/variants/${variant.id}/bundle?audio=with_bed`;
      const res = await apiCall(() => page.request.get(bundleUrl), 'GET bundle with_bed');
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('application/zip');
      // El header espeja el checksum del PRODUCTOR real (la fila `asset` del máster).
      expect(res.headers()['x-bundle-mp4-checksum']).toBe(masterChecksum);

      const { mp4Bytes, metadata } = readBundle(new Uint8Array(await res.body()));
      // El MP4 empaquetado ES el máster compuesto → su sha256 coincide con el `asset.checksum` real.
      expect(createHash('sha256').update(mp4Bytes).digest('hex')).toBe(masterChecksum);

      // El metadata de compliance es válido (caption ≤100 sin @/#, flags AIGC, audio con bed).
      const meta = metadata as Record<string, unknown>;
      expect(String(meta.ad_caption).length).toBeLessThanOrEqual(100);
      expect(String(meta.ad_caption)).not.toContain('@');
      expect(String(meta.ad_caption)).not.toContain('#');
      expect((meta.aigc as Record<string, unknown>).aigc_disclosure).toBe(true);
      expect(meta.audio_version).toBe('with_bed');

      // ── 8. CLÁUSULA (b2): la variante APROBADA tiene su packshot SINTÉTICO (N7a synthetic_product=true) ──
      // Se lee del `output_refs` del step N7a (donde el productor lo emite ADEMÁS de en la columna
      // `generation.synthetic_product`, JUSTO para leerlo SIN join — ver generation.ts:89). Es DEDUP-PROOF: el
      // valor lo fija la ruta (`ai_packshot` hardcodeada, build-variant-generation-plan.ts:106), independiente
      // de si la `generation` se creó fresca o se REUTILIZÓ de otro spec (mismo brief beauty → mismo
      // content_hash → dedup: NO hay fila `generation` nueva para ESTE step). Es una variante REALMENTE
      // aprobada, así que satisface el literal de (b): «≥1 variante aprobada con synthetic_product=true». Va
      // AL FINAL, tras el bundle: el checksum del máster es el entregable primario y no debe quedar oculto por
      // una eventual regresión de (b2).
      const synthetic = await n7aSyntheticProduct(generationRunId, variant.id);
      expect(
        synthetic,
        'la variante aprobada debe tener un packshot sintético (N7a output_refs.syntheticProduct=true)',
      ).toBe('true');
    },
  );

  test(
    '(b1) texto libre sin imágenes → CP1 pide imágenes → «Generar packshot con IA» → la decisión persistida es ai_packshot',
    { tag: ['@f5', '@phase'] },
    async ({ page }) => {
      test.setTimeout(180_000);

      // Intake por TEXTO LIBRE sin imágenes: el brief del fake (FAKE_BRIEF_NO_IMAGES) llega sin hero → el
      // validador (perfil `manual`) emite `needs_user_decision` → CP1 renderiza la petición bloqueante.
      await runManualAnalysisToCp1(page);

      // La petición bloqueante de imágenes aparece: el `fieldset` de decisión. Hasta que se elige, «Aprobar»
      // está deshabilitado (el brief es válido pero el pipeline no puede seguir sin el frame inicial).
      const decisionFieldset = page.locator('[data-slot="image-decision"]');
      await expect(
        decisionFieldset,
        'un brief manual sin imágenes debe pedir la decisión de imágenes en CP1',
      ).toBeVisible({ timeout: 30_000 });

      // El id del step de CP1 (para leer la decisión persistida contra la BD).
      const stepId = await stepIdOf(page);

      // El usuario elige derivar a packshot-IA.
      await page.getByRole('button', { name: /generar packshot con ia/i }).click();
      await expect(page.getByRole('button', { name: /generar packshot con ia/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      // Aprobar y continuar (ahora habilitado: hay decisión).
      await briefEditor(page)
        .getByRole('button', { name: /aprobar y continuar/i })
        .click();

      // LA CLÁUSULA (b1), contra la BD: la decisión persistida del step de CP1 es `ai_packshot` (el canal
      // `checkpoint_decision`, no el artefacto — es una DECISIÓN, ver el contrato de checkpoint-decision.ts).
      await expect(async () => {
        const rows = await queryStack<{ kind: string; images: string | null }>(
          `SELECT kind, decision->>'images' AS images FROM checkpoint_decision WHERE step_run_id = $1`,
          [stepId],
        );
        expect(rows[0]?.kind).toBe('brief');
        expect(rows[0]?.images).toBe('ai_packshot');
      }).toPass({ timeout: 15_000 });
    },
  );
});

// ── HELPERS ─────────────────────────────────────────────────────────────────────────────────────────────

/** Extrae el `metadata.json` y el (único) MP4 de un ZIP de bundle. */
function readBundle(zipBytes: Uint8Array): { mp4Bytes: Uint8Array; metadata: unknown } {
  const files = unzipSync(zipBytes);
  const names = Object.keys(files);
  const mp4Name = names.find((n) => n.endsWith('.mp4'));
  const metaName = names.find((n) => n === 'metadata.json');
  if (mp4Name === undefined || metaName === undefined) {
    throw new Error(`bundle inválido: entradas ${JSON.stringify(names)}`);
  }
  return {
    mp4Bytes: files[mp4Name]!,
    metadata: JSON.parse(Buffer.from(files[metaName]!).toString('utf8')),
  };
}

/** El `master_asset_id` de una variante (o null si N8 no compuso). */
async function variantMasterAssetId(variantId: string): Promise<string | null> {
  const rows = await queryStack<{ master_asset_id: string | null }>(
    `SELECT master_asset_id FROM ad_variant WHERE id = $1`,
    [variantId],
  );
  return rows[0]?.master_asset_id ?? null;
}

/** El `status` de una variante (o `(no row)` si no existe). */
async function variantStatus(variantId: string): Promise<string> {
  const rows = await queryStack<{ status: string }>(`SELECT status FROM ad_variant WHERE id = $1`, [
    variantId,
  ]);
  return rows[0]?.status ?? '(no row)';
}

/** El `checksum` de una fila `asset`. */
async function assetChecksum(assetId: string): Promise<string> {
  const rows = await queryStack<{ checksum: string | null }>(
    `SELECT checksum FROM asset WHERE id = $1`,
    [assetId],
  );
  return rows[0]?.checksum ?? '';
}

/** El step-id del N9 (CP4) de una variante en un run (o '' si no existe). */
async function n9StepIdOf(runId: string, variantId: string): Promise<string> {
  const rows = await queryStack<{ id: string }>(
    `SELECT id FROM step_run WHERE run_id = $1 AND node_key = 'N9' AND variant_id = $2 LIMIT 1`,
    [runId, variantId],
  );
  return rows[0]?.id ?? '';
}

/** El `syntheticProduct` que el step N7a de la variante EMITIÓ en su `output_refs` (`N7aOutput`, top-level: la
 *  unión discriminada por `route` fija `syntheticProduct` por construcción). Se lee del step —no de la fila
 *  `generation`— porque el productor lo emite ADEMÁS de en la columna JUSTO para leerlo sin join
 *  (generation.ts:89), y así es DEDUP-PROOF (una `generation` reutilizada de otro spec no dejaría fila para
 *  este step). Devuelve el texto (`'true'`/`'false'`) o '' si no hay N7a. */
async function n7aSyntheticProduct(runId: string, variantId: string): Promise<string> {
  const rows = await queryStack<{ synthetic: string | null }>(
    `SELECT output_refs->>'syntheticProduct' AS synthetic FROM step_run
      WHERE run_id = $1 AND variant_id = $2 AND node_key LIKE 'N7a%' LIMIT 1`,
    [runId, variantId],
  );
  return rows[0]?.synthetic ?? '';
}

// ── waitN7Succeeded / waitStepSucceeded / waitStepStatus ──────────────────────────────────────────────────
// COPIADOS de `normal-generation-composes.spec.ts` (deuda B2: el helper está triplicado —normal-composes,
// partial-regeneration, y aquí— con divergencia de semántica de retry entre ellos; una extracción a un módulo
// compartido de `support/` NO es mecánica por esa divergencia y queda anotada en el informe). Estos son la
// variante «retry cableado» de normal-composes: un `failed` sin retry es un fallo real.

/** Espera hasta que TODOS los N7 de vídeo/voz del run estén `succeeded`, recuperando el doom del fake (primer
 *  submit de imagen → `failed`) con el retry granular. Sin `retry` cableado, un `failed` es un fallo real. */
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

/** Espera hasta que el paso `nodeKey` del run esté `succeeded`. Un `failed`/`rejected` es un fallo real. */
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

/** POST JSON autenticado (la `page.request` lleva el storageState del login). Lanza si no es 2xx. Envuelto en
 *  `apiCall` (T1.19): el `next dev` local cierra sockets keep-alive ociosos y el `request` de Playwright los
 *  reusa → un POST de seed/retry puede morir con ECONNRESET ANTES de tocar la app. `apiCall` reintenta SOLO ese
 *  corte de transporte (nunca un 4xx/5xx, que llega intacto al guard de abajo). */
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
