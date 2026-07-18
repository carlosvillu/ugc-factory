// Integración de `assembleN6Sources` (T4.11 pass 2b-ii, §7.2 N6) contra Postgres real. Prueba que el
// ensamblador LEE brief+persona+guion+facetas de una variante y produce un `N6Sources` con el que el
// motor puro `compilePrompt` resuelve un prompt REAL — y que ese prompt CONTIENE el texto del guion
// (hook/cta) de la variante. Anti-T1.8 (punto fijo): se usa un template que INTERPOLA {hook.line}/
// {cta.line} y se asserta que el hook REAL aparece en el resolvedPrompt — un template que no los usara
// no cazaría un ensamblado roto. NO toca fal ($0).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAsset,
  createPersona,
  createProject,
  createScriptsForBatch,
  seedGallery,
} from '@ugc/db';
import { adBatch, adVariant, productBrief, urlAnalysis } from '@ugc/db/schema';
import {
  RAW_GALLERY_SEED,
  validateGallerySeed,
  compilePrompt,
  resolveCompileInput,
  DEMO_BEAUTY_BRIEF,
} from '@ugc/core/gallery';
import { newUlid } from '@ugc/core/contracts';
import { PermanentStepError } from '@ugc/core/orchestrator';
import {
  createTestDatabase,
  makeUrlAnalysis,
  makeProductBrief,
  makeProject,
} from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';

import { assembleN6Sources } from '../../src/assemble-n6-sources';

let tdb: TestDatabase;

const HOOK_TEXT = 'Tu piel te está pidiendo ayuda a gritos.';
const CTA_TEXT = 'Toca el enlace y pruébalo hoy.';

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'services:assemble-n6-sources' });
  const gseed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!gseed.ok || !gseed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, gseed.seed);
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query(
    'TRUNCATE ad_script, ad_variant, ad_batch, product_brief, url_analysis, persona, asset, project CASCADE',
  );
});

/** Siembra una variante beauty con guion cuyo hook/cta son textos DISTINGUIBLES en el prompt. */
async function seedBeautyVariant(opts: {
  withScript: boolean;
  withPersona?: boolean;
}): Promise<string> {
  const project = await createProject(tdb.db, makeProject());
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: project.id }))
    .returning();
  // El brief beauty: su `product.category` fija el vertical (beauty) y `framework` fija el hookAngle
  // (pain_point). Como el ensamblador NO fija `format` (no hay fuente en la BD hoy — deuda anotada), la
  // selección recae en el ÚNICO template beauty+pain_point+tiktok format-agnóstico: `demo-pain-point`
  // (que interpola {hook.line}/{cta.line} — lo que hace verificable el ensamblado del guion).
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: DEMO_BEAUTY_BRIEF }))
    .returning();

  let personaId: string | null = null;
  if (opts.withPersona !== false) {
    const refImage = await createAsset(tdb.db, {
      kind: 'reference_image',
      storageKey: `refs/${newUlid()}.png`,
      mime: 'image/png',
      bytes: 1024,
      checksum: 'deadbeef',
    });
    const persona = await createPersona(tdb.db, {
      name: `Lucía ${newUlid().slice(-6)}`,
      ageRange: '25-34',
      gender: 'female',
      ethnicity: 'latina',
      style: 'natural',
      descriptor: 'creadora de 30 años, estilo natural',
      setting: 'baño luminoso',
      personality: 'cercana',
      voiceMap: { es: { provider: 'elevenlabs', voiceId: 'rachel_v3' } },
      referenceImageIds: [refImage.id],
    });
    personaId = persona.id;
  }

  const batchId = newUlid();
  const filenameCode = `demo-${batchId.slice(-6).toLowerCase()}-es-30s`;
  await tdb.db.insert(adBatch).values({
    id: batchId,
    projectId: project.id,
    briefId: brief!.id,
    // La matriz DEBE validar `BatchPlanSchema` (el ensamblador la parsea para el sharedBodyKey).
    matrix: {
      objective: 'conversion',
      tier: 'premium',
      durationTargetSeconds: 30,
      languages: ['es'],
      sharedBodyAndCta: false,
      personaSelection: 'matched',
      variants: [
        {
          angleIndex: 0,
          angleName: 'pain_point',
          framework: 'pain_point',
          hook: { text: HOOK_TEXT, source: 'library' },
          personaName: 'Lucía',
          personaId,
          language: 'es',
          durationTargetSeconds: 30,
          filenameCode,
          segmentKeys: { hook: 'hook_k', body: 'body_k', cta: 'cta_k' },
        },
      ],
    },
    tier: 'premium',
    objective: 'conversion',
    platforms: ['tiktok'],
    languages: ['es'],
  });
  const variantId = newUlid();
  await tdb.db.insert(adVariant).values({
    id: variantId,
    batchId,
    angleName: 'pain_point',
    framework: 'pain_point',
    personaId,
    language: 'es',
    durationTarget: 30,
    platformTargets: ['tiktok'],
    filenameCode,
    status: 'scripted',
  });

  if (opts.withScript) {
    await createScriptsForBatch(tdb.db, {
      stepRunId: newUlid(),
      scripts: [
        {
          variantId,
          content: {
            filenameCode,
            sharedBodyKey: 'body_k',
            hook: HOOK_TEXT,
            cta: CTA_TEXT,
            scenes: [
              {
                t: 0,
                seconds: 3,
                segment: 'hook',
                narration: HOOK_TEXT,
                visual: 'v',
                camera: 'c',
                emotion: 'e',
              },
              {
                t: 3,
                seconds: 8,
                segment: 'body',
                narration: 'Mira cómo cambia tu piel en dos semanas.',
                visual: 'v',
                camera: 'c',
                emotion: 'e',
              },
              {
                t: 11,
                seconds: 2,
                segment: 'cta',
                narration: CTA_TEXT,
                visual: 'v',
                camera: 'c',
                emotion: 'e',
              },
            ],
            subtitles: [{ start: 0, end: 3, text: HOOK_TEXT }],
            fullText: `${HOOK_TEXT} Mira cómo cambia tu piel en dos semanas. ${CTA_TEXT}`,
            wordCount: 20,
            estSeconds: 13,
            tone: 'cercano',
            language: 'es',
          },
          guardrailFlags: [],
        },
      ],
    });
  }

  return variantId;
}

describe('assembleN6Sources → compilePrompt (T4.11 pass 2b-ii)', () => {
  it('ensambla las fuentes y el resolvedPrompt CONTIENE el hook y el cta REALES del guion', async () => {
    const variantId = await seedBeautyVariant({ withScript: true });

    const sources = await assembleN6Sources({ db: tdb.db }, { variantId });
    expect(sources.node).toBe('N6-sources');
    expect(sources.script?.hook).toBe(HOOK_TEXT);
    expect(sources.facets.platform).toBe('tiktok');
    expect(sources.facets.durationSeconds).toBe(30);

    // El motor puro compila de verdad — y el prompt LLEVA el texto del guion de ESTA variante (anti-T1.8:
    // el template interpola {hook.line}/{cta.line}, así que un ensamblado que trajera el guion equivocado
    // — o ninguno — no metería este texto).
    const seed = validateGallerySeed(RAW_GALLERY_SEED);
    const resolved = resolveCompileInput(sources, seed.seed!.templates, seed.seed!.guardPacks);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // Pin del template REALMENTE seleccionado: con `format` sin fuente (omitido), la selección recae en el
    // template format-agnóstico beauty+pain_point+tiktok. Documenta la realidad (no `grwm-beauty-pain-point`,
    // que restringe `formats:['grwm']`) y caza drift del seed. La deuda del `format` está en el report.
    expect(resolved.input.template.slug).toBe('demo-pain-point');
    const result = compilePrompt(resolved.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.resolvedPrompt).toContain(HOOK_TEXT);
    expect(result.result.resolvedPrompt).toContain(CTA_TEXT);
  });

  it('variante sin Persona → PermanentStepError (no puede resolver los slots de audiencia)', async () => {
    const variantId = await seedBeautyVariant({ withScript: true, withPersona: false });
    await expect(assembleN6Sources({ db: tdb.db }, { variantId })).rejects.toThrow(
      PermanentStepError,
    );
  });

  it('variante inexistente → PermanentStepError', async () => {
    await expect(assembleN6Sources({ db: tdb.db }, { variantId: newUlid() })).rejects.toThrow(
      PermanentStepError,
    );
  });
});
