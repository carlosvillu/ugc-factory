// Título HUMANO de cada nodo del pipeline (T1.16). Fuente ÚNICA del canvas: el mismo
// mapa lo consumen el nodo del grafo, el nodo de grupo N7 y el inspector — si el título
// viviera en dos sitios, el día que cambie uno el otro miente.
//
// POR QUÉ existe: hasta T1.16 el nodo solo pintaba su `node_key` (`N1`, `N2`…). El
// usuario no puede saber qué hace cada nodo sin el PRD delante. La clave NO desaparece:
// sigue siendo el badge mono secundario Y —crítico— el accessible name del nodo, que es
// la API de los tests (`getByRole('article', {name:/N3/i})`, canvas.md §4).
//
// LOS TÍTULOS NO SE INVENTAN: son los de la tabla de nodos del PRD §7.2 (+ §7.3 para los
// checkpoints), y coinciden con los que el DESIGN SYSTEM ya había decidido para esta misma
// card — `docs/design-system/ui_kits/ugc-factory/PipelineScreen.jsx` pinta
// `<PipelineNode code="N1" title="Ingesta">`, `code="N2" title="Análisis visual"`,
// `code="N3 · CP1" title="ProductBrief"`, `code="N4" title="Estrategia"`. El patrón `code` +
// `title` del DS es exactamente el que implementa `step-node.tsx` (clave en badge mono
// arriba, título humano como texto principal).
//
// Donde DS y PRD discrepan gana el PRD (jerarquía del CLAUDE.md), y se anota:
//   · N4: el DS abrevia «Estrategia»; el PRD §7.2 dice «Estrategia del lote» — se usa el del
//     PRD (más específico y sin ambigüedad con la matriz de CP2).
// El planning proponía paráfrasis («Ingesta de la página», «Síntesis del brief», «Matriz del
// lote») como ejemplos («p. ej.»); manda la fuente, no el ejemplo.
//
// Los nodos que aún no existen en código (N4+) quedan listos: el mapa cubre el pipeline
// entero, N0–N11 + el sub-DAG N7a–N7e + los checkpoints CP1–CP5.

// Clave CANÓNICA → título. Las claves son las del PRD; el `node_key` REAL de un run
// puede venir prefijado (el DAG de demo usa `demo.canvas.N2`), y de eso se ocupa
// `canonicalNodeKey`.
export const NODE_TITLES: Record<string, string> = {
  N0: 'Intake',
  N1: 'Ingesta',
  N2: 'Análisis visual',
  N3: 'ProductBrief',
  N4: 'Estrategia del lote',
  N5: 'Guiones',
  N6: 'Compilación de prompts',
  N7: 'Generación de assets',
  N7a: 'Product shots y keyframes',
  N7b: 'Voz (TTS)',
  N7c: 'Clip de avatar',
  N7d: 'B-roll',
  N7e: 'Música',
  N8: 'Composición',
  N9: 'QA',
  N10: 'Publicación',
  N11: 'Medición',
  // Checkpoints del §7.3. Hoy ningún `node_key` se llama `CPx` (el checkpoint es una
  // BANDERA sobre el nodo que lo lleva: N3 es CP1, N4 es CP2…), pero el PRD los nombra
  // y el mapa los cubre para el día que un DAG los emita como paso propio.
  CP1: 'Revisión del brief',
  CP2: 'Selección de la matriz',
  CP3: 'Revisión de guiones',
  CP4: 'Aprobación de variantes',
  CP5: 'Confirmación de publicación',
};

// Un `node_key` real puede llevar prefijo de DAG (`demo.canvas.N2`): el invariante del
// orquestador es que sea ÚNICO por run, no que sea la clave pelada del PRD. El título se
// resuelve por el ÚLTIMO segmento (tras el último punto), que es donde vive la clave
// canónica. Sin match, no se inventa nada: se devuelve la clave tal cual, que es
// exactamente lo que se pintaba antes de esta tarea (degradación honesta).
export function canonicalNodeKey(nodeKey: string): string {
  return nodeKey.slice(nodeKey.lastIndexOf('.') + 1);
}

/** Título humano de un `node_key` (con o sin prefijo de DAG). Sin entrada en el mapa,
 *  devuelve la clave — nunca `undefined`: el nodo SIEMPRE tiene texto principal. */
export function nodeTitle(nodeKey: string): string {
  return NODE_TITLES[canonicalNodeKey(nodeKey)] ?? nodeKey;
}

// Qué CHECKPOINT del §7.3 lleva cada nodo. El checkpoint es una bandera sobre el nodo
// (`step_run.is_checkpoint`), no un paso propio, y el DS ya resolvió cómo enseñarlo: el badge
// del nodo dice `N3 · CP1` cuando ese N3 es el checkpoint del brief
// (`PipelineScreen.jsx`: `code={approved ? "N3" : "N3 · CP1"}`).
const CHECKPOINT_OF: Record<string, string> = {
  N3: 'CP1',
  N4: 'CP2',
  N5: 'CP3',
  N9: 'CP4',
  N10: 'CP5',
};

/**
 * La CLAVE que se pinta en el badge mono del nodo/inspector: el `node_key` tal cual, y si ese
 * step es un checkpoint conocido, con su `· CPn` (patrón del DS). Se pasa `isCheckpoint` del
 * step —no se deduce del node_key— porque el mismo nodo puede o no serlo según el DAG
 * (autopilot, `alwaysPause`) y la verdad la tiene la fila, no la clave.
 *
 * IMPORTANTE: esto es SOLO el texto visible. El accessible name del nodo sigue llevando el
 * `node_key` CRUDO (la API de los tests, canvas.md §4): `N3 · CP1` no puede colarse ahí.
 */
export function nodeBadgeLabel(nodeKey: string, isCheckpoint: boolean): string {
  if (!isCheckpoint) return nodeKey;
  const cp = CHECKPOINT_OF[canonicalNodeKey(nodeKey)];
  return cp === undefined ? nodeKey : `${nodeKey} · ${cp}`;
}
