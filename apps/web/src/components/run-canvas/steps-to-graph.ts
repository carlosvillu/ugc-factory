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
// N7: el DAG de demo de F0 es lineal (N0–N5) y NO ejercita N7 (guard de alcance de
// T0.11). La agrupación se implementa igual (con sus tests) por fidelidad al
// contrato, keyed por el prefijo `N7` del node_key: la proyección SSE delgada NO
// porta `variant_id`, así que en F0 los N7a–N7e de un run caen en UN grupo. Cuando
// F2+ traiga variantes reales, el snapshot llevará `variantId` y el agrupado se
// afinará por variante (decisión explícita, no deriva silenciosa).
import type { Edge, Node } from '@xyflow/react';
import type { StepSnapshot } from '@ugc/core/orchestrator';
import { visualGroupOf, type StepVisualGroup, type StepStatus } from './status';

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
}

interface N7GroupData extends Record<string, unknown> {
  groupKey: string; // 'N7' (en F2+: por variante)
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
// nosotros con `groupKey='N7'`.
const N7_CHILD = /^N7[a-z]/i;
const N7_GROUP_KEY = 'N7';

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

  // 2. Agrupa los N7a–N7e en UN nodo de grupo (F0: sin variant_id ⇒ un grupo). El
  //    id del grupo es estable ('n7-group') para que expandir/colapsar sea idempotente.
  const groupId = 'n7-group';
  const expanded = opts.expandedVariants.has(N7_GROUP_KEY);
  let hasGroup = false;
  const [firstChild, ...restChildren] = n7Children;
  if (firstChild !== undefined) {
    hasGroup = true;
    const aggStatus = restChildren.reduce<StepStatus>(
      (acc, c) => worseStatus(acc, c.status),
      firstChild.status,
    );
    const groupNode: N7GroupNode = {
      id: groupId,
      type: 'n7-group',
      position: { x: 0, y: 0 },
      data: {
        groupKey: N7_GROUP_KEY,
        status: aggStatus,
        visualGroup: visualGroupOf(aggStatus),
        childCount: n7Children.length,
        expanded,
      },
    };
    nodes.push(groupNode);
    // Si el grupo está expandido, emite los hijos con parentId + extent 'parent'
    // (contrato de subflows de v12). Colapsado: los hijos NO se pintan.
    if (expanded) {
      for (const c of n7Children) {
        nodes.push({
          ...toStepNode(c),
          parentId: groupId,
          extent: 'parent',
        });
      }
    }
  }

  // 3. Edges desde dependsOn (dep → step). Si un extremo es un hijo N7 de un grupo
  //    COLAPSADO, la edge se remapea al grupo (con dedupe: N hijos no ⇒ N edges
  //    paralelas idénticas). Un extremo superseded/inexistente descarta la edge.
  const stepById = new Map(visible.map((s) => [s.id, s]));
  const childIds = new Set(n7Children.map((c) => c.id));

  const resolveEndpoint = (id: string): string | null => {
    if (!stepById.has(id)) return null; // superseded o desconocido
    if (childIds.has(id)) {
      if (!hasGroup) return null;
      return expanded ? id : groupId; // colapsado ⇒ al grupo; expandido ⇒ el hijo
    }
    return id;
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
