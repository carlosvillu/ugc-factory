// Unit del RENDERIZADOR de placeholders (T2.4, deuda heredada de T2.1). Puro, $0.
//
// LA CLÁUSULA QUE ESTOS TESTS PROTEGEN (Verificación de T2.4, literal): «un hook de librería con
// `{pain}` renderizado contra un brief cuyo `pain` tiene 12 palabras produce un hook de ≤12
// palabras habladas (el truncado al presupuesto se aplica de verdad)».
//
// Es una cláusula DETERMINISTA Y GRATUITA ⇒ vive como test permanente dentro de `pnpm gate`
// (regla de trabajo 8 del planning), no solo como paso de la verificación manual. Si alguien
// vuelve a sustituir sin truncar, el gate lo caza — que es justo lo que no pasó en T2.1.
import { describe, expect, it } from 'vitest';

import { MAX_HOOK_WORDS, countWords } from '../analyze/brief-validator';
import { HOOK_LINE_SEEDS } from './seed-data';
import {
  PLACEHOLDER_WORD_BUDGET,
  countRenderedWords,
  renderPlaceholders,
  truncateToWordBudget,
} from './placeholders';

/** El `pain` MALIGNO: 12 palabras. `ProductBriefSchema` lo permite (`z.string()` sin `.max()`) y
 *  el presupuesto de `{pain}` son 6 — o sea, el doble. Es el caso que muerde. */
const PAIN_12_WORDS = 'la piel tira y se ve apagada al salir de la ducha';

describe('truncateToWordBudget', () => {
  it('recorta a N PALABRAS (no a N caracteres) y deja el valor corto intacto', () => {
    expect(countWords(PAIN_12_WORDS)).toBe(12);
    expect(truncateToWordBudget(PAIN_12_WORDS, 6)).toBe('la piel tira y se ve');
    expect(truncateToWordBudget('Hidrata 24 horas', 4)).toBe('Hidrata 24 horas');
  });

  it('limpia la puntuación que queda colgando en el corte (este texto lo LEE una voz)', () => {
    expect(truncateToWordBudget('la piel tira, se apaga y pica', 3)).toBe('la piel tira');
  });
});

describe('renderPlaceholders — la deuda de T2.1', () => {
  it('TRUNCA el valor al presupuesto de su placeholder', () => {
    const rendered = renderPlaceholders('Si te pasa {pain}, mira esto.', { pain: PAIN_12_WORDS });
    expect(rendered).toBe('Si te pasa la piel tira y se ve, mira esto.');
    // 5 palabras literales (Si te pasa mira esto) + el presupuesto de {pain}: 6, ni una más.
    expect(countWords(rendered)).toBe(5 + (PLACEHOLDER_WORD_BUDGET['{pain}'] ?? 0));
  });

  it('un placeholder sin valor en el brief se deja LITERAL (no se borra: mutilaría la frase)', () => {
    expect(renderPlaceholders('Si te pasa {pain}, mira esto.', {})).toBe(
      'Si te pasa {pain}, mira esto.',
    );
  });

  it('sustituye varios placeholders distintos, cada uno con SU presupuesto', () => {
    const rendered = renderPlaceholders('{product} para {category}: {benefit}.', {
      product: 'Sérum Hidratante 24h con ácido hialurónico puro',
      category: 'cuidado facial diario intensivo',
      benefit: 'hidrata durante 24 horas seguidas sin grasa',
    });
    expect(rendered).toBe('Sérum Hidratante 24h para cuidado facial: hidrata durante 24 horas.');
  });

  it('EL TECHO NO MIENTE: TODA la librería sembrada, renderizada con el peor brief, sigue ≤12 palabras habladas', () => {
    // El control de la Verificación aplicado a la librería ENTERA, no a un hook de ejemplo: cada
    // valor del brief se pasa DEL DOBLE de su presupuesto. Si el renderizador dejara de truncar,
    // este assert se pone rojo con TODOS los hooks que llevan placeholder.
    const brief = {
      pain: PAIN_12_WORDS,
      benefit: 'hidrata la piel durante veinticuatro horas seguidas sin dejar sensación grasa',
      product: 'Sérum Hidratante Intensivo 24h de Marca Ejemplo Premium',
      category: 'cuidado facial hidratante para piel sensible',
    };

    const offenders = HOOK_LINE_SEEDS.map((seed) => renderPlaceholders(seed.text, brief))
      .filter((text) => countWords(text) > MAX_HOOK_WORDS)
      .map((text) => `${String(countWords(text))}w: ${text}`);

    expect(offenders).toEqual([]);
  });

  it('CONTROL NEGATIVO: sustituir SIN truncar (el bug de T2.1) rompe el techo de 12 palabras', () => {
    // Reintroducción literal del bug: un `replace` ingenuo, que es lo que un implementer
    // desprevenido habría escrito. Este test EXISTE para demostrar que el assert de arriba
    // discrimina — sin él, no sabríamos si pasa por el truncado o porque los hooks son cortos.
    const naive = (template: string): string =>
      template.replace('{pain}', PAIN_12_WORDS).replace('{benefit}', 'hidrata 24 horas de verdad');

    const conPain = HOOK_LINE_SEEDS.filter((seed) => seed.text.includes('{pain}'));
    expect(conPain.length).toBeGreaterThan(0);

    const rotos = conPain
      .map((seed) => naive(seed.text))
      .filter((t) => countWords(t) > MAX_HOOK_WORDS);
    expect(rotos.length).toBe(conPain.length); // TODOS se pasan del techo sin el truncado.

    // Y la contraparte: los mismos hooks, renderizados BIEN, caben.
    const bien = conPain
      .map((seed) => renderPlaceholders(seed.text, { pain: PAIN_12_WORDS }))
      .filter((t) => countWords(t) > MAX_HOOK_WORDS);
    expect(bien).toEqual([]);
  });

  it('el renderizado real nunca supera el peor caso que T2.1 validó (countRenderedWords)', () => {
    // La coherencia entre las DOS mitades del contrato: lo que el validador ACOTA (peor caso) es
    // una cota superior de lo que el renderizador PRODUCE. Si el renderizador truncara a un
    // presupuesto distinto del que valida el seed, este assert lo caza.
    const brief = {
      pain: PAIN_12_WORDS,
      benefit: 'x '.repeat(20),
      product: 'y '.repeat(20),
      category: 'z '.repeat(20),
    };
    for (const seed of HOOK_LINE_SEEDS) {
      expect(countWords(renderPlaceholders(seed.text, brief))).toBeLessThanOrEqual(
        countRenderedWords(seed.text),
      );
    }
  });

  it('BLINDAJE (code-review): dos placeholders PEGADOS en un token cuentan LOS DOS presupuestos', () => {
    // `renderPlaceholders` (regex global) sustituye AMBOS; `countRenderedWords` debe contar AMBOS,
    // o la cota superior mentiría por debajo. No pasa en la librería curada (sus hooks llevan
    // espacios), pero el invariante «lo contado ≥ lo renderizado» tiene que sostenerse SIEMPRE.
    const glued = '{product}{category}';
    expect(countRenderedWords(glued)).toBe(
      (PLACEHOLDER_WORD_BUDGET['{product}'] ?? 0) + (PLACEHOLDER_WORD_BUDGET['{category}'] ?? 0),
    );
    // Y la cota se sostiene: lo renderizado (dos valores truncados, pegados en un token = 1 palabra)
    // nunca supera lo contado.
    const rendered = renderPlaceholders(glued, { product: 'a b c d e', category: 'f g h' });
    expect(countWords(rendered)).toBeLessThanOrEqual(countRenderedWords(glued));
  });
});
