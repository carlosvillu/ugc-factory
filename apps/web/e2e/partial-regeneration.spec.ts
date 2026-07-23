// REGRESIÓN PERMANENTE de CU4 · REGENERACIÓN PARCIAL OPTIMIZADA (T5.8, §22.4, e2e.md §9, DoD BLOQUEANTE).
// Ejercita el flujo «cambiar el CTA de una variante aprobada → run parcial `kind='regen'`» contra el
// sistema real (web + worker + orquestador + pg-boss + SSE + la op de servidor + BD), con providers FAKE
// ($0 SIEMPRE — el único gasto real es la Verificación 22.4 del verifier con fal REAL).
//
// LO QUE MUERDE (restricción 2 de T5.8, principio 9 — el control anti-trivial es la REUTILIZACIÓN):
// la cota de $0,50 de 22.4 se cumpliría TRIVIALMENTE aunque el regen re-generase TODO (un cambio de CTA
// que re-corriese N7a/N7c/N7d también produce un máster nuevo y también «pasa»). Lo que este test caza es
// que los nodos de VÍDEO CAROS NO AFECTADOS por el cambio de CTA (product shots N7a, avatar del hook N7c) se
// REUTILIZAN de caché (dedup de T4.10): sus asset-ids son IDÉNTICOS pre/post regen. Y el control de dos
// caras vive DENTRO de N7b (voiceover, uno por escena): cambiar el TEXTO del CTA cambia SOLO la narración de
// la escena `cta` → el `content_hash` del TTS de ESE clip difiere (su `resolvedPrompt` ES la narración, ver
// `generate-audio.ts`) mientras el clip de voz del HOOK (narración intacta) se REUTILIZA. Un bug que reusara
// TODO (el CTA nunca se aplicó) rompe «el clip de voz del CTA difiere»; uno que reusara NADA (variantId en el
// content_hash) rompe «N7a idéntico» Y «el clip de voz del hook idéntico».
//
// POR QUÉ NO SE ASERTA SOBRE N7f (CTA de vídeo): el prompt i2v de N7f es un DEFAULT fijo (`DEFAULT_BROLL_PROMPT`
// en `generate-broll.ts`), NO deriva de la narración; cambiar el TEXTO del CTA no mueve su `content_hash` →
// N7f deduplica igual. El nodo que un cambio de TEXTO de CTA regenera es N7b (la voz), no N7f. Esto es
// además la esencia del ahorro de 22.4: un cambio de CTA re-sintetiza SOLO el TTS barato y REUTILIZA el vídeo
// caro (Veo). N7f se deja fuera del assert (su duración se cuantiza de la longitud de la narración y puede o
// no cruzar un bucket → afirmar cualquiera de las dos direcciones sería frágil).
//
// POR QUÉ SE SIEMBRA EL ORIGEN CON UNA GENERACIÓN REAL (N6→N7, fal FAKE) Y NO CON ASSETS A MANO: la dedup
// (T4.10) muerde por `content_hash` de generaciones `completed` REALES. Sembrar assets a mano exigiría
// re-calcular el content_hash → re-implementaría la dedup (trampa T1.8). Así que el ORIGEN corre su sub-DAG
// N6→N7 de verdad (el worker del stack, fal fake $0), poblando el índice de dedup; el regen deduplica
// contra ÉL. Desde T5.8b el ORIGEN también compone (arranca vía el APPROVE de CP3 → `withComposition`
// emite N8/N9), pero la conservación de assets se observa a nivel N7 (el ahorro está en los clips de pago
// reutilizados, no en la composición). El REGEN compone igual: la op `regenerateVariantCta` aplica
// `withComposition` al plan que emite, así que el run parcial llega a N8 y PERSISTE un máster nuevo (ffmpeg
// REAL del stack, $0). Este spec asserta AMBAS caras: la conservación N7
// (el ahorro) Y el máster nuevo del clon (la cláusula titular de 22.4, «produce un máster nuevo»), de modo
// que el verifier con fal REAL confirme coste/latencia sobre un camino de composición YA PROBADO en verde,
// no lo descubra gastando el saldo del usuario (principio 9).
//
// LA GENERACIÓN DEL ORIGEN + EL PASO POR CP4: aunque desde T5.8b el origen SÍ llega a N9 por el pipeline,
// su N9 real aterriza de forma timing-dependiente (tras N8), así que se le SIEMBRA un N9 pausado + su máster
// (patrón `variant-review.spec.ts`) para que el click por `data-step-id` sea DETERMINISTA (load-bearing: no
// depende de cuándo llegue el N9 real). Regenerar desde ese CP4 pausado clona la variante y arranca el run
// parcial.
// NOTA DE ARQUITECTURA (por qué el ORIGEN se genera vía el APPROVE de CP3 y NO con `createRun` en-proceso):
// el loader ESM de Playwright es MÁS ESTRICTO que tsx/Vite con los `import` de JSON sin `type` attribute —
// importar `@ugc/services`/`createRun` arrastra `@ugc/core/gallery`→`raw-seed.ts` (que importa JSON sin
// attribute) y el spec no carga. Además NINGÚN otro e2e importa `@ugc/services`: la disciplina de e2e es
// sembrar por repos de `@ugc/db` + conducir por HTTP + sondear la BD. Así que el ORIGEN se arranca como en
// PRODUCCIÓN: se siembra un step N5 pausado y se hace `POST /api/steps/:id/approve` con la decisión de
// guiones → el SERVIDOR (que sí tiene `@ugc/services`) construye el plan y arranca el run de generación
// N6→N7 (que se corta en N7, la deuda de fase que este spec documenta). El regen también corre en el
// servidor (la op de `regen-checkpoint.ts`), sin tocar `@ugc/services` desde el proceso del test.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { newUlid } from '@ugc/core/contracts';
import type { N5Output, N9Output } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import { matchPersonas } from '@ugc/core/persona';
import type { PersonaSeed } from '@ugc/core/persona/server';
import {
  createAsset,
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

const stackDb = createDb(stackDatabaseUrl);
const storage = makeLocalStorageAdapter({ root: assetsDir });

// El brief beauty (la ÚNICA vertical con template + guard pack sembrados, igual que el E2E de F4): sin él
// N6 no casaría template y el sub-DAG N7 fallaría en el compilador.
const BRIEF = FAKE_BRIEF_BEAUTY;

// Persona premium COMPLETA que casa con el hint beauty (misma que F4): imagen de referencia (N7c avatar la
// exige) + voiceMap es (N7b la exige). Sin ella la generación del servidor lanzaría money-safe.
const MATCHING_PERSONA: PersonaSeed = {
  name: 'Nora Regen Premium',
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

/** El N9Output que un step de CP4 lleva en su `output_refs` (la op de regen lee la variante origen de él). */
function n9Output(variantId: string): N9Output {
  return {
    variantId,
    passed: true,
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
      passed: true,
      score: 100,
    },
  };
}

/** El asset-id que el step `nodeKey` de `runId` emitió en su `output_refs` (la frontera cross-node). N7a lo
 *  lleva en `shots[0].assetId`; N7c en `assetId`; N7d/N7f en `clips[0].assetId`. `undefined` si no hay step
 *  succeeded de ese nodo aún. Es el observable de REUTILIZACIÓN: dedup ⇒ el regen apunta al MISMO asset. */
async function assetIdOf(runId: string, nodeKey: string): Promise<string | undefined> {
  const rows = await queryStack<{ output_refs: unknown }>(
    `SELECT output_refs FROM step_run WHERE run_id = $1 AND node_key = $2 AND status = 'succeeded' LIMIT 1`,
    [runId, nodeKey],
  );
  const refs = rows[0]?.output_refs as Record<string, unknown> | undefined;
  if (refs === undefined) return undefined;
  if (nodeKey === 'N7a') {
    const shots = refs.shots as { assetId?: string }[] | undefined;
    return shots?.[0]?.assetId;
  }
  if (nodeKey === 'N7d' || nodeKey === 'N7f') {
    const clips = refs.clips as { assetId?: string }[] | undefined;
    return clips?.[0]?.assetId;
  }
  // N7c: assetId directo.
  return refs.assetId as string | undefined;
}

/** El asset-id del clip de voz (N7b) de la escena `sceneIndex` de `runId`. N7b emite `clips[]` con
 *  `{sceneIndex, assetId}` (uno por escena). Es el observable del control de DOS CARAS del cambio de CTA:
 *  el clip de la escena `cta` DIFIERE (su narración cambió → `content_hash` del TTS distinto) y el de la
 *  escena `hook` es IDÉNTICO (narración intacta → dedup). `undefined` si no hay N7b succeeded o esa escena. */
async function voiceClipAssetId(runId: string, sceneIndex: number): Promise<string | undefined> {
  const rows = await queryStack<{ output_refs: unknown }>(
    `SELECT output_refs FROM step_run WHERE run_id = $1 AND node_key = 'N7b' AND status = 'succeeded' LIMIT 1`,
    [runId],
  );
  const refs = rows[0]?.output_refs as
    { clips?: { sceneIndex?: number; assetId?: string }[] } | undefined;
  return refs?.clips?.find((c) => c.sceneIndex === sceneIndex)?.assetId;
}

/** Espera hasta que TODOS los N7 de vídeo/imagen del run (`N7a`,`N7c`,`N7d`,`N7f`) estén `succeeded`. La
 *  dedup fast-hit solo casa filas `completed`: sin esto, el regen podría entrar en `LoserRaceError`.
 *
 *  RETRY GRANULAR (patrón F4): el fake de fal DOOMEA el PRIMER submit de imagen del stack (N7a → `{}`
 *  malformado → `PermanentStepError`, `failed` SIN auto-retry). Es el mismo comportamiento que ejercita el
 *  E2E de F4: el step fallido se REINTENTA (`POST /api/steps/:id/retry`) y el re-submit (request_id nuevo,
 *  no doomed) sale correcto. Se pasa `retry` (la `page.request`) para recuperar esos fallos como en
 *  producción; sin él (el run de regen, que ya no cae en el doom) un `failed` es un fallo real. */
async function waitN7Succeeded(
  runId: string,
  nodeKeys: string[],
  timeoutMs: number,
  retry?: (stepId: string) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const retried = new Set<string>();
  while (Date.now() < deadline) {
    const rows = await queryStack<{ id: string; node_key: string; status: string }>(
      `SELECT id, node_key, status FROM step_run WHERE run_id = $1 AND node_key = ANY($2::text[])`,
      [runId, nodeKeys],
    );
    const done = rows.length >= nodeKeys.length && rows.every((r) => r.status === 'succeeded');
    if (done) return;
    const failed = rows.filter((r) => r.status === 'failed' || r.status === 'rejected');
    for (const f of failed) {
      // Un `failed` recuperable por retry (el doom del fake) → se reintenta UNA vez. Sin `retry` cableado,
      // o un segundo fallo del mismo step, es un fallo real → se lanza.
      if (retry !== undefined && f.status === 'failed' && !retried.has(f.id)) {
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

test.describe('CU4 · regeneración parcial (T5.8): cambiar el CTA reutiliza N7a/N7c y regenera la voz del CTA', () => {
  test(
    'cambiar el CTA desde CP4 arranca un run kind=regen que reutiliza los assets no afectados y cambia el del CTA',
    { tag: ['@f5', '@regen'] },
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
      const sourceVariant = variants[0]!;
      // El plan REAL del lote se compuso con `batchDiscriminator = batchId` (filenameCodes definitivos, ≠
      // los del `preview` sin discriminante): se recompone con el mismo id para casar `sharedBodyKey`.
      const finalPlan = planBatch({ ...args, batchDiscriminator: created.batch.id }).plan;
      const plannedVariant = finalPlan.variants.find(
        (v) => v.filenameCode === sourceVariant.filenameCode,
      )!;
      // El guion v1 (coherente con el plan real → N6 casa template). El servidor lo re-linteará al aprobar.
      const createdScripts = await createScriptsForBatch(stackDb, {
        stepRunId: newUlid(),
        scripts: [
          {
            variantId: sourceVariant.id,
            content: scriptForPlanned(plannedVariant.filenameCode, plannedVariant.segmentKeys.body),
            guardrailFlags: [],
          },
        ],
      });

      // ── 2. ARRANCAR LA GENERACIÓN DEL ORIGEN VÍA EL APPROVE DE CP3 (el SERVIDOR construye el plan) ─────
      // Se siembra un step N5 pausado (patrón `variant-review` para el N9) con su `N5Output`, y se hace
      // `POST /api/steps/:id/approve` con la decisión de guiones. El servidor (que sí tiene `@ugc/services`)
      // construye el plan de generación y arranca el run N6→N7 en la tx del checkpoint (T4.11) — el mismo
      // camino de PRODUCCIÓN, no un atajo. Su `nextRunId` es el run del ORIGEN (se corta en N7).
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
            variantId: sourceVariant.id,
            scriptId: createdScripts[0]!.id,
            filenameCode: sourceVariant.filenameCode,
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
          verdicts: [{ variantId: sourceVariant.id, approved: true }],
        },
      });
      const maybeSourceRunId = (approveRes as { nextRunId?: string }).nextRunId;
      expect(
        maybeSourceRunId,
        'aprobar CP3 debe arrancar el run de generación del origen',
      ).toBeTruthy();
      const sourceRunId = maybeSourceRunId!;

      // Los N7 presentes en premium: imagen (N7a), voz (N7b), avatar (N7c), b-roll (N7d), CTA (N7f).
      // `completed` es lo que la dedup fast-hit exige — se espera `succeeded` antes de regenerar. N7b se
      // incluye para poder LEER sus clips de voz (el control de dos caras del cambio de CTA vive ahí).
      const videoNodes = ['N7a', 'N7c', 'N7d', 'N7f'];
      const waitNodes = [...videoNodes, 'N7b'];
      await waitN7Succeeded(sourceRunId, waitNodes, 180_000, async (stepId) => {
        // El doom del fake (primer submit de imagen) se recupera con el retry granular, como en F4.
        await postJson(page.request, `/api/steps/${stepId}/retry`, {});
      });

      const sourceAssets: Record<string, string | undefined> = {};
      for (const nk of videoNodes) sourceAssets[nk] = await assetIdOf(sourceRunId, nk);
      expect(sourceAssets.N7a, 'el origen debe tener un asset N7a').toBeTruthy();
      expect(sourceAssets.N7f, 'el origen debe tener un asset N7f (CTA)').toBeTruthy();
      // Los clips de voz del origen: HOOK (escena 0) y CTA (escena 2, la última en el fixture). Son el
      // observable del control de dos caras: tras regenerar, el del CTA debe DIFERIR y el del hook IDÉNTICO.
      const CTA_SCENE_INDEX = 2;
      const HOOK_SCENE_INDEX = 0;
      const sourceVoiceCta = await voiceClipAssetId(sourceRunId, CTA_SCENE_INDEX);
      const sourceVoiceHook = await voiceClipAssetId(sourceRunId, HOOK_SCENE_INDEX);
      expect(
        sourceVoiceCta,
        'el origen debe tener un clip de voz N7b para la escena CTA',
      ).toBeTruthy();
      expect(
        sourceVoiceHook,
        'el origen debe tener un clip de voz N7b para la escena HOOK',
      ).toBeTruthy();

      // ── 3. SEMBRAR el máster + approved + N9 pausado sobre el origen (para que CP4 renderice) ──────────
      const masterId = await seedMaster();
      await queryStack(
        `UPDATE ad_variant SET master_asset_id = $1, status = 'approved' WHERE id = $2`,
        [masterId, sourceVariant.id],
      );
      const n9StepId = newUlid();
      await queryStack(
        `INSERT INTO step_run (id, run_id, node_key, variant_id, status, is_checkpoint, checkpoint_config, output_refs, depends_on)
         VALUES ($1, $2, 'N9', $3, 'waiting_approval', true, $4, $5, '{}')`,
        [
          n9StepId,
          sourceRunId,
          sourceVariant.id,
          JSON.stringify({ alwaysPause: true }),
          JSON.stringify(n9Output(sourceVariant.id)),
        ],
      );

      // ── 4. ABRIR CP4 EN LA UI Y REGENERAR CON UN CTA NUEVO ─────────────────────────────────────────────
      await page.goto(`/runs/${sourceRunId}`);
      await expect(page.locator('[data-slot="qa-panel"]')).toBeVisible({ timeout: 30_000 });
      await page.locator(`[data-slot="qa-variant-item"][data-step-id="${n9StepId}"]`).click();
      await expect(
        page.locator(`[data-slot="qa-variant-review"][data-step-id="${n9StepId}"]`),
      ).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-slot="regenerate-variant"]').click();
      await expect(page.locator('[data-slot="regenerate-dialog"]')).toBeVisible({
        timeout: 10_000,
      });
      await page
        .locator('[data-slot="regenerate-cta-input"]')
        .fill('Compra ahora con envío gratis y 20% de descuento.');
      await page.locator('[data-slot="confirm-regenerate"]').click();

      // Al arrancar el regen, la UI navega al canvas del run parcial. Se espera a que la URL cambie a un run
      // DISTINTO del origen (la URL ya ERA `/runs/<origen>`, así que un match genérico volvería al instante).
      await page.waitForURL(
        (url) => {
          const m = /\/runs\/([0-9A-Za-z]+)$/.exec(url.pathname);
          return m !== null && m[1] !== sourceRunId;
        },
        { timeout: 30_000 },
      );
      const regenRunId = page.url().split('/runs/')[1]!.split(/[?#]/)[0]!;
      expect(regenRunId, 'debe navegar a un run distinto del origen').not.toBe(sourceRunId);

      // El run parcial es kind='regen'.
      const regenRows = await queryStack<{ kind: string }>(
        `SELECT kind FROM pipeline_run WHERE id = $1`,
        [regenRunId],
      );
      expect(regenRows[0]?.kind).toBe('regen');

      // ── 5. PROGRESO DEL RUN PARCIAL + CONSERVACIÓN DE ASSETS (el control que MUERDE) ───────────────────
      // El canvas del run parcial se pinta (progreso visible por SSE).
      await expect(page.getByRole('article').first()).toBeVisible({ timeout: 30_000 });

      // Esperar a que los N7 del regen terminen (deduplican contra el origen o regeneran). Incluye N7b (voz),
      // donde vive el control de dos caras.
      await waitN7Succeeded(regenRunId, waitNodes, 150_000);

      const regenAssets: Record<string, string | undefined> = {};
      for (const nk of videoNodes) regenAssets[nk] = await assetIdOf(regenRunId, nk);

      // CONSERVACIÓN (dedup T4.10): los nodos de VÍDEO CAROS NO afectados por el cambio de CTA reutilizan el
      // MISMO asset.
      //   · N7a (product shots): prompt derivado del brief, agnóstico al CTA → IDÉNTICO.
      //   · N7c (avatar del hook): el hook no cambió (solo el CTA) → su audio de hook y su clip → IDÉNTICO.
      expect(regenAssets.N7a, 'N7a (product shots) debe REUTILIZARSE (dedup): mismo asset-id').toBe(
        sourceAssets.N7a,
      );
      if (sourceAssets.N7c !== undefined) {
        expect(regenAssets.N7c, 'N7c (avatar del hook) debe REUTILIZARSE: el hook no cambió').toBe(
          sourceAssets.N7c,
        );
      }

      // CONTROL DE DOS CARAS (dentro de N7b · voz): cambiar el TEXTO del CTA re-sintetiza SOLO el TTS de la
      // escena CTA (su `content_hash` = narración nueva) y REUTILIZA el de la escena HOOK (narración intacta).
      //   · clip de voz del CTA → DIFIERE (se regeneró): sin esto, un regen que reusara TODO (el CTA nunca se
      //     aplicó) pasaría en verde ocultando el bug.
      //   · clip de voz del HOOK → IDÉNTICO (dedup): sin esto, un regen que reusara NADA (variantId en el
      //     content_hash) pasaría en verde ocultando el bug de sobre-regeneración.
      const regenVoiceCta = await voiceClipAssetId(regenRunId, CTA_SCENE_INDEX);
      const regenVoiceHook = await voiceClipAssetId(regenRunId, HOOK_SCENE_INDEX);
      expect(
        regenVoiceCta,
        'el regen debe tener un clip de voz N7b para la escena CTA',
      ).toBeTruthy();
      expect(
        regenVoiceCta,
        'voz del CTA (N7b) debe REGENERARSE: su asset-id DIFIERE del origen (narración nueva)',
      ).not.toBe(sourceVoiceCta);
      expect(
        regenVoiceHook,
        'voz del HOOK (N7b) debe REUTILIZARSE: su narración no cambió → mismo asset-id (dedup)',
      ).toBe(sourceVoiceHook);

      // ── 6. LA CLÁUSULA TITULAR (§22.4): el regen COMPONE UN MÁSTER NUEVO ────────────────────────────────
      // La conservación N7 de arriba prueba el AHORRO; esta prueba el RESULTADO. La op de regen añade
      // n8Config/n9Config al plan (a diferencia de `buildVariantGenerationPlan` a secas), así que el run
      // parcial COMPONE en CPU (ffmpeg REAL del stack, $0 — solo las APIs externas se fakean por base-URL).
      // Sin esta aserción, la primera vez que el camino de composición del regen se ejecutaría sería el run
      // con fal REAL del verifier: gastar el saldo del usuario como PRIMER test de N8 (principio 9). Se
      // ASERTA SOBRE N8 (que persiste el máster vía `finalizeVariantMaster`), NO sobre N9 (QA posterior que
      // sobre media sintética —clip de 2.0s, ASR fake de 1.8s— puede fallar `av_duration_diff`/`loudness` y
      // enmascararía el éxito real de la composición). El clon NO viaja en la respuesta del POST: se localiza
      // por `step_run.variant_id` del paso N8 del run parcial.
      // (El bed musical de ace-step es WAV `channel_layout=unknown`; T5.8a antepone `aformat=channel_layouts=
      // stereo` en compose-master.ts para que el `sidechaincompress` del ducking negocie formatos — sin él N8
      // fallaba «could not choose their formats». Ese fix vive en T5.8a, ya commiteado; aquí solo se consume.)
      await waitStepSucceeded(regenRunId, 'N8', 90_000);
      const cloneRows = await queryStack<{ variant_id: string | null }>(
        `SELECT variant_id FROM step_run WHERE run_id = $1 AND node_key = 'N8' AND status = 'succeeded' LIMIT 1`,
        [regenRunId],
      );
      const cloneVariantId = cloneRows[0]?.variant_id;
      expect(
        cloneVariantId,
        'el paso N8 del regen debe llevar el variant_id del clon',
      ).toBeTruthy();
      expect(cloneVariantId, 'el clon debe ser una variante DISTINTA del origen').not.toBe(
        sourceVariant.id,
      );

      const masterRows = await queryStack<{ master_asset_id: string | null }>(
        `SELECT master_asset_id FROM ad_variant WHERE id = $1`,
        [cloneVariantId],
      );
      const cloneMasterId = masterRows[0]?.master_asset_id;
      // Load-bearing: el regen PRODUJO un máster (no-null). Sin esto la tarea no cumple su cláusula titular.
      expect(
        cloneMasterId,
        'el regen debe COMPONER un máster nuevo: master_asset_id del clon no-null',
      ).toBeTruthy();
      // Guard: es un máster NUEVO, no el sintético sembrado sobre el origen.
      expect(cloneMasterId, 'el máster del clon debe DIFERIR del máster del origen').not.toBe(
        masterId,
      );
    },
  );
});

/** Espera hasta que el paso `nodeKey` de `runId` esté `succeeded` (para N8, la composición del máster). A
 *  diferencia de `waitN7Succeeded`, no reintenta: en el run de regen el doom de imagen ya está gastado (F4
 *  lo consumió — proyecto propio, ver `playwright.config.ts`), así que un `failed` aquí es un fallo real. */
async function waitStepSucceeded(runId: string, nodeKey: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await queryStack<{ status: string }>(
      `SELECT status FROM step_run WHERE run_id = $1 AND node_key = $2 LIMIT 1`,
      [runId, nodeKey],
    );
    const status = rows[0]?.status;
    if (status === 'succeeded') return;
    if (status === 'failed' || status === 'rejected') {
      throw new Error(`waitStepSucceeded: ${nodeKey} del run ${runId} terminó en ${status}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const finalRows = await queryStack<{ node_key: string; status: string }>(
    `SELECT node_key, status FROM step_run WHERE run_id = $1 ORDER BY node_key`,
    [runId],
  );
  throw new Error(
    `waitStepSucceeded: timeout esperando ${nodeKey} succeeded del run ${runId}. Estados: ${finalRows
      .map((r) => `${r.node_key}=${r.status}`)
      .join(', ')}`,
  );
}

/** POST JSON autenticado (la `page.request` lleva el storageState del login). Lanza si no es 2xx. */
async function postJson(request: APIRequestContext, path: string, body: unknown): Promise<unknown> {
  const res = await request.post(path, { data: body });
  if (!res.ok()) {
    throw new Error(`POST ${path} → ${String(res.status())}: ${await res.text()}`);
  }
  return res.json();
}

/** Un máster sintético (fichero mp4 real + fila `asset` final_video). El player lo pide por su id. */
async function seedMaster(): Promise<string> {
  const bytes = Buffer.from('ftypisom-fake-master-not-a-real-mp4-but-enough-for-the-src', 'utf8');
  const id = newUlid();
  const storageKey = `e2e/regen-${id}.mp4`;
  const put = await storage.put(storageKey, new Uint8Array(bytes), { mime: 'video/mp4' });
  const row = await createAsset(stackDb, {
    id,
    kind: 'final_video',
    storageKey,
    mime: 'video/mp4',
    bytes: put.bytes,
    checksum: put.checksum,
  });
  return row.id;
}

/** Un `AdScript` mínimo COHERENTE con la variante planificada (filenameCode + sharedBodyKey del plan real),
 *  con escena `cta` AL FINAL (para que el cambio de CTA no desplace el timing de hook/body → sus hashes no
 *  cambian). El texto es beauty-safe (sin claims de salud → sin flag bloqueante). */
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
