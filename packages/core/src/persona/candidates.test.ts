// Unit de la REGLA de recomendación por `avatar_hint` (T2.0). Es la mitad de la Verificación
// («el endpoint de candidatas devuelve la persona correcta para un `avatar_hint` compatible y
// NINGUNA para uno incompatible»): aquí se fija la regla; el test de integración del repo y el
// del route handler comprueban que el endpoint la aplica de verdad sobre la BD.
import { describe, expect, it } from 'vitest';
import { matchPersonas, parseAgeRange, scorePersona, tokenize } from './candidates';
import type { MatchablePersona } from './contracts';

// La regla lee SEIS campos y el fixture declara SEIS. Antes tenía que fabricar `id`,
// `createdAt`, `updatedAt`, `voiceMap: {}` y `referenceImageIds: []` —ninguno de los cuales
// mira— porque la firma pedía el contrato de salida de la API entero. Ese ruido era el síntoma
// de que el tipo de entrada estaba sobre-especificado, y es lo que dejaba la regla fuera del
// alcance de T2.2 (que alimenta filas de la BD, no respuestas de la API).
function makePersona(
  overrides: Partial<MatchablePersona> & Pick<MatchablePersona, 'name'>,
): MatchablePersona {
  return {
    ageRange: '25-34',
    gender: 'female',
    ethnicity: 'latina',
    style: 'casual',
    descriptor: 'mujer de 29 anos, latina, look casual',
    ...overrides,
  };
}

const LUCIA = makePersona({
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'latina',
  style: 'casual',
  descriptor: 'mujer de 29 años, latina, look casual',
});

const MARCUS = makePersona({
  name: 'Marcus',
  ageRange: '35-44',
  gender: 'male',
  ethnicity: 'black',
  style: 'sporty',
  descriptor: 'man in his late 30s, black, sporty look',
});

describe('tokenize', () => {
  it('normaliza acentos, mayúsculas y puntuación, y descarta palabras vacías', () => {
    expect(tokenize('Mujer, 25-35 años — estilo CASUAL')).toEqual(['mujer', '25', '35', 'casual']);
  });
});

describe('parseAgeRange', () => {
  it('lee las formas que escribe el brief', () => {
    expect(parseAgeRange('mujer 25-35 latina')).toEqual({ from: 25, to: 35 });
    expect(parseAgeRange('mujer de 25 a 35')).toEqual({ from: 25, to: 35 });
    expect(parseAgeRange('women 30 to 45')).toEqual({ from: 30, to: 45 });
  });

  it('devuelve null cuando el hint no menciona edad', () => {
    expect(parseAgeRange('hombre deportista')).toBeNull();
  });

  // EL BUG DE LAS 3 CIFRAS (code-review de T2.0). El patrón era `\d{2}`, así que en `100-120`
  // capturaba los DOS PRIMEROS dígitos de cada número —`00` y `12`— y devolvía `{from: 0, to: 12}`.
  // Un intervalo `0-12` solapa con casi cualquier persona joven: la función cuya única misión es
  // NO recomendar a quien no toca producía un falso positivo EN SILENCIO. Y por el otro lado, una
  // sola cifra (`8 a 12`) no casaba y devolvía null.
  //
  // El `avatar_hint` NO lo blinda ningún schema: es TEXTO LIBRE que escribe Sonnet. Aquí no se
  // puede asumir nada sobre su forma.
  it('lee edades de UNA y de TRES cifras sin trocear los números', () => {
    expect(parseAgeRange('mujer 100-120')).toEqual({ from: 100, to: 120 }); // NO {from:0,to:12}
    expect(parseAgeRange('niños 8 a 12')).toEqual({ from: 8, to: 12 });
    expect(parseAgeRange('edad 5-9')).toEqual({ from: 5, to: 9 });
    expect(parseAgeRange('18 to 24')).toEqual({ from: 18, to: 24 });
  });

  it('descarta lo que no puede ser una edad (nadie tiene 300 años)', () => {
    // Un «rango» absurdo es casi siempre otra cosa que el hint mencionaba (un precio, un año, un
    // código). Antes que inventarse un intervalo que solapa con todo el mundo, no hay intervalo.
    expect(parseAgeRange('presupuesto 200-300')).toBeNull();
    expect(parseAgeRange('mujer 25-35, ticket 100-999 euros')).toEqual({ from: 25, to: 35 });
  });
});

describe('scorePersona', () => {
  it('casa etnia, estilo y el SOLAPE de rangos de edad (no la igualdad literal)', () => {
    // El hint dice 25-35 y la persona es 25-34: los literales DIFIEREN pero los intervalos se
    // cruzan. Comparar los strings daría un falso negativo — es justo lo que este assert fija.
    const scored = scorePersona(LUCIA, 'mujer 25-35, latina, estilo casual');
    expect(scored.matched).toContain('age_range');
    // «mujer» NO está: el género filtra, no puntúa (ver el test de abajo).
    expect(scored.matched).not.toContain('mujer');
    expect(scored.matched).toContain('latina');
    expect(scored.matched).toContain('casual');
    // TRES señales reales (edad + etnia + estilo), no cuatro: el género ya no infla el score.
    expect(scored.score).toBe(3);
  });

  it('EL GÉNERO FILTRA, NO PUNTÚA: coincidir es el mínimo para seguir en la lista, no un mérito', () => {
    // El hallazgo del verifier de T2.0. Antes, el género SUMABA un punto además de descalificar:
    // una persona que no compartía NADA con el hint —ni edad, ni etnia, ni estilo— seguía siendo
    // candidata con score 1 solo por ser del género pedido. Con la librería sembrada (una mujer,
    // un hombre), CUALQUIER hint con género devolvía a esa persona.
    const scored = scorePersona(MARCUS, 'hombre 55-64, asiático, elegante');
    expect(scored.score).toBe(0); // es hombre, sí — y no comparte NADA más. No es candidata.
    expect(matchPersonas([LUCIA, MARCUS], 'hombre 55-64, asiático, elegante')).toEqual([]);
  });

  it('el género sigue reconociéndose en LOS DOS idiomas del seed (es/en) — para filtrar', () => {
    // «female» y «mujer» son el MISMO género: el hint viene en el idioma del brief. Se comprueba
    // por su efecto real (descalificar), que es lo que hace el género desde el fix de arriba.
    expect(scorePersona(MARCUS, 'female creator').score).toBe(0); // «female» descalifica a un male
    expect(scorePersona(LUCIA, 'hombre deportista').score).toBe(0); // «hombre» descalifica a una female
    // Y no descalifica a quien SÍ coincide (aunque el idioma del hint sea el otro):
    expect(scorePersona(LUCIA, 'female casual').score).toBeGreaterThan(0);
  });

  it('NO casa nada cuando el hint describe a otra persona (score 0)', () => {
    expect(scorePersona(LUCIA, 'hombre 55-64, asiático, elegante').score).toBe(0);
  });

  it('un rango de edad que NO se cruza no puntúa', () => {
    // 55-64 vs 25-34: disjuntos.
    expect(scorePersona(LUCIA, 'mujer 55-64').matched).not.toContain('age_range');
  });

  it('EL GÉNERO DESCALIFICA: un hint que pide mujer no recomienda a un hombre aunque compartan otras señas', () => {
    // Marcus es 35-44 y el hint pide 25-35: los intervalos SE TOCAN en el 35. Sin la regla de
    // descalificación por género, ese roce lo convertía en candidato de un hint de mujer.
    const scored = scorePersona(MARCUS, 'mujer 25-35, latina, estilo casual');
    expect(scored.score).toBe(0);
  });

  it('un hint SIN género no descalifica a nadie (solo puntúa lo que sí menciona)', () => {
    expect(scorePersona(LUCIA, 'perfil latino, estilo casual').score).toBeGreaterThan(0);
    expect(scorePersona(MARCUS, 'perfil sporty').score).toBeGreaterThan(0);
  });
});

describe('matchPersonas', () => {
  const personas = [LUCIA, MARCUS];

  it('devuelve la persona correcta para un hint compatible', () => {
    const candidates = matchPersonas(personas, 'mujer 25-35, latina, estilo casual');
    expect(candidates.map((c) => c.persona.name)).toEqual(['Lucía']);
  });

  it('devuelve NINGUNA para un hint incompatible con toda la librería', () => {
    expect(matchPersonas(personas, 'persona 55-64, asiática, elegante')).toEqual([]);
  });

  it('ordena por score descendente (la mejor primero) cuando varias casan', () => {
    // Hint SIN género (así no descalifica a nadie): «latina casual 25-34» casa FUERTE con Lucía
    // (etnia + estilo + edad) y FLOJO con Ana (solo estilo + edad: es asiática). Marcus no casa
    // en nada. El orden que sale es el ranking, no el de entrada.
    const ana = makePersona({
      name: 'Ana',
      ethnicity: 'asiática',
      style: 'casual',
      descriptor: 'mujer de 30 años, asiática, look casual',
    });
    const candidates = matchPersonas([LUCIA, ana, MARCUS], 'latina casual 25-34');
    expect(candidates.map((c) => c.persona.name)).toEqual(['Lucía', 'Ana']);
    expect(candidates[0]?.score).toBeGreaterThan(candidates[1]?.score ?? 0);
  });
});
