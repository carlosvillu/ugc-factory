// EL PRESUPUESTO DE PALABRAS DE LOS PLACEHOLDERS — y por qué existe.
//
// Los hooks de la librería son PLANTILLAS interpolables: `'Deja de gastar dinero en cosas
// que no arreglan {pain}.'` son 10 palabras LITERALES, pero lo que el espectador OYE es el
// hook RENDERIZADO, con `{pain}` sustituido por el dolor real del brief («la piel tira y se
// ve apagada al despertar»). Contar solo lo literal daba un techo MENTIROSO: 10 palabras en
// la plantilla, 17 en el anuncio — muy por encima de las 12 que caben en los 0–3 s del hook
// (§7.2 N5: ~2,5 palabras/segundo; es la razón por la que MAX_HOOK_WORDS existe).
//
// La corrección (T2.1, hallazgo del pase de review): el techo se aplica al PEOR CASO
// RENDERIZADO — palabras literales + el presupuesto de cada placeholder.
//
// ⚠ EL PRESUPUESTO ES UNA ASUNCIÓN, NO UN LÍMITE DERIVADO DEL CONTRATO. `ProductBrief`
// (T1.1, Apéndice A) declara `product.name`, `benefits[].benefit` y `pain_points[].pain`
// como `z.string()` PELADO: nada acota su longitud hoy. Por eso este presupuesto vive aquí,
// EXPORTADO, y no enterrado en el validador: es un CONTRATO entre dos consumidores —
//
//   1. el VALIDADOR DE SEEDS (T2.1): ninguna plantilla de la librería puede pasarse del
//      techo ni en su peor caso;
//   2. el RENDERIZADOR (T2.4, ScriptWriter): al sustituir un placeholder, debe RECORTAR el
//      valor del brief a su presupuesto (o elegir/reformular uno más corto). Si el
//      renderizador ignora este mapa, el techo vuelve a mentir — un nivel más abajo.
//
// Los números son la horquilla realista de lo que produce Sonnet 5 en un brief (ver los
// briefs reales de F1: «Sérum Hidratante 24h» = 3, «Hidrata 24 horas» = 3, «La piel tira
// después de lavarla» = 6), redondeados AL ALZA — el presupuesto acota el PEOR caso, no el
// típico. Ajustarlos es una decisión deliberada: subir uno obliga a re-validar la librería
// entera (el gate lo caza solo).

/** Los placeholders que una plantilla de hook/CTA puede interpolar, con su presupuesto de
 *  palabras en el PEOR caso. Único mapa; ampliarlo exige revalidar la librería. */
export const PLACEHOLDER_WORD_BUDGET: Readonly<Record<string, number>> = {
  '{product}': 3, // nombre del producto («Sérum Hidratante 24h»)
  '{benefit}': 4, // el beneficio principal («Hidrata durante 24 horas»)
  '{pain}': 6, // el dolor del segmento («La piel tira después de lavarla»)
  '{category}': 2, // la categoría/vertical («cuidado facial»)
};

/** Los placeholders conocidos, como lista (para mensajes de error y tests). */
export const KNOWN_PLACEHOLDERS = Object.keys(PLACEHOLDER_WORD_BUDGET);

/** Encuentra los `{...}` que aparecen en un texto (conocidos o no). */
export function findPlaceholders(text: string): string[] {
  return text.match(/\{[a-z_]+\}/g) ?? [];
}

/**
 * Cuenta las palabras del PEOR CASO RENDERIZADO de una plantilla: cada token literal cuenta
 * 1; cada placeholder cuenta su presupuesto.
 *
 * Es lo que se compara contra `MAX_HOOK_WORDS` para la librería CURADA. (Los hooks que
 * GENERA el LLM — BriefValidator, T1.9 — no llevan placeholders: allí se sigue contando
 * literal, con la misma constante. Una constante, dos formas de contar, cada una honesta
 * con lo que mide.)
 *
 * Nota de tokenización: un placeholder puede ir pegado a puntuación (`{pain},` / `{pain}.`),
 * así que se detecta por inclusión dentro del token, no por igualdad — el mismo criterio que
 * usa el renderizador al sustituir.
 */
export function countRenderedWords(text: string): number {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let total = 0;
  for (const token of tokens) {
    const placeholder = KNOWN_PLACEHOLDERS.find((p) => token.includes(p));
    total += placeholder ? (PLACEHOLDER_WORD_BUDGET[placeholder] ?? 1) : 1;
  }
  return total;
}
