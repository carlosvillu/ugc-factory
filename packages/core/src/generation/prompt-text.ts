// Higiene de texto para prompts de imagen (LÓGICA PURA) — compartida por los builders de prompt de
// core (packshot, thumbnail de template, retrato de persona). NO es validación: el texto de entrada ya
// se validó aguas arriba; esto solo recorta texto libre a un tamaño razonable para el prompt (una
// `description`/`descriptor` largo no aporta nada más allá de un par de frases).

/**
 * Recorta un texto libre a un tamaño razonable para el prompt: normaliza los espacios y, si excede
 * `maxChars`, lo trunca añadiendo un `…`. Higiene, no validación.
 */
export function trimForPrompt(value: string, maxChars: number): string {
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars).trimEnd()}…`;
}
