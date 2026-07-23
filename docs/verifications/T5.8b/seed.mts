// VERIFIER T5.8b — seed script (mío, no del implementer). Siembra en la BD de DEV (ugc-postgres-dev,
// misma que sirve `pnpm dev`) un lote PREMIUM con UNA variante scripted + su guion v1, y deja un step N5
// pausado listo para el approve de CP3. Mirror del seeding de apps/web/e2e/normal-generation-composes.spec.ts
// pero contra la BD viva de dev (fal REAL) — el approve lo hace el driver HTTP aparte (login humano).
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
import { sql } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL!;
const ASSETS_DIR = process.env.ASSETS_DIR ?? '/tmp/ugc-assets-dev';
const db = createDb(DATABASE_URL);
const storage = makeLocalStorageAdapter({ root: ASSETS_DIR });
const BRIEF = FAKE_BRIEF_BEAUTY;

const MATCHING_PERSONA: PersonaSeed = {
  name: 'Nora Verify T58b Premium',
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

function scriptForPlanned(filenameCode: string, sharedBodyKey: string) {
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
  } as import('@ugc/core/contracts').AdScript;
}

async function main() {
  // Persona con imagen que casa el hint beauty
  await seedPersonas(db, storage, [MATCHING_PERSONA]);
  const personas = await listPersonas(db);
  const candidates = matchPersonas(personas, FAKE_BEAUTY_AVATAR_HINT);
  if (candidates.length === 0) throw new Error('el hint beauty no casó ninguna persona');
  if ((candidates[0]?.persona.referenceImageIds.length ?? 0) === 0)
    throw new Error('el top-1 no trae imagen de referencia');

  const [p] = await db.insert(projectTable).values(makeProject()).returning();
  const projectId = p!.id;
  const [ua] = await db.insert(urlAnalysisTable).values(makeUrlAnalysis({ projectId })).returning();
  const [brief] = await db
    .insert(productBriefTable)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();

  const { libraryHooks, personas: planPersonas, recipe } = await listPlanningInputs(db, 'premium');
  const config = {
    angleIndices: [0],
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'premium' as const,
    languages: ['es'],
    personaMode: 'rotate' as const,
  };
  const args = { brief: BRIEF, config, libraryHooks, personas: planPersonas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(db, {
    projectId,
    briefId: brief!.id,
    tier: 'premium',
    objective: 'hook_test',
    languages: ['es'],
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
  const variants = await listBatchVariants(db, created.batch.id);
  const variant = variants[0]!;
  const finalPlan = planBatch({ ...args, batchDiscriminator: created.batch.id }).plan;
  const plannedVariant = finalPlan.variants.find((v) => v.filenameCode === variant.filenameCode)!;
  const createdScripts = await createScriptsForBatch(db, {
    stepRunId: newUlid(),
    scripts: [
      {
        variantId: variant.id,
        content: scriptForPlanned(plannedVariant.filenameCode, plannedVariant.segmentKeys.body),
        guardrailFlags: [],
      },
    ],
  });

  // step N5 pausado (waiting_approval) con su N5Output
  const n5RunId = newUlid();
  await db.execute(sql`INSERT INTO pipeline_run (id, project_id) VALUES (${n5RunId}, ${projectId})`);
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
  await db.execute(sql`
    INSERT INTO step_run (id, run_id, node_key, status, is_checkpoint, checkpoint_config, output_refs, depends_on)
    VALUES (${n5StepId}, ${n5RunId}, 'N5', 'waiting_approval', true,
            ${JSON.stringify({ alwaysPause: true })}::jsonb, ${JSON.stringify(n5Out)}::jsonb, '{}')`);

  console.log(
    JSON.stringify({
      projectId,
      batchId: created.batch.id,
      variantId: variant.id,
      filenameCode: variant.filenameCode,
      tier: 'premium',
      n5RunId,
      n5StepId,
    }),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
