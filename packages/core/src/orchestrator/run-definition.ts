// Definición de un run como DAG (T0.7b): nodos + depends_on. Es el contrato de
// entrada de `POST /api/runs` y la fuente de los `step_run` iniciales. La lógica
// de "qué estado inicial tiene cada nodo" (root sin deps ⇒ `pending`; con deps ⇒
// `awaiting_deps`) es PURA y vive aquí — la persistencia (INSERT + encolado
// atómico de roots) la hace `createRun` (createRun.ts) sobre la BD.
//
// Frontera de core (SKILL.md backend, principio 1): sin BD, sin cola. Habla
// nodos y estados, no filas.
import { z } from 'zod';

/**
 * Un nodo del DAG a ejecutar. `key` es el identificador LÓGICO del nodo dentro
 * de la definición (no el ULID del step, que se genera al crear el run):
 * `depends_on` referencia estas `key`s. `nodeKey` es el `node_key` del step_run
 * (§12: 'N0'…'N11', 'demo.*') que resuelve el executor en el worker. `config` son
 * los parámetros per-step del executor (los de demo: `sleep_ms`/`fail_rate`/
 * `hang`), persistidos en `step_run.config`.
 */
export const RunNodeSchema = z.strictObject({
  // Identificador local del nodo en la definición; único dentro del DAG. Lo usan
  // los `dependsOn` de otros nodos para referenciarlo antes de que exista el ULID.
  key: z.string().min(1),
  // `node_key` del step_run: el executor a ejecutar (resuelto por el registro del
  // worker). Puede coincidir con `key` o no.
  nodeKey: z.string().min(1),
  // Claves locales (`key`) de los nodos cuyo éxito habilita a este. Vacío ⇒ root.
  dependsOn: z.array(z.string().min(1)).default([]),
  // Parámetros del executor (opaco para core). Nullable/omitible: un nodo sin
  // parámetros no lleva config.
  config: z.unknown().optional(),
  // §7.1.b (T0.8): el nodo es un CHECKPOINT — al terminar su ejecución NO pasa a
  // `succeeded` sino a `waiting_approval` (pausa esperando aprobación humana). El
  // consumer lo decide vía `shouldPause` leyendo esta bandera + autopilot del run.
  isCheckpoint: z.boolean().default(false),
  // Override per-nodo (T0.8): configuración del checkpoint. `alwaysPause: true` es
  // el override "parar SIEMPRE aquí" que GANA sobre `autopilot=true` del run (un
  // checkpoint marcado así pausa aunque el run esté en autopilot). Opaco por lo
  // demás; se persiste tal cual en `step_run.checkpoint_config`.
  checkpointConfig: z.looseObject({ alwaysPause: z.boolean().optional() }).nullish(),
});
export type RunNode = z.infer<typeof RunNodeSchema>;
/**
 * Tipo de ENTRADA de un nodo (`z.input`): con los defaults (`isCheckpoint`,
 * `dependsOn`) como OPCIONALES. Es lo que un caller construye a mano (demo-dag,
 * tests) antes de `parse`; la validación estructural (`validateDag`,
 * `initialStatus`) opera sobre este shape para no exigir campos que el schema
 * rellena. `RunNode` (output) es asignable a `RunNodeInput`.
 */
export type RunNodeInput = z.input<typeof RunNodeSchema>;

/**
 * Definición completa de un run: el project al que pertenece y los nodos del DAG.
 * `POST /api/runs` recibe exactamente esto (validado en la frontera).
 */
export const RunDefinitionSchema = z.strictObject({
  projectId: z.string().min(1),
  nodes: z.array(RunNodeSchema).min(1),
  // §7.1.b (T0.8): el run arranca en autopilot (sin pausas en checkpoints salvo
  // el override per-nodo `checkpointConfig.alwaysPause`). Default false.
  autopilot: z.boolean().default(false),
});
export type RunDefinition = z.infer<typeof RunDefinitionSchema>;
/** Entrada de una definición (`z.input`): defaults opcionales. La construyen a
 *  mano demo-dag y los tests; `RunDefinition` (output) es asignable a ella. */
export type RunDefinitionInput = z.input<typeof RunDefinitionSchema>;

/**
 * Estado inicial de un nodo (§7.1): sin dependencias ⇒ `pending` (root listo para
 * encolar); con dependencias ⇒ `awaiting_deps` (espera a que completen). Función
 * PURA: la usa `createRun` para fijar el status de cada `step_run` en el INSERT.
 */
export function initialStatus(node: RunNodeInput): 'pending' | 'awaiting_deps' {
  return (node.dependsOn ?? []).length === 0 ? 'pending' : 'awaiting_deps';
}

/**
 * Valida la coherencia estructural del DAG antes de tocar la BD:
 *  - `key`s únicas,
 *  - cada `dependsOn` referencia una `key` existente,
 *  - al menos un root (nodo sin deps) — sin él, ningún step arrancaría nunca,
 *  - sin ciclos (un ciclo dejaría a todos sus nodos en `awaiting_deps` para
 *    siempre).
 * Devuelve el mensaje del primer problema, o `null` si el DAG es válido. Se
 * devuelve el mensaje (no se lanza) para que el llamante lo mapee al error de su
 * frontera (`validation_error` en el route handler).
 */
export function validateDag(def: RunDefinitionInput): string | null {
  const keys = new Set<string>();
  for (const node of def.nodes) {
    if (keys.has(node.key)) return `clave de nodo duplicada: ${node.key}`;
    keys.add(node.key);
  }
  // `node_key` ÚNICO por run: el encolado usa `singletonKey = ${runId}:${nodeKey}`
  // con policy `short`, así que dos nodos del mismo run con el mismo node_key
  // colisionan en la cola — el segundo quedaría `queued` SIN job, varado para
  // siempre. Es un invariante de la DEFINICIÓN de entrada, no de la tabla (T0.8
  // crea filas nuevas con el MISMO node_key al superseder, así que NO va como
  // UNIQUE de BD): se valida aquí, en la frontera.
  const nodeKeys = new Set<string>();
  for (const node of def.nodes) {
    if (nodeKeys.has(node.nodeKey)) return `node_key duplicado en el run: ${node.nodeKey}`;
    nodeKeys.add(node.nodeKey);
  }
  for (const node of def.nodes) {
    for (const dep of node.dependsOn ?? []) {
      if (!keys.has(dep)) return `nodo ${node.key} depende de una clave inexistente: ${dep}`;
    }
  }
  const roots = def.nodes.filter((n) => (n.dependsOn ?? []).length === 0);
  if (roots.length === 0)
    return 'el DAG no tiene ningún nodo raíz (todos con dependencias): no arrancaría';
  if (hasCycle(def.nodes)) return 'el DAG contiene un ciclo de dependencias';
  return null;
}

/** Detección de ciclos por DFS con marcado tri-estado sobre las `key`s. */
function hasCycle(nodes: RunNodeInput[]): boolean {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (key: string): boolean => {
    const mark = state.get(key);
    if (mark === 'visiting') return true; // arista de retroceso ⇒ ciclo
    if (mark === 'done') return false;
    state.set(key, 'visiting');
    for (const dep of byKey.get(key)?.dependsOn ?? []) {
      if (visit(dep)) return true;
    }
    state.set(key, 'done');
    return false;
  };
  return nodes.some((n) => visit(n.key));
}
