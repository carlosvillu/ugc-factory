// Test del VALIDADOR DE SEEDS (T2.1) — y, sobre todo, EL TEST QUE VALIDA LA LIBRERÍA REAL.
//
// Corre dentro de `pnpm test` → `pnpm gate`. Es lo que hace verdadera la Entrega
// "validador de seeds integrado en `pnpm gate`": no valida un fixture de juguete, valida
// `SEED_LIBRARY` —los ~80 hooks, ~30 CTAs y las 3 recetas que `pnpm seed` inserta— de modo
// que meter un hook de 13 palabras en `seed-data.ts` pone el gate ROJO.
//
// PRINCIPIO 9 DE LA SKILL testing (el arnés nunca más cómodo que la realidad): los fixtures
// inválidos de aquí son inválidos POR LA RAZÓN REAL — un hook de trece palabras de verdad
// (contadas), una receta a la que le FALTA el campo de coste — no objetos sintéticos que el
// validador rechace por otro motivo. Y cada uno lleva su control positivo al lado (el mismo
// objeto, arreglado, pasa): un test que no has visto fallar no sabes si muerde.
import { describe, expect, it } from 'vitest';
import { MAX_HOOK_WORDS, countWords } from '../analyze/brief-validator';
import { KNOWN_PLACEHOLDERS, countRenderedWords, findPlaceholders } from './placeholders';
import { CTA_LINE_SEEDS, HOOK_LINE_SEEDS, RECIPE_SEEDS, SEED_LIBRARY } from './seed-data';
import { validateSeeds } from './seed-validator';

// Los números del Apéndice B, ESCRITOS A MANO AQUÍ como oráculo independiente: si alguien
// edita un coste en seed-data.ts, este test es quien lo caza. Leerlos del propio seed sería
// comprobar que 1 = 1.
const APPENDIX_B_COGS_CENTS: Record<string, [number, number]> = {
  test: [30, 170], // $0,3–1,7
  standard: [180, 500], // $1,8–5
  premium: [900, 1300], // $9–13
};

describe('la librería REAL que siembra `pnpm seed`', () => {
  it('pasa el validador entero (control positivo del gate)', () => {
    const result = validateSeeds(SEED_LIBRARY);
    // Mensaje útil si algún día se rompe: el gate dice EXACTAMENTE qué línea está mal.
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('cubre ~40 hooks y ~15 CTAs POR IDIOMA (es/en), según la Entrega de T2.1', () => {
    for (const language of ['es', 'en'] as const) {
      const hooks = HOOK_LINE_SEEDS.filter((h) => h.language === language);
      const ctas = CTA_LINE_SEEDS.filter((c) => c.language === language);
      expect(hooks.length).toBeGreaterThanOrEqual(40);
      expect(ctas.length).toBeGreaterThanOrEqual(15);
    }
  });

  it('ningún hook supera MAX_HOOK_WORDS en su PEOR CASO RENDERIZADO (techo DURO)', () => {
    // El assert que importa: no basta con que la PLANTILLA quepa — tiene que caber lo que el
    // espectador oye, con los placeholders ya sustituidos por su presupuesto de palabras.
    const tooLong = HOOK_LINE_SEEDS.filter((h) => countRenderedWords(h.text) > MAX_HOOK_WORDS).map(
      (h) => `${String(countRenderedWords(h.text))}w: ${h.text}`,
    );
    expect(tooLong).toEqual([]);
  });

  it('todos los placeholders de la librería son CONOCIDOS (el renderizador sabe resolverlos)', () => {
    // Este test barría la librería POR SU CUENTA con `findPlaceholders`, y por eso no
    // detectó que `validateSeeds` —el único código que `pnpm seed` ejecuta de verdad antes
    // de escribir— solo miraba los hooks: el arnés guardaba una puerta por la que el dato no
    // entraba. Ahora asserta sobre el MISMO camino que corre en producción; el barrido
    // independiente queda como red de seguridad, no como el único guardián.
    const viaValidator = validateSeeds({
      hooks: HOOK_LINE_SEEDS,
      ctas: CTA_LINE_SEEDS,
      recipes: RECIPE_SEEDS,
    }).issues.filter((i) => i.code === 'unknown_placeholder');
    expect(viaValidator).toEqual([]);

    const unknown = HOOK_LINE_SEEDS.flatMap((h) => findPlaceholders(h.text))
      .concat(CTA_LINE_SEEDS.flatMap((c) => findPlaceholders(c.text)))
      .filter((p) => !KNOWN_PLACEHOLDERS.includes(p));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('todos los ángulos de la taxonomía tienen hooks en los DOS idiomas', () => {
    // El compositor de matriz (T2.2) elige hooks POR ángulo Y POR idioma: un ángulo sin
    // hooks en `en` produciría un lote bilingüe cojo, en silencio.
    const angles = new Set(HOOK_LINE_SEEDS.map((h) => h.angle));
    for (const angle of angles) {
      for (const language of ['es', 'en'] as const) {
        const hooks = HOOK_LINE_SEEDS.filter((h) => h.angle === angle && h.language === language);
        expect(hooks.length, `${angle}/${language}`).toBeGreaterThan(0);
      }
    }
  });

  it('los tres objetivos de lote tienen CTAs en los dos idiomas', () => {
    for (const objective of ['hook_test', 'conversion', 'story'] as const) {
      for (const language of ['es', 'en'] as const) {
        const ctas = CTA_LINE_SEEDS.filter(
          (c) => c.objective === objective && c.language === language,
        );
        expect(ctas.length, `${objective}/${language}`).toBeGreaterThan(0);
      }
    }
  });

  it('el es y el en NO son traducción literal uno del otro (§17: redacción nativa)', () => {
    // Falsable de verdad: si alguien "traduce" la lista, los ángulos coincidirían 1:1 en
    // orden y cantidad exacta y el recuento por ángulo sería idéntico. Lo que se exige es
    // que las librerías estén escritas por separado; el proxy observable más honesto es que
    // las distribuciones por ángulo NO sean idénticas posición a posición.
    const es = HOOK_LINE_SEEDS.filter((h) => h.language === 'es').map((h) => h.text);
    const en = HOOK_LINE_SEEDS.filter((h) => h.language === 'en').map((h) => h.text);
    expect(new Set(es).size).toBe(es.length); // sin duplicados internos
    expect(new Set(en).size).toBe(en.length);
    expect(es.some((t) => en.includes(t))).toBe(false); // ninguna línea compartida
  });

  it('las 3 recetas cuadran con el Apéndice B (rango exacto, en céntimos enteros)', () => {
    expect(RECIPE_SEEDS).toHaveLength(3);
    for (const recipe of RECIPE_SEEDS) {
      const expected = APPENDIX_B_COGS_CENTS[recipe.tier];
      expect(expected, `tier desconocido: ${recipe.tier}`).toBeDefined();
      expect([recipe.estCost30sMinCents, recipe.estCost30sMaxCents]).toEqual(expected);
      // Los 4 componentes del Apéndice B (Avatar / B-roll / Voz / Shots).
      expect(recipe.steps.map((s) => s.component).sort()).toEqual([
        'avatar',
        'broll',
        'shots',
        'voice',
      ]);
    }
  });
});

describe('validateSeeds: los fixtures INVÁLIDOS que la Verificación nombra', () => {
  // Base VÁLIDA: la librería real, mínima. Cada test la ROMPE por UNA razón concreta y
  // comprueba el rojo; el control positivo (la misma base intacta) está arriba.
  function first<T>(items: T[], label: string): T {
    const item = items[0];
    if (item === undefined) throw new Error(`${label}: la librería real está vacía`);
    return item;
  }

  const validHook = first(HOOK_LINE_SEEDS, 'hooks');
  const validCta = first(CTA_LINE_SEEDS, 'ctas');
  const firstRecipe = first(RECIPE_SEEDS, 'recipes');
  const restRecipes = RECIPE_SEEDS.slice(1);

  function baseLibrary() {
    return {
      hooks: [{ ...validHook }] as unknown[],
      ctas: [{ ...validCta }] as unknown[],
      recipes: RECIPE_SEEDS.map((r) => ({ ...r })) as unknown[],
    };
  }

  it('control positivo: la base intacta pasa', () => {
    expect(validateSeeds(baseLibrary()).ok).toBe(true);
  });

  it('HOOK SIN ÁNGULO → rojo con `hook_missing_angle`', () => {
    const library = baseLibrary();
    // Inválido POR LA RAZÓN REAL: al objeto le FALTA la clave `angle` (no es un ángulo
    // "raro" ni un objeto sintético; es exactamente lo que ocurriría si alguien pegara una
    // línea nueva en seed-data.ts y se olvidara del ángulo).
    const { angle: _angle, ...withoutAngle } = validHook;
    library.hooks = [withoutAngle];

    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('hook_missing_angle');
    expect(result.library).toBeUndefined(); // nada que insertar: el seed no debe tocar la BD
  });

  it('HOOK DE MÁS DE 12 PALABRAS → rojo con `hook_too_long`', () => {
    const library = baseLibrary();
    // Un hook de TRECE palabras REALES (no un string sintético): frase natural en español,
    // contada por el mismo `countWords` que usa el sistema.
    const thirteenWords = 'Te voy a contar por qué este producto me ha cambiado la vida';
    expect(countWords(thirteenWords)).toBe(MAX_HOOK_WORDS + 1); // el fixture ES lo que dice ser
    library.hooks = [{ ...validHook, text: thirteenWords }];

    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'hook_too_long');
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('13 palabras');
  });

  it('PLANTILLA con placeholder: el techo se mide sobre el PEOR CASO RENDERIZADO', () => {
    // EL HALLAZGO DEL PASE DE REVIEW. Esta plantilla tiene 10 palabras LITERALES (pasaría un
    // conteo ingenuo) pero `{pain}` se sustituye por el dolor REAL del brief («la piel tira
    // después de lavarla»), y lo que el espectador OYE —lo que tiene que caber en los 0–3 s—
    // son 15 palabras. El techo debe morder AQUÍ, no en el render.
    const template = 'Deja de gastar dinero en cosas que no arreglan {pain}.';
    expect(countWords(template)).toBe(10); // conteo literal: pasaría
    expect(countRenderedWords(template)).toBe(15); // peor caso renderizado: NO pasa

    const library = baseLibrary();
    library.hooks = [{ ...validHook, text: template }];
    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'hook_too_long');
    expect(issue?.message).toContain('15 palabras renderizadas');
  });

  it('placeholder DESCONOCIDO en un HOOK → rojo (llegaría literal al anuncio)', () => {
    const library = baseLibrary();
    library.hooks = [{ ...validHook, text: 'Si te pasa {problema}, mira esto.' }];
    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'unknown_placeholder');
    expect(issue?.entity).toBe('hook_line');
  });

  it('placeholder DESCONOCIDO en una CTA → rojo (el contrato de plantilla es de la LÍNEA, no del hook)', () => {
    // La CTA es interpolable igual que el hook (§12) y la librería sembrada mete
    // {product}/{pain} en varias. Mientras el chequeo vivió solo en la rama de hooks, esta
    // CTA pasaba el validador con ok=true, `pnpm seed` la insertaba, y T2.4 habría escupido
    // "{producto_inventado}" LITERAL dentro del anuncio.
    const library = baseLibrary();
    library.ctas = [{ ...validCta, text: 'Pruébalo y olvídate de {producto_inventado}.' }];
    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'unknown_placeholder');
    expect(issue?.entity).toBe('cta_line');
  });

  it('una CTA LARGA con placeholders conocidos pasa: el techo de 12 palabras es del HOOK, no de la CTA', () => {
    // El mecanismo compartido es el VOCABULARIO de placeholders, no el techo: los 0–3 s de
    // gancho son una restricción del hook. Fundir ambas cosas habría rechazado CTAs legítimas.
    const library = baseLibrary();
    library.ctas = [
      {
        ...validCta,
        text: 'Entra hoy en la web, mira las opiniones y pide tu {product} con envío gratis.',
      },
    ];
    expect(validateSeeds(library).ok).toBe(true);
  });

  it('el hook de EXACTAMENTE 12 palabras pasa (el techo es inclusivo)', () => {
    const library = baseLibrary();
    const twelveWords = 'Te cuento por qué este producto me ha cambiado la vida entera';
    expect(countWords(twelveWords)).toBe(MAX_HOOK_WORDS);
    library.hooks = [{ ...validHook, text: twelveWords }];
    expect(validateSeeds(library).ok).toBe(true);
  });

  it('RECETA SIN COSTE → rojo con `recipe_missing_cost`', () => {
    const library = baseLibrary();
    // Inválida POR LA RAZÓN REAL: a la receta le FALTAN los campos de coste (es lo que
    // pasaría si T3.4 recalibrara mal, o si alguien añadiera un tier sin cotizarlo).
    const { estCost30sMinCents: _min, estCost30sMaxCents: _max, ...withoutCost } = firstRecipe;
    library.recipes = [withoutCost, ...restRecipes.map((r) => ({ ...r }))];

    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('recipe_missing_cost');
  });

  it('receta con coste 0 también es "sin coste" (el estimador no puede cotizar con 0)', () => {
    const library = baseLibrary();
    library.recipes = [
      { ...firstRecipe, estCost30sMinCents: 0, estCost30sMaxCents: 0 },
      ...restRecipes.map((r) => ({ ...r })),
    ];
    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('recipe_missing_cost');
  });

  it('falta un tier → rojo con `recipe_tier_coverage` (el Apéndice B define los 3)', () => {
    const library = baseLibrary();
    library.recipes = RECIPE_SEEDS.filter((r) => r.tier !== 'premium').map((r) => ({ ...r }));
    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === 'recipe_tier_coverage');
    expect(issue?.where).toBe('premium');
  });

  it('rango invertido (min > max) → rojo', () => {
    const library = baseLibrary();
    library.recipes = [
      { ...firstRecipe, estCost30sMinCents: 170, estCost30sMaxCents: 30 },
      ...restRecipes.map((r) => ({ ...r })),
    ];
    expect(validateSeeds(library).ok).toBe(false);
  });

  it('línea duplicada en el mismo idioma → rojo (chocaría con el UNIQUE de la BD)', () => {
    const library = baseLibrary();
    library.hooks = [{ ...validHook }, { ...validHook }];
    const result = validateSeeds(library);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('duplicate_line');
  });

  it('acumula TODOS los problemas de una pasada, no solo el primero', () => {
    const library = baseLibrary();
    const { angle: _a, ...noAngle } = validHook;
    library.hooks = [
      noAngle,
      {
        ...validHook,
        text: 'una dos tres cuatro cinco seis siete ocho nueve diez once doce trece',
      },
    ];
    library.recipes = [];

    const result = validateSeeds(library);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('hook_missing_angle');
    expect(codes).toContain('hook_too_long');
    expect(codes.filter((c) => c === 'recipe_tier_coverage')).toHaveLength(3);
  });
});
