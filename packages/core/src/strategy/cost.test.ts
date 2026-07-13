// Unit del ESTIMADOR DE COSTE (T2.2) — y la protección permanente de la Verificación:
// «coste estimado desglosado que **cuadra a mano con las recetas del Apéndice B (±10 %)**».
//
// ⚠ SE USAN LAS RECETAS REALES (`RECIPE_SEEDS`, sembradas en T2.1 verbatim del Apéndice B),
// nunca una receta de juguete: el principio 9 de testing («el arnés nunca puede ser más cómodo
// que la realidad») aplica con violencia aquí — un estimador probado contra una receta
// fabricada a mano con números redondos NO prueba que cuadre con el Apéndice B, que es lo
// ÚNICO que la Verificación mira.
//
// LOS NÚMEROS DEL APÉNDICE B, escritos aquí a mano DESDE EL PRD (no desde el código): son la
// FUENTE contra la que se compara, y por eso se declaran aparte de `RECIPE_SEEDS`. Si alguien
// toca el seed y se desvía del Apéndice, este test lo caza — cosa que no haría si leyera el
// esperado del propio seed que está validando.
import { describe, expect, it } from 'vitest';
import { makeAngle, makeBrief } from '@ugc/test-utils';
import { HOOK_LINE_SEEDS, RECIPE_SEEDS } from '../library/seed-data';
import type { RecipeSeed, RecipeTier } from '../library/contracts';
import { matchPersonas } from '../persona/candidates';
import type { MatchablePersona } from '../persona/contracts';
import { estimateBatchCost } from './cost';
import { composeMatrix } from './matrix';
import { DURATION_PRESETS, MAX_EXPORT_SECONDS, RECIPE_ANCHOR_SECONDS } from './presets';

// DOS personas COMPATIBLES con el `avatar_hint` del brief. Es la configuración que expone el bug
// de dinero del review: con UNA sola candidata la rotación nunca se ejercita.
const LUCIA: MatchablePersona = {
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural',
};
const ANA: MatchablePersona = {
  name: 'Ana',
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 28 años, estilo natural',
};

/** El Apéndice B (PRD §23, tabla «COGS 30 s») + §16.1, EN CÉNTIMOS. Transcrito del PRD. */
const APPENDIX_B_30S_CENTS: Readonly<Record<RecipeTier, { min: number; max: number }>> = {
  test: { min: 30, max: 170 }, // $0,3–1,7
  standard: { min: 180, max: 500 }, // $1,8–5
  premium: { min: 900, max: 1300 }, // $9–13
};

function recipeFor(tier: RecipeTier): RecipeSeed {
  const recipe = RECIPE_SEEDS.find((r) => r.tier === tier);
  if (!recipe) throw new Error(`sin receta sembrada para el tier ${tier}`);
  return recipe;
}

const BRIEF = makeBrief({
  angles: [
    makeAngle({ name: 'El dolor de la piel tirante', framework: 'pain_point' }),
    makeAngle({ name: 'Lo que nadie te cuenta', framework: 'curiosity' }),
    makeAngle({ name: 'Miles ya lo usan', framework: 'social_proof' }),
    makeAngle({ name: 'La fundadora lo cuenta', framework: 'founder_story' }),
    makeAngle({ name: 'Antes y después', framework: 'transformation' }),
  ],
});

// La librería REAL sembrada en T2.1: los ángulos del brief traen 2 `hook_examples` cada uno, y
// la Verificación pide 3 hooks por ángulo — el tercero sale de la librería. Sin pasarla, la
// matriz saldría con 2 hooks por ángulo y el test estaría midiendo otra cosa.
const BASE = {
  brief: BRIEF,
  libraryHooks: HOOK_LINE_SEEDS,
  personas: [],
  tier: 'standard' as const,
};

/** ±10 %: la tolerancia LITERAL de la Verificación del planning. */
function expectWithin10Percent(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(expected * 0.1);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL ANCLA: a 30 segundos, el estimador ES el Apéndice B
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('el ancla del Apéndice B (30 s)', () => {
  it.each(['test', 'standard', 'premium'] as const)(
    'tier %s: una variante suelta a 30 s cuesta EXACTAMENTE la horquilla del Apéndice B',
    (tier) => {
      // El preset de conversión son 30 s (§8.4: 21–34 s) — la duración a la que el Apéndice B
      // tabula su COGS. A esa duración el factor de escalado es 1 y el estimador NO puede
      // desviarse ni un céntimo de la receta.
      const plan = composeMatrix({
        ...BASE,
        tier,
        angleCount: 1,
        hooksPerAngle: 2,
        languages: ['es'],
        objective: 'conversion',
      });
      expect(plan.durationTargetSeconds).toBe(RECIPE_ANCHOR_SECONDS);

      const est = estimateBatchCost(plan, recipeFor(tier));
      const apendiceB = APPENDIX_B_30S_CENTS[tier];

      // Contra el PRD (la FUENTE), no contra el seed ni contra el propio estimador.
      expect(est.standaloneVariant).toEqual({
        minCents: apendiceB.min,
        maxCents: apendiceB.max,
      });
      expectWithin10Percent(est.standaloneVariant.minCents, apendiceB.min);
      expectWithin10Percent(est.standaloneVariant.maxCents, apendiceB.max);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// LA VERIFICACIÓN LITERAL DEL PLANNING
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('la Verificación de T2.2: 2 ángulos × 3 hooks × 1 persona × es+en = 12 variantes', () => {
  const plan = composeMatrix({
    ...BASE,
    angleCount: 2,
    hooksPerAngle: 3,
    languages: ['es', 'en'],
    objective: 'conversion',
  });
  const recipe = recipeFor('standard');
  const est = estimateBatchCost(plan, recipe);

  it('el coste del lote cuadra con el Apéndice B: 12 variantes × la horquilla de 30 s (±10 %)', () => {
    // «Cuadrar a mano con las recetas del Apéndice B»: en modo conversión NADA se comparte
    // (§7.2 N5: «1 guion por variante»), así que el lote son 12 anuncios independientes de 30 s.
    // La cuenta a mano: 12 × $1,80 = $21,60 (mín) · 12 × $5 = $60 (máx).
    const apendiceB = APPENDIX_B_30S_CENTS.standard;
    expectWithin10Percent(est.total.minCents, 12 * apendiceB.min);
    expectWithin10Percent(est.total.maxCents, 12 * apendiceB.max);
    // A 30 s el escalado es exacto, así que además de cuadrar ±10 % cuadra al céntimo.
    expect(est.total).toEqual({ minCents: 12 * apendiceB.min, maxCents: 12 * apendiceB.max });
  });

  it('EL DESGLOSE ES EL TOTAL: las partidas suman el total, al CÉNTIMO (sin partidas fantasma)', () => {
    // Céntimos ENTEROS: la igualdad es exacta (`toBe`), no aproximada. Un desglose que no suma
    // su total es un desglose que miente — es la partida que se paga y nadie ve.
    const sumMin = est.lineItems.reduce((s, li) => s + li.cost.minCents, 0);
    const sumMax = est.lineItems.reduce((s, li) => s + li.cost.maxCents, 0);
    expect(sumMin).toBe(est.total.minCents);
    expect(sumMax).toBe(est.total.maxCents);
    expect(Number.isInteger(est.total.minCents)).toBe(true);
    expect(Number.isInteger(est.total.maxCents)).toBe(true);
  });

  it('el desglose POR VARIANTE también suma el total (ningún céntimo se pierde al imputar)', () => {
    const perVariant = Object.values(est.perVariant);
    expect(perVariant).toHaveLength(12);
    expect(perVariant.reduce((s, v) => s + v.minCents, 0)).toBe(est.total.minCents);
    expect(perVariant.reduce((s, v) => s + v.maxCents, 0)).toBe(est.total.maxCents);
    // En conversión cada variante paga su anuncio entero: la horquilla de la receta, exacta.
    for (const cost of perVariant) {
      expect(cost).toEqual(est.standaloneVariant);
    }
  });

  it('en conversión hay 36 partidas: 12 variantes × 3 segmentos, ninguna compartida', () => {
    expect(est.lineItems).toHaveLength(36);
    expect(est.lineItems.every((li) => li.variantFilenameCodes.length === 1)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL ESCALADO POR DURACIÓN — la decisión central de la tarea (ver la cabecera de `cost.ts`)
//
// ⚠ ESTE BLOQUE ES EL QUE MUERDE. La Verificación del planning corre a 30 s, donde el factor
// de escalado vale 1: si el escalado se rompiera, los tests de arriba seguirían VERDES. Aquí
// se prueba a 12 s y a 45 s, LEJOS del ancla, que es donde la regla `× (segundos / 30)` es
// observable. El control negativo de esta tarea se hizo contra este bloque.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('el escalado por duración: coste lineal en SEGUNDOS de vídeo generado (§16.1)', () => {
  function standaloneAt(objective: 'hook_test' | 'conversion' | 'story') {
    const plan = composeMatrix({
      ...BASE,
      angleCount: 1,
      hooksPerAngle: 1,
      languages: ['es'],
      objective,
    });
    return estimateBatchCost(plan, recipeFor('standard')).standaloneVariant;
  }

  it('un anuncio de 12 s (hook_test) cuesta 12/30 del de 30 s — §16.1: «a 15 s ≈ la mitad»', () => {
    // La regla del PRD («Variantes a 15 s ≈ mitad de los valores de 30 s») comprobada sobre el
    // estimador con el preset que SÍ existe (§8.4 no tiene 15 s): 12 s → 12/30 del coste.
    const apendiceB = APPENDIX_B_30S_CENTS.standard;
    const thirty = standaloneAt('conversion');
    const twelve = standaloneAt('hook_test');
    expect(DURATION_PRESETS.hook_test.targetSeconds).toBe(12);
    // A 30 s → la horquilla entera del Apéndice B (el ancla).
    expect(thirty).toEqual({ minCents: apendiceB.min, maxCents: apendiceB.max });
    // A 12 s → 12/30 de esa horquilla. Si el estimador ignorara la duración, aquí saldría la
    // horquilla entera y este assert se cae.
    expectWithin10Percent(twelve.minCents, (apendiceB.min * 12) / RECIPE_ANCHOR_SECONDS);
    expectWithin10Percent(twelve.maxCents, (apendiceB.max * 12) / RECIPE_ANCHOR_SECONDS);
    expect(twelve.minCents).toBeLessThan(thirty.minCents);
  });

  it('un anuncio de 45 s (storytelling) cuesta 1,5× el de 30 s — NO lo mismo', () => {
    // Si el estimador ignorara la duración (o escalara por nº de clips de §7.5 en vez de por
    // segundos), este assert es el que se cae.
    const apendiceB = APPENDIX_B_30S_CENTS.standard;
    const story = standaloneAt('story');
    const seconds = DURATION_PRESETS.story.targetSeconds;
    expect(seconds).toBe(45);
    expectWithin10Percent(story.minCents, (apendiceB.min * seconds) / RECIPE_ANCHOR_SECONDS);
    expectWithin10Percent(story.maxCents, (apendiceB.max * seconds) / RECIPE_ANCHOR_SECONDS);
    // Y la relación entre presets: 45 s cuesta 3,75× lo que 12 s (45/12), no lo mismo.
    const hookTest = standaloneAt('hook_test');
    expect(story.minCents).toBeGreaterThan(hookTest.minCents * 3);
  });

  it('el coste de los SEGMENTOS es proporcional a sus segundos (§7.5) y suma la variante', () => {
    const plan = composeMatrix({
      ...BASE,
      angleCount: 1,
      hooksPerAngle: 1,
      languages: ['es'],
      objective: 'story',
    });
    const est = estimateBatchCost(plan, recipeFor('standard'));
    // 1 variante, 3 segmentos: hook 10 s + body 30 s + cta 5 s (§7.5, `presets.ts`).
    expect(est.lineItems).toHaveLength(3);
    const bySegment = Object.fromEntries(est.lineItems.map((li) => [li.segment, li]));
    expect(bySegment.body?.seconds).toBe(30);
    // El body es 3× el hook en segundos → 3× en coste (±1 ¢ del reparto entero).
    const hookMin = bySegment.hook?.cost.minCents ?? 0;
    const bodyMin = bySegment.body?.cost.minCents ?? 0;
    expect(Math.abs(bodyMin - hookMin * 3)).toBeLessThanOrEqual(1);
    // Y los tres suman la variante, exacto.
    const sum = est.lineItems.reduce((s, li) => s + li.cost.minCents, 0);
    expect(sum).toBe(est.standaloneVariant.minCents);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// LA ECONOMÍA HOOK×BODY×CTA: pagar 5 clips para 3 anuncios (§7.2 N5/N7, §16.1)
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('hook-testing: los segmentos compartidos se cobran UNA vez (§7.2 N7, dedup)', () => {
  const plan = composeMatrix({
    ...BASE,
    angleCount: 1,
    hooksPerAngle: 3,
    languages: ['es'],
    objective: 'hook_test',
  });
  const est = estimateBatchCost(plan, recipeFor('standard'));

  it('3 hooks del mismo ángulo = 5 partidas (3 hooks + 1 body + 1 cta), no 9', () => {
    expect(plan.variants).toHaveLength(3);
    expect(est.lineItems).toHaveLength(5);
    expect(est.lineItems.filter((li) => li.segment === 'hook')).toHaveLength(3);
    expect(est.lineItems.filter((li) => li.segment === 'body')).toHaveLength(1);
    expect(est.lineItems.filter((li) => li.segment === 'cta')).toHaveLength(1);
    // La partida compartida declara a QUIÉN sirve: las 3 variantes.
    const body = est.lineItems.find((li) => li.segment === 'body');
    expect(body?.variantFilenameCodes).toHaveLength(3);
  });

  it('el lote CUESTA MENOS que 3 anuncios sueltos — y ese ahorro es la economía del PRD', () => {
    // 3 anuncios sueltos de 12 s pagarían 3 hooks + 3 bodies + 3 CTAs. Compartiendo, se pagan
    // 3 hooks + 1 body + 1 cta. El estimador tiene que REFLEJARLO o mentiría sobre el gasto que
    // CP2 confirma.
    const solo = est.standaloneVariant;
    expect(est.total.minCents).toBeLessThan(3 * solo.minCents);
    // Y no de cualquier manera: el ahorro es exactamente el de 2 bodies + 2 CTAs, que a 12 s
    // (hook 4 + body 6 + cta 2) son 2×(6+2)/12 = 4/3 de anuncio.
    const bodyPlusCta = (6 + 2) / 12;
    const expectedSaving = 2 * bodyPlusCta * solo.minCents;
    expectWithin10Percent(3 * solo.minCents - est.total.minCents, expectedSaving);
  });

  it('el desglose sigue sumando el total, y perVariant reparte el compartido sin perder céntimos', () => {
    const sum = est.lineItems.reduce((s, li) => s + li.cost.minCents, 0);
    expect(sum).toBe(est.total.minCents);
    const perVariantSum = Object.values(est.perVariant).reduce((s, v) => s + v.minCents, 0);
    expect(perVariantSum).toBe(est.total.minCents);
    // Cada anuncio cuesta MENOS que uno suelto: el body ya está pagado por sus hermanos.
    for (const cost of Object.values(est.perVariant)) {
      expect(cost.minCents).toBeLessThan(est.standaloneVariant.minCents);
    }
  });
});

describe('guardas del estimador', () => {
  it('estimar un lote con la receta de OTRO tier es un error, no un número silencioso', () => {
    const plan = composeMatrix({
      ...BASE,
      tier: 'premium',
      angleCount: 1,
      hooksPerAngle: 1,
      languages: ['es'],
      objective: 'conversion',
    });
    expect(() => estimateBatchCost(plan, recipeFor('test'))).toThrow(/tier/);
  });

  // §8.4: «Cap duro de export: 60 s». Antes del review, `MAX_EXPORT_SECONDS` estaba declarado y
  // NO LO CONSUMÍA NADIE: el cap existía solo como comentario. El estimador es la última defensa
  // antes de que el usuario apruebe un gasto — ante una duración imposible debe RECHAZARLA, no
  // traducirla a una cifra creíble (0 s daba «este lote te cuesta $0,00»).
  it('TODOS los presets de §8.4 caben bajo el cap duro de export (la doc es invariante, no prosa)', () => {
    for (const preset of Object.values(DURATION_PRESETS)) {
      expect(preset.targetSeconds).toBeGreaterThan(0);
      expect(preset.targetSeconds).toBeLessThanOrEqual(MAX_EXPORT_SECONDS);
    }
  });

  it.each([
    ['0 s (daría coste $0,00 en silencio)', 0],
    ['duración negativa (daría coste negativo)', -30],
    ['90 s, por encima del cap duro de 60 s de §8.4', 90],
  ])('un plan con %s se RECHAZA, no se costea', (_name, seconds) => {
    const plan = composeMatrix({
      ...BASE,
      angleCount: 1,
      hooksPerAngle: 1,
      languages: ['es'],
      objective: 'conversion',
    });
    // Un `BatchPlan` es un DOCUMENTO (viaja por `ad_batch.matrix` jsonb): puede llegar al
    // estimador con cualquier duración. Si el estimador se fiara del preset «de memoria», un plan
    // de 90 s se costearía como uno de 30 y cobraría de MENOS.
    const corrupted = { ...plan, durationTargetSeconds: seconds };
    expect(() => estimateBatchCost(corrupted, recipeFor('standard'))).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// EL BUG DE DINERO DEL CODE-REVIEW: la rotación de persona mataba la economía de hook-testing.
//
// La persona entra en `sharedScope`, que es LA CLAVE DE DEDUP del body/CTA. Rotando por hook, en
// `hook_test` cada hook recibía una cara distinta → el body dejaba de compartirse → 7 generaciones
// en vez de 5, y el estimador COBRABA DE MÁS.
//
// ⚠ POR QUÉ NINGÚN TEST LO CAZÓ: la Verificación usa UNA sola persona, y con una candidata
// `rotationIndex % 1 === 0` siempre. El bug vivía JUSTO DETRÁS del caso probado — el arnés era
// más cómodo que la realidad (principio 9). Estos tests usan DOS personas compatibles.
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('hook-testing con VARIAS personas compatibles: la dedup NO se rompe (§16.1)', () => {
  const TWO = { ...BASE, personas: [LUCIA, ANA] };

  it('con 2 personas compatibles, las 3 variantes de un ángulo COMPARTEN cara → 5 generaciones, no 7', () => {
    const plan = composeMatrix({
      ...TWO,
      angleCount: 1,
      hooksPerAngle: 3,
      languages: ['es'],
      objective: 'hook_test',
    });
    const est = estimateBatchCost(plan, recipeFor('standard'));

    // Las dos candidatas existen de verdad (si no, el test no probaría nada: sería el caso de 1).
    expect(matchPersonas([LUCIA, ANA], BRIEF.audience.segments[0]?.avatar_hint ?? '')).toHaveLength(
      2,
    );

    // (1) EN HOOK-TESTING LA CARA NO CAMBIA CON EL HOOK: las variantes de un ángulo deben diferir
    //     SOLO en el hook (§7.2 N5) — si cambia la cara, el A/B ya no mide el hook.
    expect(new Set(plan.variants.map((v) => v.personaName)).size).toBe(1);

    // (2) Y LA CONSECUENCIA DE DINERO: body y CTA siguen siendo UNA generación cada uno.
    expect(est.lineItems.filter((li) => li.segment === 'body')).toHaveLength(1);
    expect(est.lineItems.filter((li) => li.segment === 'cta')).toHaveLength(1);
    expect(est.lineItems).toHaveLength(5); // 3 hooks + 1 body + 1 cta. Con el bug: 7.
  });

  it('el ahorro sigue siendo real con 2 personas (el lote NO cuesta lo mismo que 3 sueltos)', () => {
    const plan = composeMatrix({
      ...TWO,
      angleCount: 1,
      hooksPerAngle: 3,
      languages: ['es'],
      objective: 'hook_test',
    });
    const est = estimateBatchCost(plan, recipeFor('standard'));
    // Con el bug, el total subía porque se pagaban 2 bodies y 2 CTAs de más.
    expect(est.total.minCents).toBeLessThan(3 * est.standaloneVariant.minCents);
  });

  it('el A/B de persona SIGUE EXISTIENDO: rota ENTRE ángulos (que es donde no contamina el hook)', () => {
    // La decisión (a): la cara rota por ángulo+idioma. Con 2 ángulos y 2 candidatas, los dos
    // ángulos reciben caras distintas — el A/B de persona no se pierde, se mueve a donde no rompe
    // ni la dedup ni el experimento del hook.
    const plan = composeMatrix({
      ...TWO,
      angleCount: 2,
      hooksPerAngle: 3,
      languages: ['es'],
      objective: 'hook_test',
    });
    const byAngle = new Map<number, Set<string | null>>();
    for (const v of plan.variants) {
      const faces = byAngle.get(v.angleIndex) ?? new Set();
      faces.add(v.personaName);
      byAngle.set(v.angleIndex, faces);
    }
    // Dentro de cada ángulo: UNA cara (la dedup se mantiene).
    for (const faces of byAngle.values()) expect(faces.size).toBe(1);
    // Entre ángulos: caras DISTINTAS (el A/B vive).
    const facesPerAngle = [...byAngle.values()].map((s) => [...s][0]);
    expect(new Set(facesPerAngle).size).toBe(2);
  });

  it('en modo NORMAL (conversion) la persona SÍ rota por variante: nada se comparte, no rompe nada', () => {
    // No se «arregla» de más: en conversion/story no hay dedup que proteger (§7.2 N5: «1 guion por
    // variante»), así que rotar la cara por variante es legítimo y da variedad al A/B.
    const plan = composeMatrix({
      ...TWO,
      angleCount: 1,
      hooksPerAngle: 3,
      languages: ['es'],
      objective: 'conversion',
    });
    expect(new Set(plan.variants.map((v) => v.personaName)).size).toBe(2);
    const est = estimateBatchCost(plan, recipeFor('standard'));
    expect(est.lineItems).toHaveLength(9); // 3 variantes × 3 segmentos, ninguna compartida
  });
});
