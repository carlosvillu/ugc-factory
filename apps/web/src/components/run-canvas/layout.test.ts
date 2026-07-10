import { expect, test } from 'vitest';
import type { AppEdge, AppNode } from './steps-to-graph';
import { layoutGraph } from './layout';

function stepNode(id: string): AppNode {
  return {
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: {
      stepId: id,
      nodeKey: id,
      status: 'pending',
      visualGroup: 'pending',
      isCheckpoint: false,
      costEstimated: null,
      costActual: null,
      durationMs: null,
      outputExcerpt: null,
      errorExcerpt: null,
    },
  };
}

const chain = (): { nodes: AppNode[]; edges: AppEdge[] } => ({
  nodes: [stepNode('a'), stepNode('b'), stepNode('c')],
  edges: [
    { id: 'a->b', source: 'a', target: 'b' },
    { id: 'b->c', source: 'b', target: 'c' },
  ],
});

test('determinista: mismo input → mismas posiciones', () => {
  const r1 = layoutGraph(chain());
  const r2 = layoutGraph(chain());
  expect(r1.nodes.map((n) => n.position)).toEqual(r2.nodes.map((n) => n.position));
});

test('layout LR: los nodos de la cadena crecen en X (izq→der)', () => {
  const { nodes } = layoutGraph(chain());
  const byId = new Map(nodes.map((n) => [n.id, n.position.x]));
  expect(byId.get('a')!).toBeLessThan(byId.get('b')!);
  expect(byId.get('b')!).toBeLessThan(byId.get('c')!);
});

test('todos los nodos reciben una posición numérica', () => {
  const { nodes } = layoutGraph(chain());
  for (const n of nodes) {
    expect(Number.isFinite(n.position.x)).toBe(true);
    expect(Number.isFinite(n.position.y)).toBe(true);
  }
});

test('los hijos (parentId) se posicionan relativos al padre, no vía dagre', () => {
  const parent: AppNode = {
    id: 'g',
    type: 'n7-group',
    position: { x: 0, y: 0 },
    data: {
      groupKey: 'N7',
      status: 'running',
      visualGroup: 'running',
      childCount: 2,
      expanded: true,
    },
  };
  const child1 = { ...stepNode('c1'), parentId: 'g' as const };
  const child2 = { ...stepNode('c2'), parentId: 'g' as const };
  const { nodes } = layoutGraph({ nodes: [parent, child1, child2], edges: [] });
  const c1 = nodes.find((n) => n.id === 'c1')!;
  const c2 = nodes.find((n) => n.id === 'c2')!;
  // apilados verticalmente dentro del padre: misma x, y creciente.
  expect(c1.position.x).toBe(c2.position.x);
  expect(c2.position.y).toBeGreaterThan(c1.position.y);
});
