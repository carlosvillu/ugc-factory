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
      variantId: null,
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

// La altura REAL con la que se pinta un nodo hijo N7 (= la del step, ver `SIZE.step`
// en layout.ts). El sub-layout DEBE separar los hijos al menos esto, o se solapan.
const CHILD_RENDER_HEIGHT = 124;

function groupNode(id: string, childCount: number, expanded: boolean): AppNode {
  return {
    id,
    type: 'n7-group',
    position: { x: 0, y: 0 },
    data: {
      groupKey: id,
      variantId: id === 'N7' ? null : id,
      status: 'running',
      visualGroup: 'running',
      childCount,
      expanded,
    },
  };
}

test('los hijos (parentId) se posicionan relativos al padre, no vía dagre', () => {
  const parent = groupNode('g', 2, true);
  const child1 = { ...stepNode('c1'), parentId: 'g' as const };
  const child2 = { ...stepNode('c2'), parentId: 'g' as const };
  const { nodes } = layoutGraph({ nodes: [parent, child1, child2], edges: [] });
  const c1 = nodes.find((n) => n.id === 'c1')!;
  const c2 = nodes.find((n) => n.id === 'c2')!;
  // apilados verticalmente dentro del padre: misma x, y creciente.
  expect(c1.position.x).toBe(c2.position.x);
  expect(c2.position.y).toBeGreaterThan(c1.position.y);
});

// T4.11 — CONTROL de no-solape de los HIJOS entre sí. El bug original: la zancada
// vertical (84) era MENOR que la altura del hijo (124) → cada hijo tapaba al de arriba
// e interceptaba su click. La zancada debe ser ≥ altura del hijo. CONTROL NEGATIVO:
// bajar `CHILD_STRIDE` en layout.ts por debajo de 124 pone este test ROJO.
test('los hijos N7 expandidos NO se solapan verticalmente (zancada ≥ altura del hijo)', () => {
  const parent = groupNode('g', 5, true);
  const children = [0, 1, 2, 3, 4].map((i) => ({
    ...stepNode(`c${String(i)}`),
    parentId: 'g' as const,
  }));
  const { nodes } = layoutGraph({ nodes: [parent, ...children], edges: [] });
  const ys = children
    .map((c) => nodes.find((n) => n.id === c.id)!.position.y)
    .sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) {
    // el borde inferior del hijo i-1 no pisa el borde superior del hijo i.
    expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(CHILD_RENDER_HEIGHT);
  }
});

// T4.11 — CONTROL de no-solape del GRUPO expandido con sus VECINOS de nivel superior.
// dagre solo ve el nivel superior; si el grupo expandido no reservara su altura real
// (`groupHeight`), los vecinos que comparten su columna caerían DENTRO de la pila de
// hijos. Se afirma que las cajas envolventes (bounding boxes con la altura RESERVADA de
// cada nodo) de dos nodos cualesquiera de nivel superior no se solapan. CONTROL
// NEGATIVO: hacer que `groupHeight` devuelva la altura colapsada aun expandido → el
// grupo reserva 120, dagre apila un vecino a ~120 px y las cajas se cruzan → ROJO.
test('un grupo N7 expandido reserva su altura real: su caja no solapa la de vecinos de nivel superior', () => {
  const childCount = 5;
  const parent = groupNode('g', childCount, true);
  const children = Array.from({ length: childCount }, (_v, i) => ({
    ...stepNode(`c${String(i)}`),
    parentId: 'g' as const,
  }));
  // Tres vecinos de nivel superior SIN edges → dagre los reparte en la misma banda X que
  // el grupo, apilándolos en Y (es justo el caso donde el solape aparecía).
  const siblings = ['s0', 's1', 's2'].map(stepNode);
  const { nodes } = layoutGraph({ nodes: [parent, ...siblings, ...children], edges: [] });

  // Caja envolvente [x1,y1,x2,y2] con la altura RESERVADA real de cada nodo de nivel
  // superior: el grupo expandido mide su pila; los steps, 124.
  const GROUP_RESERVED = 40 + childCount * (CHILD_RENDER_HEIGHT + 16) + 16; // = groupHeight
  const topLevel = nodes.filter((n) => !n.parentId);
  const box = (n: (typeof topLevel)[number]) => {
    const h = n.type === 'n7-group' ? GROUP_RESERVED : CHILD_RENDER_HEIGHT;
    return { x1: n.position.x, y1: n.position.y, x2: n.position.x + 224, y2: n.position.y + h };
  };
  const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

  for (let i = 0; i < topLevel.length; i++) {
    for (let j = i + 1; j < topLevel.length; j++) {
      expect(
        overlaps(box(topLevel[i]!), box(topLevel[j]!)),
        `${topLevel[i]!.id} y ${topLevel[j]!.id} no deben solaparse`,
      ).toBe(false);
    }
  }
});
