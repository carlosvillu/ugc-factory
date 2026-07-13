// Tokenizador de JSON para el visor del output (T1.16). PURO: string/valor → lista de
// tokens tipados; el color lo pone el componente con TOKENS SEMÁNTICOS del DS (nunca un
// tema de librería con colores propios, que se saldría del design system y no respondería
// al cambio de tema claro/oscuro).
//
// POR QUÉ SIN DEPENDENCIA: las librerías de resaltado (shiki, prism, highlight.js,
// react-json-view) pesan de 40 KB a >1 MB, traen su propio sistema de temas con colores
// HARDCODEADOS —justo lo que el DS prohíbe— y para un único lenguaje (JSON ya
// pretty-printeado por `JSON.stringify`, es decir: SIEMPRE bien formado) resuelven un
// problema que aquí no existe. El resultado con este tokenizador de ~30 líneas es
// equivalente y las clases son las del DS. Decisión explícita, no pereza.
//
// El input SIEMPRE es la salida de `JSON.stringify(x, null, 2)` → no hay comentarios, ni
// trailing commas, ni strings sin comillas: una regex sobre JSON canónico basta y no hay
// que escribir un parser.

export type JsonTokenKind =
  | 'key' // "nombre":
  | 'string' // "valor"
  | 'number'
  | 'boolean'
  | 'null'
  | 'punctuation'; // { } [ ] , : y el espaciado

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

// Un token por alternativa, en orden de prioridad:
//   1. string SEGUIDA de `:` ⇒ clave. El `:` va PEGADO a la string: `JSON.stringify(x,null,2)`
//      nunca emite espacio antes de los dos puntos, así que un `\s*` ahí sería una alternativa
//      que no puede matchear jamás — precisión falsa.
//   2. string suelta ⇒ valor string
//   3. número (con exponente/decimales/negativo)
//   4. true|false
//   5. null
// Todo lo demás (llaves, corchetes, comas, dos puntos, saltos de línea, indentación) es
// puntuación y viaja tal cual: así el `<pre>` conserva el pretty-print exacto.
const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b/g;

/**
 * Tokeniza JSON YA formateado. Devuelve la secuencia COMPLETA (incluida la puntuación):
 * concatenar los `text` de todos los tokens reproduce el input carácter a carácter — el
 * invariante que hace seguro pintarlos en un `<pre>` (nada se pierde por el camino).
 */
export function tokenizeJson(formatted: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;

  const punctuation = (text: string) => {
    if (text.length > 0) tokens.push({ kind: 'punctuation', text });
  };

  for (const m of formatted.matchAll(TOKEN_RE)) {
    const [full, keyText, colon, stringText, numberText, boolText, nullText] = m;
    punctuation(formatted.slice(last, m.index));
    if (keyText !== undefined && colon !== undefined) {
      tokens.push({ kind: 'key', text: keyText });
      punctuation(colon);
    } else if (stringText !== undefined) {
      tokens.push({ kind: 'string', text: stringText });
    } else if (numberText !== undefined) {
      tokens.push({ kind: 'number', text: numberText });
    } else if (boolText !== undefined) {
      tokens.push({ kind: 'boolean', text: boolText });
    } else if (nullText !== undefined) {
      tokens.push({ kind: 'null', text: nullText });
    }
    last = m.index + full.length;
  }
  punctuation(formatted.slice(last));

  return tokens;
}

/**
 * Formatea un artefacto opaco (`output_refs`: `unknown`) como JSON legible. Un valor que
 * no sea serializable (referencia circular — no debería llegar de la API, pero el tipo es
 * `unknown`) NO revienta el visor: cae a su representación en texto. Nunca lanza.
 */
export function formatJson(value: unknown): string {
  if (typeof value === 'string') {
    // Un output que YA es un string: si es JSON válido, se re-formatea (el caso del
    // `outputRefs` guardado como texto); si no, se muestra tal cual.
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  // `null` y `undefined` se muestran tal cual: `JSON.stringify(undefined)` devuelve
  // `undefined` (no un string) y pintarlo sería un hueco mudo. Un step sin output no llega
  // aquí (el panel no ofrece el visor), pero el tipo es `unknown` y el visor no revienta.
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Referencia circular (o un BigInt): no puede llegar de la API —el artefacto viene de
    // un jsonb, y todo jsonb es serializable— pero el tipo es `unknown` y el visor no se
    // cae por ello. No se hace `String(value)`: sobre un objeto daría "[object Object]",
    // que es peor que decir la verdad.
    return '/* artefacto no serializable */';
  }
}
