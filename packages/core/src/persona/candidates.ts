// RECOMENDACIÓN DE PERSONAS POR `avatar_hint` (T2.0; PRD §11 «Recomendación» + §12 N4).
//
// QUÉ ES EL `avatar_hint`. Es un campo del ProductBrief (`audience.segments[].avatar_hint`,
// contrato T1.1) que Sonnet escribe como TEXTO LIBRE en el idioma del brief: «mujer 25-35,
// latina, estilo casual», «hombre joven deportista». El PRD dice qué debe HACER («sugiere
// personas compatibles») pero no CÓMO. Esta función fija la regla, y la fija AQUÍ (core, pura)
// para que el endpoint sea un passthrough testeable y T2.2 la reutilice sin re-implementarla.
//
// LA REGLA (decisión de T2.0, anotada en el informe): **solape de tokens normalizados**.
//   1. El hint se normaliza (minúsculas, sin acentos, sin puntuación) y se parte en tokens.
//   2. La persona se proyecta a su propio conjunto de tokens: género (con sus sinónimos en
//      es/en, porque el hint viene en el idioma del brief), etnia, estilo y descriptor.
//   3. Cada token del hint que aparezca en los de la persona suma 1. La EDAD se trata aparte,
//      como INTERVALO: el `25-35` del hint casa con el `25-34` de la persona si se cruzan
//      (compararlos como strings daría un falso negativo).
//   4. Personas con score 0 NO son candidatas (la Verificación exige que un hint incompatible
//      devuelva NINGUNA). Se ordena por score desc, y a igualdad por nombre (determinista).
//
// Es deliberadamente simple y determinista: sin IA, sin embeddings, sin coste ($0). Es una
// AYUDA de preselección para el compositor de matriz —el usuario «puede fijar o dejar que
// rote» (§11)—, no una decisión automática irreversible. Si en F4 hace falta más finura, el
// sitio de cambiarla es este único fichero.
import type { MatchablePersona, PersonaGender } from './contracts';

/** Sinónimos de género en los DOS idiomas del seed (§17: es+en). El `avatar_hint` viene en el
 *  idioma del brief, así que «mujer» y «female» tienen que casar con el MISMO género. */
const GENDER_TOKENS: Readonly<Record<PersonaGender, readonly string[]>> = {
  female: ['female', 'mujer', 'femenino', 'femenina', 'chica', 'woman'],
  male: ['male', 'hombre', 'masculino', 'masculina', 'chico', 'man'],
  // OJO con los tokens de una sola sílaba genérica: `no` (de «no binario») casaría con
  // CUALQUIER hint que contenga la palabra «no» y convertiría a la persona en candidata de
  // todo. Solo tokens que solo pueden significar el género.
  non_binary: ['nonbinary', 'binario', 'binaria', 'binary'],
};

/** Palabras vacías: aparecen en cualquier hint y casarían con cualquier persona (ruido puro). */
const STOP_WORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'y',
  'o',
  'con',
  'sin',
  'que',
  'en',
  'a',
  'the',
  'of',
  'and',
  'or',
  'with',
  'years',
  'anos',
  'ano',
  'edad',
  'age',
  'estilo',
  'style',
  'look',
]);

/** Normaliza un texto a tokens comparables: minúsculas, sin acentos, sin puntuación. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita los diacríticos que NFD separó
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

/** Un intervalo de edad cerrado. */
interface AgeRange {
  from: number;
  to: number;
}

/** Ninguna persona vive más de esto. Un «rango» con un extremo por encima no es una edad: es un
 *  precio, un año o un código postal que el hint mencionaba de pasada. */
const MAX_PLAUSIBLE_AGE = 120;

/**
 * Extrae el PRIMER rango de edad de un texto: `25-35`, `25 - 35`, `25 a 35`, `25 to 35`.
 * Devuelve null si el texto no menciona ninguno (o si lo que menciona no es una edad creíble).
 *
 * ⚠ POR QUÉ `\d{1,3}` CON LÍMITES DE PALABRA, y no `\d{2}` (bug del code-review de T2.0): con
 * `\d{2}` el texto `mujer 100-120` capturaba **`00` y `12`** —los dos primeros dígitos de cada
 * número— y devolvía `{from: 0, to: 12}`. Un intervalo `0-12` solapa con casi cualquier persona
 * joven, así que la función cuya ÚNICA misión es no recomendar a quien no toca producía un falso
 * positivo EN SILENCIO. Y por el otro lado, `8 a 12` o `edad 5-9` devolvían `null` (una cifra no
 * casaba). El `avatar_hint` NO está blindado por ningún schema: es texto libre que escribe Sonnet
 * en el idioma del brief — aquí no se puede asumir nada sobre su forma.
 */
export function parseAgeRange(text: string): AgeRange | null {
  const m = /\b(\d{1,3})\s*(?:-|–|a|to|hasta)\s*(\d{1,3})\b/.exec(text.toLowerCase());
  if (!m?.[1] || !m[2]) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const [from, to] = a <= b ? [a, b] : [b, a];
  if (to > MAX_PLAUSIBLE_AGE) return null;
  return { from, to };
}

/** ¿Se cruzan dos intervalos de edad? (`25-35` vs `30-39` → sí; vs `18-24` → no). */
function rangesOverlap(a: AgeRange, b: AgeRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** El conjunto de tokens que REPRESENTA a una persona a efectos de matching. */
function personaTokens(persona: MatchablePersona): Set<string> {
  return new Set([
    ...GENDER_TOKENS[persona.gender],
    ...tokenize(persona.ethnicity),
    ...tokenize(persona.style),
    ...tokenize(persona.descriptor),
  ]);
}

/** Todos los tokens de género de CUALQUIER género → el género al que pertenecen. Permite
 *  detectar que un hint NOMBRA un género (y cuál) sin recorrer el enum en el caller. */
const GENDER_BY_TOKEN: ReadonlyMap<string, PersonaGender> = new Map(
  Object.entries(GENDER_TOKENS).flatMap(([gender, tokens]) =>
    tokens.map((t) => [t, gender as PersonaGender] as const),
  ),
);

/** El género que un `avatar_hint` NOMBRA, si nombra alguno («mujer 25-35, latina» → female).
 *  `null` = el hint no habla de género (entonces no descalifica a nadie). */
function genderNamedBy(hintTokens: string[]): PersonaGender | null {
  for (const token of hintTokens) {
    const gender = GENDER_BY_TOKEN.get(token);
    if (gender) return gender;
  }
  return null;
}

/** Una persona puntuada frente a un `avatar_hint`, con la explicación del match.
 *
 *  Genérica en `T`: el llamante recupera SU tipo, no un `MatchablePersona` degradado. El
 *  endpoint mete `Persona` y saca `ScoredPersona<Persona>` (con id, fechas y todo, listo para
 *  serializar); T2.2 meterá `PersonaRow` y sacará `ScoredPersona<PersonaRow>`. Un solo código,
 *  cero conversiones, cero pérdida de tipo. */
export interface ScoredPersona<T extends MatchablePersona = MatchablePersona> {
  persona: T;
  score: number;
  /** Los tokens (o el literal `age_range`) del hint que casaron. Es el POR QUÉ. */
  matched: string[];
}

/**
 * Puntúa UNA persona contra un `avatar_hint`. Público (además de `matchPersonas`) porque el
 * test de la regla necesita mirar el score de una persona concreta sin montar una lista.
 */
export function scorePersona<T extends MatchablePersona>(
  persona: T,
  avatarHint: string,
): ScoredPersona<T> {
  const hintTokens = tokenize(avatarHint);

  // 0) EL GÉNERO DESCALIFICA (no solo suma). Si el hint pide «mujer» y la persona es `male`,
  //    NO es candidata por mucho que compartan estilo o que sus rangos de edad se rocen.
  //    Sin esta regla el matching es demasiado laxo y devuelve ruido: fue exactamente lo que
  //    pasó al escribirlo — el hint «mujer 25-35, latina, casual» recomendaba también a un
  //    hombre de 35-44, porque el 35 cae en los DOS intervalos. Un anuncio con la persona
  //    equivocada es peor que uno sin recomendación.
  const namedGender = genderNamedBy(hintTokens);
  if (namedGender !== null && namedGender !== persona.gender) {
    return { persona, score: 0, matched: [] };
  }

  const matched: string[] = [];
  const tokens = personaTokens(persona);

  // 1) Rango de edad: intervalos, no strings. Un hint `25-35` casa con una persona `25-34`
  //    aunque los literales sean distintos — comparar los textos daría un falso negativo.
  const hintRange = parseAgeRange(avatarHint);
  const personaRange = parseAgeRange(persona.ageRange);
  if (hintRange && personaRange && rangesOverlap(hintRange, personaRange)) {
    matched.push('age_range');
  }

  // 2) Solape de tokens. Se excluyen DOS clases de token, cada una por su motivo:
  //
  //    · los DÍGITOS del rango de edad: ya se han considerado arriba como intervalo (1), y
  //      contarlos otra vez sería puntuar dos veces lo mismo.
  //
  //    · **EL GÉNERO: es un FILTRO, NO UNA SEÑAL DE AFINIDAD.** Ya hizo su trabajo en (0),
  //      descalificando a quien no coincide. Coincidir NO es mérito: es el mínimo para seguir
  //      en la lista. Si además sumara un punto, una persona que no comparte NADA con el hint
  //      —ni edad, ni etnia, ni estilo— seguiría siendo candidata con score 1 solo por ser del
  //      género pedido. Con la librería sembrada (una mujer, un hombre) eso significaba que
  //      CUALQUIER hint que nombrara un género devolvía a esa persona: «hombre 55-64 asiático
  //      elegante» recomendaba a un hombre de 35-44 negro y deportista. Lo cazó el verifier de
  //      T2.0. «Es un hombre» no es una recomendación — y el consumidor de esto (T2.2, que
  //      sugiere personas por segmento de audiencia) merece candidatas, no ruido con género.
  const genderTokens = new Set(GENDER_TOKENS[persona.gender]);
  for (const token of hintTokens) {
    if (/^\d+$/.test(token)) continue;
    if (genderTokens.has(token)) continue;
    if (tokens.has(token) && !matched.includes(token)) matched.push(token);
  }

  return { persona, score: matched.length, matched };
}

/**
 * Las personas COMPATIBLES con un `avatar_hint`, mejor primero. Las que no casan en NADA
 * (score 0) se descartan: es la mitad negativa de la Verificación de T2.0 («ninguna para un
 * hint incompatible»). Determinista: a igualdad de score, orden alfabético por nombre.
 */
export function matchPersonas<T extends MatchablePersona>(
  personas: readonly T[],
  avatarHint: string,
): ScoredPersona<T>[] {
  return personas
    .map((p) => scorePersona(p, avatarHint))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.persona.name.localeCompare(b.persona.name));
}
