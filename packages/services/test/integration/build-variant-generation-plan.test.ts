// Integración de `buildVariantGenerationPlan` (T4.11 pass 2b-ii) contra Postgres real. Prueba que el
// builder LEE la BD de una variante y produce los configs de generación con los endpoints resueltos del
// recipe×tier + el triple de voz del voice_map — y que un endpoint que aún es ETIQUETA (broll de tier
// test/standard) LANZA `PermanentStepError` ANTES de crear ningún run (money-safety, decisión #2). NO
// toca fal ($0): solo lecturas de BD.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAsset,
  createPersona,
  createProject,
  createScriptsForBatch,
  getVariant,
  seedGallery,
  seedLibrary,
} from '@ugc/db';
import { adBatch, adVariant, productBrief, urlAnalysis } from '@ugc/db/schema';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import {
  createTestDatabase,
  makeProductBrief,
  makeUrlAnalysis,
  makeProject,
  makeBrief,
} from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { newUlid } from '@ugc/core/contracts';

import { buildVariantGenerationPlan } from '../../src/build-variant-generation-plan';

let tdb: TestDatabase;

const BRIEF = makeBrief();

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'services:build-variant-generation-plan' });
  const gseed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!gseed.ok || !gseed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, gseed.seed);
  const lseed = validateSeeds(SEED_LIBRARY);
  if (!lseed.library) throw new Error('la librería no valida');
  await seedLibrary(tdb.db, lseed.library);
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query(
    'TRUNCATE ad_script, ad_variant, ad_batch, product_brief, url_analysis, persona, asset, project CASCADE',
  );
});

/** Siembra proyecto + brief + persona (con voz es + imagen de referencia) + lote + variante + guion.
 *  `tier` gobierna el recipe (premium = todos resolubles; test = broll etiqueta). Devuelve el variantId. */
/** Escenas por defecto del guion sembrado (hook + body + cta): la variante de conversión que ejerce
 *  las ramas N7c/N7d/N7f. Un test puede pasar `scenes` a `seedVariant` para probar un guion SIN cta. */
const DEFAULT_SEED_SCENES = [
  {
    t: 0,
    seconds: 3,
    segment: 'hook' as const,
    narration: 'Si te pasa esto, mira.',
    visual: 'v',
    camera: 'c',
    emotion: 'e',
  },
  {
    t: 3,
    seconds: 6,
    segment: 'body' as const,
    narration: 'Mira cómo funciona de verdad.',
    visual: 'v',
    camera: 'c',
    emotion: 'e',
  },
  {
    t: 9,
    seconds: 2,
    segment: 'cta' as const,
    narration: 'Enlace en la bio.',
    visual: 'v',
    camera: 'c',
    emotion: 'e',
  },
];

async function seedVariant(
  tier: 'test' | 'premium',
  scenes: typeof DEFAULT_SEED_SCENES = DEFAULT_SEED_SCENES,
  opts: { ownMusicBed?: boolean } = {},
): Promise<{ variantId: string; personaId: string; briefId: string; ownBedAssetId?: string }> {
  const project = await createProject(tdb.db, makeProject());
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: project.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();

  // La imagen de referencia de la Persona (kind reference_image) — su assetId es el `imageAssetId` de N7c.
  const refImage = await createAsset(tdb.db, {
    kind: 'reference_image',
    storageKey: `refs/${newUlid()}.png`,
    mime: 'image/png',
    bytes: 1024,
    checksum: 'deadbeef',
  });
  // El voice_map DEBE coincidir con el proveedor del TTS del tier (§13.1: kokoro=test, elevenlabs=premium):
  // un triple incoherente lanzaría en la RAMA DE VOZ y taparía lo que este test quiere probar del broll.
  const voiceMap =
    tier === 'test'
      ? { es: { provider: 'kokoro' as const, voiceId: 'af_heart' } }
      : { es: { provider: 'elevenlabs' as const, voiceId: 'rachel_v3' } };
  const persona = await createPersona(tdb.db, {
    name: `Lucía ${newUlid().slice(-6)}`,
    ageRange: '25-34',
    gender: 'female',
    ethnicity: 'latina',
    style: 'natural',
    descriptor: 'creadora de 30 años',
    setting: 'baño luminoso',
    personality: 'cercana',
    voiceMap,
    referenceImageIds: [refImage.id],
  });

  const batchId = newUlid();
  await tdb.db.insert(adBatch).values({
    id: batchId,
    projectId: project.id,
    briefId: brief!.id,
    matrix: { variants: [] },
    tier,
    objective: 'conversion',
    platforms: ['tiktok'],
    languages: ['es'],
  });
  // Bed musical PROPIO (T6.2b): opcionalmente crea un asset kind=music_bed y lo ata a la variante. La
  // variante con bed propio NO debe emitir n7eConfig al construir el plan.
  let ownBedAssetId: string | undefined;
  if (opts.ownMusicBed === true) {
    const ownBed = await createAsset(tdb.db, {
      kind: 'music_bed',
      storageKey: `music/${newUlid()}.mp3`,
      mime: 'audio/mpeg',
      bytes: 4096,
      checksum: 'cafef00d',
    });
    ownBedAssetId = ownBed.id;
  }

  const variantId = newUlid();
  await tdb.db.insert(adVariant).values({
    id: variantId,
    batchId,
    angleName: 'pain_point',
    framework: 'PAS',
    personaId: persona.id,
    language: 'es',
    durationTarget: 30,
    platformTargets: ['tiktok'],
    filenameCode: `demo-${variantId.slice(-6).toLowerCase()}-es-30s`,
    status: 'scripted',
    ...(ownBedAssetId !== undefined
      ? { ownMusicBedAssetId: ownBedAssetId, audioSource: 'own_license' as const }
      : {}),
  });
  await createScriptsForBatch(tdb.db, {
    stepRunId: newUlid(),
    scripts: [
      {
        variantId,
        content: {
          filenameCode: `demo-${variantId.slice(-6).toLowerCase()}-es-30s`,
          sharedBodyKey: 'body_x',
          hook: 'Si te pasa esto, mira.',
          cta: 'Enlace en la bio.',
          scenes,
          subtitles: [{ start: 0, end: 3, text: 'Si te pasa esto, mira.' }],
          fullText: 'Si te pasa esto, mira. Mira cómo funciona de verdad. Enlace en la bio.',
          wordCount: 13,
          estSeconds: 11,
          tone: 'cercano',
          language: 'es',
        },
        guardrailFlags: [],
      },
    ],
  });

  return { variantId, personaId: persona.id, briefId: brief!.id, ownBedAssetId };
}

describe('buildVariantGenerationPlan (T4.11 pass 2b-ii)', () => {
  it('PREMIUM: resuelve endpoints del recipe + triple de voz + imagen de persona; NO fija punteros cross-node', async () => {
    const { variantId, briefId } = await seedVariant('premium');

    const plan = await buildVariantGenerationPlan({ db: tdb.db }, { variantId });

    expect(plan.variantId).toBe(variantId);
    expect(plan.n6Config).toEqual({ variantId });

    // N7a · shots: ruta ai_packshot + briefId del lote (NO sale del recipe — asimetría flux-2).
    expect(plan.n7aConfig).toEqual({ route: 'ai_packshot', briefId });

    // N7b · voz: endpoint TTS premium + provider+voiceId del voice_map + idioma + scriptId REAL.
    const n7b = plan.n7bConfig as {
      ttsEndpoint: string;
      provider: string;
      voice: string;
      language: string;
      scriptId: string;
    };
    expect(n7b.ttsEndpoint).toBe('fal-ai/elevenlabs/tts/eleven-v3');
    expect(n7b.provider).toBe('elevenlabs');
    expect(n7b.voice).toBe('rachel_v3');
    expect(n7b.language).toBe('es');
    expect(n7b.scriptId).toBeTruthy();

    // N7c · avatar: endpoint premium + imagen primaria de la persona. audioAssetId NO se fija (dep-derivado).
    const n7c = plan.n7cConfig as {
      avatarEndpoint: string;
      imageAssetId: string;
      audioAssetId?: string;
    };
    expect(n7c.avatarEndpoint).toBe('fal-ai/bytedance/omnihuman/v1.5');
    expect(n7c.imageAssetId).toBeTruthy();
    expect(n7c.audioAssetId).toBeUndefined(); // el audio del hook lo deriva el executor de su dep N7b

    // N7d · b-roll: endpoint premium (i2v) + scriptId. imageAssetIds NO se fija (keyframes dep-derivados).
    const n7d = plan.n7dConfig as {
      brollEndpoint: string;
      scriptId: string;
      imageAssetIds?: string[];
    };
    expect(n7d.brollEndpoint).toBe('fal-ai/veo3.1/image-to-video');
    expect(n7d.imageAssetIds).toBeUndefined();

    // N7f · CLIP DE CTA (T5.5a): REUSA el endpoint i2v del b-roll (`ctaEndpoint`), + scriptId. Es la
    // generación de la escena `cta` (product shot animado): sin ella el planner dejaba la CTA sin clip.
    // imageAssetIds NO se fija (keyframes de N7a dep-derivados, como N7d).
    const n7f = plan.n7fConfig as {
      ctaEndpoint: string;
      scriptId: string;
      imageAssetIds?: string[];
    };
    expect(n7f.ctaEndpoint).toBe('fal-ai/veo3.1/image-to-video');
    expect(n7f.scriptId).toBeTruthy();
    expect(n7f.imageAssetIds).toBeUndefined();

    // N7e · música: endpoint constante ace-step + duración de la variante.
    const n7e = plan.n7eConfig as { musicEndpoint: string; durationSeconds: number };
    expect(n7e.musicEndpoint).toBe('fal-ai/ace-step');
    expect(n7e.durationSeconds).toBe(30);
  });

  it('N7f: un guion SIN escena cta → el plan NO incluye n7fConfig (nada que animar)', async () => {
    // Guion hook + body, sin cta: N7f no se emite (a diferencia de N7d, que solo mira el endpoint). El
    // resto de ramas (voz/avatar/broll/música) siguen presentes — solo cae la de CTA.
    const { variantId } = await seedVariant('premium', [
      {
        t: 0,
        seconds: 3,
        segment: 'hook',
        narration: 'Si te pasa esto, mira.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 3,
        seconds: 6,
        segment: 'body',
        narration: 'Mira cómo funciona de verdad.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
    ]);

    const plan = await buildVariantGenerationPlan({ db: tdb.db }, { variantId });

    expect(plan.n7fConfig).toBeUndefined();
    // Control: el b-roll (mismo endpoint) SÍ sigue presente — el gate de N7f es la escena cta, no el endpoint.
    expect(plan.n7dConfig).toBeDefined();
  });

  it('MONEY-GATE: tier con broll ETIQUETA (test) → PermanentStepError ANTES de devolver el plan', async () => {
    const { variantId } = await seedVariant('test');

    // El broll de tier test es 'Grok Imagine / Wan 2.6 Flash [endpoint pendiente F4]' — no resoluble por
    // getModelProfileByEndpoint → el builder LANZA (no inventa un endpoint que gastaría en el modelo malo).
    await expect(buildVariantGenerationPlan({ db: tdb.db }, { variantId })).rejects.toThrow(
      PermanentStepError,
    );
  });

  it('CONTROL POSITIVO del money-gate: premium (broll resoluble) NO lanza — el gate no es tautológico', async () => {
    const { variantId } = await seedVariant('premium');
    // Si premium tampoco resolviera, el test de arriba pasaría por la razón equivocada. Aquí se confirma
    // que el gate SOLO muerde en el tier con etiqueta, no siempre.
    await expect(buildVariantGenerationPlan({ db: tdb.db }, { variantId })).resolves.toBeDefined();
  });

  // ── BED MUSICAL PROPIO (T6.2b, §14 `own_license`) ─────────────────────────────────────────────────────
  it('BED PROPIO (own_license): el plan OMITE n7eConfig y declara providedMusicBedAssetId', async () => {
    // La aserción clave del CONTROL NEGATIVO de T6.2b: una variante con bed propio NO emite N7e. Se pinea el
    // SALTO (`n7eConfig` ausente) — no solo el asset resultante — porque con «el bed propio gana» en el
    // ensamblador, revertir el salto dejaría el máster correcto y este test se quedaría verde por accidente.
    const { variantId, ownBedAssetId } = await seedVariant('premium', DEFAULT_SEED_SCENES, {
      ownMusicBed: true,
    });

    const plan = await buildVariantGenerationPlan({ db: tdb.db }, { variantId });

    // N7e NO se genera: el bed lo pone el usuario.
    expect(plan.n7eConfig).toBeUndefined();
    // El plan DECLARA el bed propio (entrega 3): apunta al asset subido.
    expect(plan.providedMusicBedAssetId).toBe(ownBedAssetId);
    // Control: el resto del sub-DAG de generación sigue intacto (solo cae N7e).
    expect(plan.n7bConfig).toBeDefined();
    expect(plan.n7cConfig).toBeDefined();
    expect(plan.n7dConfig).toBeDefined();
  });

  it('BED PROPIO en tier con broll ETIQUETA (test): SALTA también el money-gate de música (no lanza por N7e)', async () => {
    // El bed propio salta TANTO n7eConfig como el assertEndpointResolvable del endpoint de música: exigir que
    // ace-step resuelva no tiene sentido si no se genera música. Aun así el broll-etiqueta de tier test SIGUE
    // lanzando (su money-gate es independiente) — así se prueba que el salto de N7e es específico, no un
    // apagado global de los gates. Se afirma que el mensaje NO es por música.
    const { variantId } = await seedVariant('test', DEFAULT_SEED_SCENES, { ownMusicBed: true });

    await expect(buildVariantGenerationPlan({ db: tdb.db }, { variantId })).rejects.toThrow(
      /N7d \(b-roll\)/,
    );
  });

  it('variante inexistente → PermanentStepError', async () => {
    await expect(
      buildVariantGenerationPlan({ db: tdb.db }, { variantId: newUlid() }),
    ).rejects.toThrow(PermanentStepError);
  });

  it('sanity: la variante sembrada existe y es scripted', async () => {
    const { variantId } = await seedVariant('premium');
    const v = await getVariant(tdb.db, variantId);
    expect(v?.status).toBe('scripted');
  });
});
