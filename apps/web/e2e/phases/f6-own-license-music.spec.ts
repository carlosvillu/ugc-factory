// E2E permanente — T6.2b · MÚSICA PROPIA (own_license): subir una pista licenciada y usarla como bed de
// una variante en vez del bed generado por N7e (e2e.md §9). Sistema entero vivo (web + worker + orquestador
// + pg-boss + SSE + nodos reales N6→N8) con fal FINGIDO ($0): el máster con música propia lo COMPONE N8 (no
// genera fal), así que este journey no gasta.
//
//   lote PREMIUM (guion v1) → SUBIR pista mp3 (POST /api/assets kind=music_bed) → ATAR a la variante
//   (PUT /api/variants/:id/music-bed) → CP3-aprobar → run N6→N7→N8 → el máster se compone con ESA música.
//
// QUÉ AFIRMA (la Entrega + Verificación de T6.2b):
//   · el plan de generación de la variante con bed propio NO EMITE N7e (no hay step_run N7e para ella);
//   · N8 COMPONE el máster (master_asset_id no-null) y su `composition_spec.music.asset` == el asset SUBIDO;
//   · `audio_source='own_license'` queda persistido en la variante.
//
// CONTROL NEGATIVO (revertir la condición de salto de N7e → N7e vuelve a generarse y el bed propio se
// ignora → ROJO): vive en el test de integración del builder
// (packages/services/test/integration/build-variant-generation-plan.test.ts, «BED PROPIO ... OMITE
// n7eConfig»), que PINEA el salto en sí (`n7eConfig` ausente + `providedMusicBedAssetId` presente). Se pinea
// AHÍ y no solo aquí porque con «el bed propio gana» en el ensamblador, revertir el salto dejaría el máster
// igualmente correcto y una aserción solo-sobre-el-máster se quedaría verde por accidente. Aquí el e2e
// afirma el efecto observable de extremo a extremo (sin N7e + música propia en el máster).
//
// TIER PREMIUM a propósito (patrón F4/F5): el único generation-ready — test/standard dejan `broll` etiqueta y
// `buildVariantGenerationPlan` lanza money-safe antes de gastar.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { queryStack, stackDatabaseUrl, assetsDir } from '../support/stack-db';
import { apiCall } from '../support/http';

const stackDb = createDb(stackDatabaseUrl);

const BRIEF = FAKE_BRIEF_BEAUTY;

// Persona premium COMPLETA que casa con el hint beauty (misma que F4/F5): imagen de referencia (N7c) +
// voiceMap es (N7b). Sin ella la generación lanzaría money-safe y CP3 no arrancaría el run.
const MATCHING_PERSONA: PersonaSeed = {
  name: 'Nora T62b Music',
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
  expect(candidates.length, 'el hint beauty debe casar con al menos una persona').toBeGreaterThan(
    0,
  );
  expect(
    (candidates[0]?.persona.referenceImageIds.length ?? 0) > 0,
    'el top-1 debe traer imagen de referencia (N7c avatar la exige)',
  ).toBe(true);
});

test.describe('T6.2b · música propia (own_license)', () => {
  test(
    'subir una pista propia y atarla a una variante: el máster se compone con esa música, sin N7e, own_license persistido',
    { tag: ['@f6'] },
    async ({ page }) => {
      test.setTimeout(300_000);

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

      // ── 2. SUBIR la pista propia (POST /api/assets kind=music_bed) y ATARLA a la variante ──────────────
      const uploadedBedId = await uploadMusicBed(page.request);
      const attachRes = (await postJson(
        page.request,
        `/api/variants/${variant.id}/music-bed`,
        { assetId: uploadedBedId },
        'PUT',
      )) as { ownMusicBedAssetId: string; audioSource: string };
      expect(attachRes.ownMusicBedAssetId).toBe(uploadedBedId);
      expect(attachRes.audioSource).toBe('own_license');

      // ── 3. ARRANCAR LA GENERACIÓN VÍA EL APPROVE DE CP3 ───────────────────────────────────────────────
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

      const approveRes = await postJson(
        page.request,
        `/api/steps/${n5StepId}/approve`,
        { decision: { kind: 'scripts', verdicts: [{ variantId: variant.id, approved: true }] } },
        'POST',
      );
      const generationRunId = (approveRes as { nextRunId?: string }).nextRunId;
      expect(generationRunId, 'aprobar CP3 debe arrancar el run de generación').toBeTruthy();

      // ── 4. LA CADENA CORRE HASTA COMPONER EL MÁSTER (N8 succeeded) ────────────────────────────────────
      // Con bed propio, los N7 de vídeo/voz siguen (N7a/N7b/N7c/N7d/N7f); N7e NO — es justo lo que se afirma.
      const videoNodes = ['N7a', 'N7b', 'N7c', 'N7d', 'N7f'];
      await waitN7Succeeded(generationRunId!, videoNodes, 240_000, async (stepId) => {
        await postJson(page.request, `/api/steps/${stepId}/retry`, {}, 'POST');
      });
      await waitStepSucceeded(generationRunId!, 'N8', 120_000);

      // ── 5. ASERCIONES DE T6.2b ────────────────────────────────────────────────────────────────────────
      // (a) NO hay step_run N7e para esta variante: N7e no se generó (el builder omitió n7eConfig).
      const n7eSteps = await queryStack<{ id: string }>(
        `SELECT id FROM step_run WHERE run_id = $1 AND variant_id = $2 AND node_key LIKE 'N7e%'`,
        [generationRunId!, variant.id],
      );
      expect(
        n7eSteps,
        'una variante con bed propio NO debe emitir N7e (el bed lo pone el usuario)',
      ).toHaveLength(0);

      // (b) N8 compuso el máster con ESA música: master no-null + el bed SUBIDO está en el LINAJE del máster
      // (`asset.parent_asset_ids`, que `collectSpecParentAssetIds` puebla con `spec.music.asset`). Es la
      // prueba honesta de que la pista propia se COMPUSO en el máster (no que N8 escribió una columna): el
      // linaje del máster deriva del asset del usuario.
      const masterId = await variantMasterAssetId(variant.id);
      expect(masterId, 'N8 debe COMPONER un máster: master_asset_id no-null').toBeTruthy();
      const parents = await assetParentIds(masterId!);
      expect(
        parents,
        'el máster debe derivar de la pista PROPIA subida (parent_asset_ids incluye el bed)',
      ).toContain(uploadedBedId);

      // (c) `audio_source='own_license'` persistido.
      const audioSource = await variantAudioSource(variant.id);
      expect(audioSource, 'la variante debe quedar audio_source=own_license').toBe('own_license');
    },
  );
});

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────

/** Una pista de AUDIO REAL y decodable (el WAV de fixture): N8 la compone con ffmpeg de verdad, así que
 *  debe ser audio válido — no bytes arbitrarios (que romperían el mux del máster). WAV está en la allowlist
 *  de `music_bed`. Es una pista del usuario a efectos de esta prueba (la procedencia es lo que importa). */
const OWN_BED_WAV = fileURLToPath(
  new URL('../../../../packages/test-utils/fixtures/media/voice-sample.wav', import.meta.url),
);

/** Sube la pista propia como asset `music_bed` (POST /api/assets, campo `kind`). Devuelve el id. */
async function uploadMusicBed(request: APIRequestContext): Promise<string> {
  const res = await apiCall(
    () =>
      request.post('/api/assets', {
        multipart: {
          kind: 'music_bed',
          file: {
            name: `own-bed-${randomUUID()}.wav`,
            mimeType: 'audio/wav',
            buffer: readFileSync(OWN_BED_WAV),
          },
        },
      }),
    'POST /api/assets (music_bed)',
  );
  if (!res.ok()) {
    throw new Error(`upload music_bed → ${String(res.status())}: ${await res.text()}`);
  }
  return ((await res.json()) as { id: string }).id;
}

async function variantMasterAssetId(variantId: string): Promise<string | null> {
  const rows = await queryStack<{ master_asset_id: string | null }>(
    `SELECT master_asset_id FROM ad_variant WHERE id = $1`,
    [variantId],
  );
  return rows[0]?.master_asset_id ?? null;
}

/** El linaje (`parent_asset_ids`) de una fila `asset` — los assets origen de los que deriva. Para el máster
 *  incluye el bed (`collectSpecParentAssetIds` puebla con `spec.music.asset`). */
async function assetParentIds(assetId: string): Promise<string[]> {
  const rows = await queryStack<{ parent_asset_ids: string[] | null }>(
    `SELECT parent_asset_ids FROM asset WHERE id = $1`,
    [assetId],
  );
  return rows[0]?.parent_asset_ids ?? [];
}

async function variantAudioSource(variantId: string): Promise<string> {
  const rows = await queryStack<{ audio_source: string | null }>(
    `SELECT audio_source FROM ad_variant WHERE id = $1`,
    [variantId],
  );
  return rows[0]?.audio_source ?? '';
}

/** Espera hasta que TODOS los N7 de vídeo/voz estén `succeeded`, recuperando el doom del fake con retry. */
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
    if (allPresent && rows.length > 0 && rows.every((r) => r.status === 'succeeded')) return;
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
    `waitN7Succeeded: timeout del run ${runId}. Estados: ${finalRows
      .map((r) => `${r.node_key}=${r.status}`)
      .join(', ')}`,
  );
}

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
    `waitStepSucceeded: timeout esperando ${nodeKey}=succeeded del run ${runId}. Estados: ${finalRows
      .map((r) => `${r.node_key}=${r.status}`)
      .join(', ')}`,
  );
}

/** POST/PUT JSON autenticado (la `page.request` lleva el storageState del login). Lanza si no es 2xx. */
async function postJson(
  request: APIRequestContext,
  path: string,
  body: unknown,
  method: 'POST' | 'PUT' = 'POST',
): Promise<unknown> {
  const res = await apiCall(
    () =>
      method === 'PUT' ? request.put(path, { data: body }) : request.post(path, { data: body }),
    `${method} ${path}`,
  );
  if (!res.ok()) {
    throw new Error(`${method} ${path} → ${String(res.status())}: ${await res.text()}`);
  }
  return res.json();
}

/** Un `AdScript` mínimo COHERENTE con la variante planificada (filenameCode + sharedBodyKey del plan real). */
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
