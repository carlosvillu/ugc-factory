// PURA: proyección `StepSnapshot[]` (la foto observable del run que alimenta el
// store, run-events.ts) → `{nodes, edges}` de React Flow (canvas.md §3). Toda la
// inteligencia del canvas vive aquí y en `layout.ts`; los componentes solo pintan.
// Testeada sin render (testing/frontend.md §3a).
//
// NOTA de contrato (T0.11): la firma de canvas.md muestra `stepsToGraph(run,
// StepRun[])`, pero el store del run guarda `StepSnapshot` (la proyección SSE, no
// la fila entera de persistencia — §9.0). El canvas deriva de esa proyección; no
// necesita el `PipelineRun` (el objeto run vive aparte en el store, sembrado por
// REST). Por eso la firma real es `stepsToGraph(steps: StepSnapshot[], opts?)`.
//
// N7: los sub-steps N7a–N7e de un run de GENERACIÓN (§7.2) se agrupan en un nodo
// compuesto POR VARIANTE (T4.11). La identidad de grupo es el `variantId` del step
// (proyectado al snapshot en T4.11): cada variante `scripted` recibe su propio grupo
// expandible con sus N7a–N7e. Un step N7 SIN `variantId` (el DAG de demo de F0, que no
// ejercita variantes) cae en el grupo genérico `'N7'` — el fallback que conserva los
// tests de T0.11. La clave del grupo (`variantId ?? 'N7'`) es también la que indexa
// `expandedVariants`, así que expandir/colapsar es por-variante.
import type { Edge, Node } from '@xyflow/react';
import type { StepSnapshot } from '@ugc/core/orchestrator';
import { visualGroupOf, type StepVisualGroup, type StepStatus } from './status';
import { groupHeight, GROUP_WIDTH } from './layout';

interface StepNodeData extends Record<string, unknown> {
  stepId: string;
  nodeKey: string;
  status: StepStatus;
  visualGroup: StepVisualGroup;
  isCheckpoint: boolean;
  costEstimated: number | null;
  costActual: number | null;
  durationMs: number | null;
  outputExcerpt: string | null;
  errorExcerpt: string | null;
  variantId: string | null;
}

interface N7GroupData extends Record<string, unknown> {
  groupKey: string; // 'N7' (F0 sin variante) o el `variantId` de la variante (T4.11)
  variantId: string | null; // la variante que este grupo materializa (null en el fallback F0)
  status: StepStatus; // estado agregado de los hijos (peor estado gana)
  visualGroup: StepVisualGroup;
  childCount: number;
  expanded: boolean;
}

export type StepNode = Node<StepNodeData, 'step'>;
export type N7GroupNode = Node<N7GroupData, 'n7-group'>;
export type AppNode = StepNode | N7GroupNode;
export type AppEdge = Edge;

export interface StepsToGraphOptions {
  expandedVariants: ReadonlySet<string>;
}

// Un node_key pertenece al sub-DAG N7 si empieza por 'N7' y tiene sufijo de letra
// (N7a…N7e). 'N7' pelado (sin letra) NO existe como step; el grupo lo emitimos
// nosotros.
const N7_CHILD = /^N7[a-z]/i;
// La clave del grupo genérico (fallback F0): los N7 sin `variantId` caen aquí. En
// producción cada grupo se keyed por su `variantId`.
const N7_FALLBACK_GROUP_KEY = 'N7';

// La clave de agrupación de un hijo N7: su variante, o el fallback genérico si no la
// trae (DAG de demo de F0). Es también la clave que indexa `expandedVariants`.
function groupKeyOf(child: StepSnapshot): string {
  return child.variantId ?? N7_FALLBACK_GROUP_KEY;
}

// El id de NODO React Flow del grupo de una clave: estable por clave (expandir/colapsar
// es idempotente) y único entre variantes. El fallback conserva el `'n7-group'` literal
// que esperan los tests de T0.11.
function groupNodeIdOf(groupKey: string): string {
  return groupKey === N7_FALLBACK_GROUP_KEY ? 'n7-group' : `n7-group-${groupKey}`;
}

// Orden de "peor estado gana" para el estado agregado de un grupo N7: un grupo con
// un hijo fallido se pinta fallido; con uno esperando aprobación, checkpoint; etc.
// Cuanto MAYOR el índice, más "prioritario" para representar el grupo.
const STATUS_PRIORITY: Record<StepStatus, number> = {
  succeeded: 0,
  skipped: 1,
  superseded: 1,
  cancelled: 2,
  rejected: 2,
  expired: 3,
  failed: 4,
  awaiting_deps: 5,
  pending: 5,
  queued: 6,
  submitting: 7,
  running: 8,
  waiting_approval: 9,
};

function worseStatus(a: StepStatus, b: StepStatus): StepStatus {
  return STATUS_PRIORITY[b] > STATUS_PRIORITY[a] ? b : a;
}

function toStepNode(s: StepSnapshot): StepNode {
  return {
    id: s.id,
    type: 'step',
    position: { x: 0, y: 0 }, // layout.ts posiciona
    data: {
      stepId: s.id,
      nodeKey: s.nodeKey,
      status: s.status,
      visualGroup: visualGroupOf(s.status),
      isCheckpoint: s.isCheckpoint,
      costEstimated: s.costEstimated,
      costActual: s.costActual,
      durationMs: s.durationMs,
      outputExcerpt: s.outputExcerpt,
      errorExcerpt: s.errorExcerpt,
      variantId: s.variantId,
    },
  };
}

export function stepsToGraph(
  steps: StepSnapshot[],
  opts: StepsToGraphOptions = { expandedVariants: new Set() },
): { nodes: AppNode[]; edges: AppEdge[] } {
  // 1. Descarta steps `superseded`: el linaje (supersedes_id) va al panel, no al
  //    grafo — pintar el histórico lo convertiría en una maraña ilegible (§8.2).
  const visible = steps.filter((s) => s.status !== 'superseded');

  const n7Children = visible.filter((s) => N7_CHILD.test(s.nodeKey));
  const regular = visible.filter((s) => !N7_CHILD.test(s.nodeKey));

  const nodes: AppNode[] = regular.map(toStepNode);

  // 2. Agrupa los N7a–N7e POR VARIANTE (`variantId ?? 'N7'`). Cada grupo es un nodo
  //    compuesto expandible con su propio id estable; el orden de aparición es el del
  //    primer hijo de cada variante (determinista respecto al orden de `steps`).
  const childrenByGroup = new Map<string, StepSnapshot[]>();
  for (const c of n7Children) {
    const key = groupKeyOf(c);
    const bucket = childrenByGroup.get(key);
    if (bucket === undefined) childrenByGroup.set(key, [c]);
    else bucket.push(c);
  }

  // A qué id de grupo se remapean las edges de un hijo COLAPSADO (stepId → groupNodeId). Un hijo de
  // grupo EXPANDIDO no se registra: conserva su propio id como endpoint (cae al `?? id` de `resolveEndpoint`).
  const collapsedChildToGroup = new Map<string, string>();

  for (const [groupKey, children] of childrenByGroup) {
    const groupId = groupNodeIdOf(groupKey);
    const expanded = opts.expandedVariants.has(groupKey);
    const [firstChild, ...restChildren] = children;
    if (firstChild === undefined) continue;
    const aggStatus = restChildren.reduce<StepStatus>(
      (acc, c) => worseStatus(acc, c.status),
      firstChild.status,
    );
    const groupNode: N7GroupNode = {
      id: groupId,
      type: 'n7-group',
      position: { x: 0, y: 0 },
      // Ancho/alto EXPLÍCITOS del nodo (contrato de subflows de React Flow v12): con `extent:'parent'`
      // los hijos se recortan a la caja del padre, así que la caja debe MEDIR lo que ocupa la pila de
      // hijos o el hit-test de pointer los solaparía (T4.11). La altura es la MISMA `groupHeight` que
      // dagre reserva en layout.ts (una sola fuente de verdad): colapsado 120, expandido = la pila.
      width: GROUP_WIDTH,
      height: groupHeight(expanded, children.length),
      data: {
        groupKey,
        variantId: firstChild.variantId,
        status: aggStatus,
        visualGroup: visualGroupOf(aggStatus),
        childCount: children.length,
        expanded,
      },
    };
    nodes.push(groupNode);
    for (const c of children) {
      if (expanded) {
        // Subflow de v12: parentId + extent 'parent'. El hijo conserva su id (NO se remapea).
        nodes.push({ ...toStepNode(c), parentId: groupId, extent: 'parent' });
      } else {
        // Colapsado: el hijo NO se pinta y sus edges se remapean al grupo.
        collapsedChildToGroup.set(c.id, groupId);
      }
    }
  }

  // 3. Edges desde dependsOn (dep → step). Si un extremo es un hijo N7 de un grupo
  //    COLAPSADO, la edge se remapea a SU grupo (con dedupe: N hijos no ⇒ N edges
  //    paralelas idénticas). Un extremo superseded/inexistente descarta la edge.
  const stepById = new Map(visible.map((s) => [s.id, s]));

  const resolveEndpoint = (id: string): string | null => {
    if (!stepById.has(id)) return null; // superseded o desconocido
    // hijo N7 de un grupo COLAPSADO ⇒ el id de su grupo; en cualquier otro caso (hijo expandido, nodo
    // normal) ⇒ su propio id.
    return collapsedChildToGroup.get(id) ?? id;
  };

  const edgeKeys = new Set<string>();
  const edges: AppEdge[] = [];
  for (const step of visible) {
    const target = resolveEndpoint(step.id);
    if (target === null) continue;
    for (const depId of step.dependsOn) {
      const source = resolveEndpoint(depId);
      if (source === null || source === target) continue; // self-loop (grupo→grupo) fuera
      const key = `${source}->${target}`;
      if (edgeKeys.has(key)) continue; // dedupe
      edgeKeys.add(key);
      edges.push({ id: key, source, target });
    }
  }

  return { nodes, edges };
}
