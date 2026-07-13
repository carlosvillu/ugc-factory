// La PALETA del visor de JSON: qué token del DS colorea cada tipo de valor (T1.16).
//
// Vive en su propio módulo —y no como constante privada del componente— para que sea
// TESTEABLE: el guard de `json-token-palette.test.ts` mide el contraste real de cada clase
// contra la superficie real del visor y falla si alguien vuelve a meter aquí un color que no
// se puede leer. Un comentario no impide una regresión; un test sí.
//
// ── LA LECCIÓN (fallo del verifier de T1.16, misma familia que T1.12) ────────────────────
// La primera versión pintaba las CLAVES con `text-accent`. Medido contra la superficie real
// del visor (`--surface-2`): 3,20:1 en dark+indigo (el default) y 2,0–2,4:1 en light con
// emerald/amber/cyan. Fallaba en la mitad de las 8 combinaciones tema × acento.
//
// Y la causa NO era "un tono mal elegido": **un color de MARCA no es un color de TEXTO**.
// `--accent` es un token de RELLENO (botones, anillos de foco), es el MISMO hex en tema claro
// y oscuro —no tiene par por tema— y encima el usuario lo elige (`data-accent`:
// indigo/emerald/amber/cyan). Un hex único que deba leerse sobre #1a1a1d Y sobre #f7f7f9 con
// 4,5:1 es geométricamente imposible: si contrasta en uno, se funde en el otro. Atar la
// LEGIBILIDAD DEL CONTENIDO a una preferencia ESTÉTICA del usuario garantiza que alguna
// combinación falle. Regla: **nada derivado de `--accent` colorea texto de contenido** — ni
// `text-accent`, ni `text-accent-hover`. El guard lo vigila.
//
// ── EL CRITERIO NUEVO ────────────────────────────────────────────────────────────────────
// En un JSON lo informativo es distinguir el TIPO DEL VALOR (string vs número vs booleano vs
// null). La clave no necesita color propio: le basta con ser el TEXTO FUERTE (`--text`, el
// máximo contraste que hay), y así el color queda libre para lo que sí dice algo. La
// puntuación (llaves, comas, dos puntos) NO es decorativa —estructura el dato, y con 649
// spans en un brief es la mitad de lo que se ve—, así que también tiene que cumplir AA: sube
// de `--text-3` (3,59:1 en dark: por debajo) a `--text-2`.
//
// ── LA TABLA (medida contra las superficies REALES, no contra blanco/negro idealizados —
//    calibrar contra una superficie idealizada fue lo que hizo fallar la ronda 1 de T1.12) ─
//
//   El visor se pinta sobre `--surface-2` (bg del <pre>), dentro de una modal `--surface`.
//   Umbral AA texto normal: 4,5:1.
//
//   token          uso          dark/surface  dark/surface-2  light/surface  light/surface-2
//   --text         claves          16,74          15,80           17,72           16,56   ✅
//   --text-2       puntuación       7,18           6,77            7,73            7,22   ✅
//   --success      strings          8,07           7,62            6,10            5,70   ✅
//   --info         números          5,00           4,72            6,18            5,77   ✅
//   --warning      booleanos        8,57           8,08            6,10            5,70   ✅
//   --violet       null             6,76           6,38            6,19            5,78   ✅
//   ── rechazados ──
//   --text-3       (puntuación)     3,81           3,59            4,83            4,52   ❌ dark
//   --accent       (claves)     indigo 3,20 · emerald 6,85 · amber 8,08 · cyan 7,15 (dark/s-2)
//                               indigo 5,07 · emerald 2,37 · amber 2,01 · cyan 2,27 (light/s-2) ❌
//
//   Los seis elegidos pasan AA en los DOS temas, y NINGUNO depende del acento: el mismo visor
//   se lee igual con los cuatro acentos.
import type { JsonTokenKind } from './json-highlight';

export const JSON_TOKEN_CLASS: Record<JsonTokenKind, string> = {
  // La clave es ESTRUCTURA: texto fuerte, sin color propio (el color lo llevan los valores).
  key: 'text-text',
  string: 'text-success',
  number: 'text-info',
  boolean: 'text-warning',
  // `null` con clase propia y no la de la puntuación: un `null` en un artefacto es INFORMACIÓN
  // —un hero que no se resolvió, un coste que no se registró—, no una coma. `violet` es el
  // token del DS de "inferido/sin evidencia" (badges de CP1): el registro semántico de un hueco.
  null: 'text-violet',
  // Puntuación: `--text-2`, no `--text-3` (3,59:1 en dark). Estructura el dato ⇒ no está exenta.
  punctuation: 'text-text-2',
};
