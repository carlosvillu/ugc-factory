// Unit de la resolución CONFIG → MATRIZ + COSTE (T2.3): la función que usan el executor de N4, el
// endpoint de estimación de CP2 y el efecto de dominio que crea el lote. Es donde se prueba que
// **lo que se estima es lo que se crea** y que el MODO de persona (§11) no rompe la economía del
// hook-testing.
//
// Las recetas son las REALES (`RECIPE_SEEDS`, Apéndice B verbatim): un test contra una receta de
// juguete probaría un estimador que nadie ejecuta (principio 9 de testing).
import { describe, expect, it } from 'vitest';
import { makeAngle, makeBrief } from '@ugc/test-utils';
import type { BatchConfig } from '../contracts/batch-config';
import { HOOK_LINE_SEEDS, RECIPE_SEEDS } from '../library/seed-data';
import type { RecipeSeed, RecipeTier } from '../library/contracts';
import { defaultBatchConfig, planBatch } from './plan-batch';
import type { PlannablePersona } from './matrix';

const recipeOf = (tier: RecipeTier): RecipeSeed => {
  const found = RECIPE_SEEDS.find((r) => r.tier === tier);
  if (!found) throw new Error(`no hay receta de ${tier} en RECIPE_SEEDS`);
  return found;
};

/** Dos personas COMPATIBLES con el `avatar_hint` del brief de `makeBrief` («Creadora 30 años,
 *  estilo natural, baño luminoso»): con una sola, la rotación nunca se ejercita. */
const LUCIA: PlannablePersona = {
  id: 'per_lucia',
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural',
};
const ANA: PlannablePersona = {
  id: 'per_ana',
  name: 'Ana',
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 28 años, estilo natural',
};
/** Una persona que la regla de §11 DESCARTA para ese hint (hombre, urbano). */
const MATEO: PlannablePersona = {
  id: 'per_mateo',
  name: 'Mateo',
  ageRange: '35-44',
  gender: 'male',
  ethnicity: 'caucasian',
  style: 'urban',
  descriptor: 'hombre de 40 años, estilo urbano',
};

// Brief con 5 ángulos y 2 hook_examples cada uno (el default de `makeAngle`).
const BRIEF = makeBrief();

const CONFIG: BatchConfig = {
  angleIndices: [0, 1],
  hooksPerAngle: 2,
  objective: 'hook_test',
  tier: 'test',
  languages: ['es'],
  personaMode: 'rotate',
};

const plan = (config: Partial<BatchConfig> = {}, personas: PlannablePersona[] = [LUCIA, ANA]) =>
  planBatch({
    brief: BRIEF,
    config: { ...CONFIG, ...config },
    libraryHooks: HOOK_LINE_SEEDS,
    personas,
    recipe: recipeOf(config.tier ?? CONFIG.tier),
  });

describe('planBatch', () => {
  it('compone la matriz de la config: ángulos × hooks × idiomas', () => {
    // 2 ángulos × 2 hooks × 2 idiomas = 8 variantes.
    const { plan: p } = plan({ languages: ['es', 'en'] });
    expect(p.variants).toHaveLength(8);
    expect(p.languages).toEqual(['es', 'en']);
    expect(p.objective).toBe('hook_test');
    expect(p.durationTargetSeconds).toBe(12); // el preset de hook_test (§8.4), no un número del mockup
  });

  it('el coste sale de la RECETA del tier: cambiar de test a standard lo sube', () => {
    const cheap = plan({ tier: 'test' });
    const pricey = plan({ tier: 'standard' });

    // El ancla, comprobada A MANO contra el Apéndice B: una variante aislada de 12 s cuesta
    // recipe(30 s) × 12/30. Test: 30–170 ¢ → 12–68 ¢. Standard: 180–500 ¢ → 72–200 ¢.
    expect(cheap.estimate.standaloneVariant).toEqual({ minCents: 12, maxCents: 68 });
    expect(pricey.estimate.standaloneVariant).toEqual({ minCents: 72, maxCents: 200 });
    expect(pricey.estimate.total.maxCents).toBeGreaterThan(cheap.estimate.total.maxCents);
    // Y el TIER del estimado es el que se pidió (no el de una receta de otro tier).
    expect(pricey.estimate.tier).toBe('standard');
  });

  it('el desglose SUMA el total (ningún céntimo se inventa al repartir)', () => {
    const { estimate } = plan({ tier: 'standard', languages: ['es', 'en'] });
    const sumLines = estimate.lineItems.reduce(
      (acc, li) => ({
        minCents: acc.minCents + li.cost.minCents,
        maxCents: acc.maxCents + li.cost.maxCents,
      }),
      { minCents: 0, maxCents: 0 },
    );
    expect(sumLines).toEqual(estimate.total);

    const sumVariants = Object.values(estimate.perVariant).reduce(
      (acc, v) => ({
        minCents: acc.minCents + v.minCents,
        maxCents: acc.maxCents + v.maxCents,
      }),
      { minCents: 0, maxCents: 0 },
    );
    expect(sumVariants).toEqual(estimate.total);
  });

  describe('modo de persona (§11)', () => {
    it('`fixed` pone LA MISMA persona en todas las variantes', () => {
      const { plan: p } = plan({ personaMode: 'fixed', personaId: 'per_ana' });
      expect(p.personaSelection).toBe('matched');
      expect(new Set(p.variants.map((v) => v.personaName))).toEqual(new Set(['Ana']));
    });

    it('`rotate` reparte las candidatas compatibles y DESCARTA a las que no lo son', () => {
      const { plan: p } = plan({ angleIndices: [0, 1, 2] }, [LUCIA, ANA, MATEO]);
      const names = new Set(p.variants.map((v) => v.personaName));
      // Mateo NO casa con el `avatar_hint` del segmento: no aparece en ninguna variante.
      expect(names.has('Mateo')).toBe(false);
      expect(names).toEqual(new Set(['Lucía', 'Ana']));
    });

    it('`none` deja las variantes sin persona y lo DECLARA (no las inventa)', () => {
      const { plan: p } = plan({ personaMode: 'none' });
      expect(p.personaSelection).toBe('no_personas');
      expect(p.variants.every((v) => v.personaName === null)).toBe(true);
    });

    it('con la librería llena pero NINGUNA compatible, el plan dice `no_match`', () => {
      const { plan: p } = plan({}, [MATEO]);
      expect(p.personaSelection).toBe('no_match');
    });

    it('`rotate` en hook_test NO rompe la dedup del body: 4 variantes por ángulo, 1 body', () => {
      // LA ECONOMÍA (§16.1). 1 ángulo × 3 hooks × 1 idioma, DOS candidatas: si la cara rotara por
      // hook, cada variante tendría su propio body y el estimador cobraría 3 bodies en vez de 1.
      const { plan: p, estimate } = plan({ angleIndices: [0], hooksPerAngle: 3 });
      expect(p.variants).toHaveLength(3);
      const bodies = new Set(p.variants.map((v) => v.segmentKeys.body));
      expect(bodies.size).toBe(1); // UN body para las tres variantes
      // 3 hooks + 1 body + 1 cta = 5 partidas facturadas (no 9).
      expect(estimate.lineItems).toHaveLength(5);
    });
  });

  describe('filename_code', () => {
    it('sin `batchDiscriminator` los códigos son únicos DENTRO del plan (preview)', () => {
      const { plan: p } = plan({ angleIndices: [0, 1, 2], languages: ['es', 'en'] });
      const codes = p.variants.map((v) => v.filenameCode);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('CON `batchDiscriminator` dos lotes de la MISMA config NO colisionan (el UNIQUE global)', () => {
      const args = {
        brief: BRIEF,
        config: CONFIG,
        libraryHooks: HOOK_LINE_SEEDS,
        personas: [LUCIA, ANA],
        recipe: recipeOf('test'),
      };
      const a = planBatch({ ...args, batchDiscriminator: '01JBATCHAAAAAAAAAAAAAAAAAA' });
      const b = planBatch({ ...args, batchDiscriminator: '01JBATCHBBBBBBBBBBBBBBBBBB' });

      const codesA = a.plan.variants.map((v) => v.filenameCode);
      const codesB = b.plan.variants.map((v) => v.filenameCode);
      // Sin discriminante estos dos planes serían IDÉNTICOS y el 2.º INSERT reventaría contra el
      // UNIQUE GLOBAL de `ad_variant.filename_code` (§12) — justo al confirmar el gasto.
      expect(new Set([...codesA, ...codesB]).size).toBe(codesA.length + codesB.length);
    });
  });

  it('una config imposible NO produce un lote de $0: lanza', () => {
    // Un ángulo SIN hook_examples y sin líneas de librería para su framework: la matriz quedaría
    // vacía. El estimador es la última defensa antes de aprobar un gasto — rechaza, no inventa.
    const empty = makeBrief({
      angles: Array.from({ length: 5 }, (_u, i) =>
        makeAngle({ name: `Ángulo ${String(i + 1)}`, hook_examples: [] }),
      ),
    });
    expect(() =>
      planBatch({
        brief: empty,
        config: { ...CONFIG, languages: ['fr'] },
        libraryHooks: HOOK_LINE_SEEDS,
        personas: [],
        recipe: recipeOf('test'),
      }),
    ).toThrow(/matriz quedaría vacía|no produjo hooks/i);
  });
});

describe('defaultBatchConfig', () => {
  it('propone el lote CONSERVADOR: 3 ángulos × 2 hooks, hook_test, tier test', () => {
    const config = defaultBatchConfig(BRIEF, ['es']);
    expect(config).toEqual({
      angleIndices: [0, 1, 2],
      hooksPerAngle: 2,
      objective: 'hook_test',
      tier: 'test',
      languages: ['es'],
      personaMode: 'rotate',
    });
  });

  it('nunca propone más ángulos de los que el brief tiene', () => {
    const short = makeBrief({ angles: [makeAngle(), makeAngle({ name: 'Otro' })] });
    expect(defaultBatchConfig(short, ['es']).angleIndices).toEqual([0, 1]);
  });
});
