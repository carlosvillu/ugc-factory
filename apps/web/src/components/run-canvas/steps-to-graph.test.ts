import { expect, test } from 'vitest';
import type { StepSnapshot } from '@ugc/core/orchestrator';
import { stepsToGraph } from './steps-to-graph';
import { groupHeight, layoutGraph } from './layout';

// Helper local: un StepSnapshot válido con overrides. La proyección SSE no tiene
// factory en @ugc/test-utils (las factories hacen filas de BD); se construye aquí.
function snap(
  overrides: Partial<StepSnapshot> & Pick<StepSnapshot, 'id' | 'nodeKey'>,
): StepSnapshot {
  return {
    status: 'pending',
    cost: null,
    outputExcerpt: null,
    dependsOn: [],
    isCheckpoint: false,
    costEstimated: null,
    costActual: null,
    durationMs: null,
    errorExcerpt: null,
    variantId: null,
    ...overrides,
  };
}

test('un nodo por step con su data proyectada (estado, coste, checkpoint)', () => {
  const steps = [
    snap({ id: 's1', nodeKey: 'N1', status: 'succeeded', costActual: 12 }),
    snap({
      id: 's2',
      nodeKey: 'N2',
      status: 'waiting_approval',
      isCheckpoint: true,
      dependsOn: ['s1'],
    }),
  ];
  const { nodes } = stepsToGraph(steps);
  expect(nodes).toHaveLength(2);
  expect(nodes.find((n) => n.id === 's1')?.data).toMatchObject({
    nodeKey: 'N1',
    status: 'succeeded',
    costActual: 12,
    visualGroup: 'done',
  });
  expect(nodes.find((n) => n.id === 's2')?.data).toMatchObject({
    status: 'waiting_approval',
    isCheckpoint: true,
    visualGroup: 'checkpoint',
  });
});

test('las edges salen de dependsOn (dep → step)', () => {
  const steps = [
    snap({ id: 's1', nodeKey: 'N0' }),
    snap({ id: 's2', nodeKey: 'N1', dependsOn: ['s1'] }),
    snap({ id: 's3', nodeKey: 'N2', dependsOn: ['s2'] }),
  ];
  const { edges } = stepsToGraph(steps);
  expect(edges).toContainEqual(expect.objectContaining({ source: 's1', target: 's2' }));
  expect(edges).toContainEqual(expect.objectContaining({ source: 's2', target: 's3' }));
  expect(edges).toHaveLength(2);
});

test('los steps superseded NO se pintan como nodos (van al panel)', () => {
  const steps = [
    snap({ id: 'old', nodeKey: 'N1', status: 'superseded' }),
    snap({ id: 'new', nodeKey: 'N1', status: 'running' }),
  ];
  const { nodes } = stepsToGraph(steps);
  expect(nodes.map((n) => n.id)).toEqual(['new']);
});

test('una edge hacia un step superseded se descarta (no cuelga)', () => {
  const steps = [
    snap({ id: 'gone', nodeKey: 'N0', status: 'superseded' }),
    snap({ id: 's2', nodeKey: 'N1', dependsOn: ['gone'] }),
  ];
  const { edges } = stepsToGraph(steps);
  expect(edges).toHaveLength(0);
});

test('el estado agregado del grupo N7 es el peor estado de sus hijos', () => {
  const steps = [
    snap({ id: 'a', nodeKey: 'N7a', status: 'succeeded' }),
    snap({ id: 'b', nodeKey: 'N7b', status: 'running' }),
    snap({ id: 'c', nodeKey: 'N7c', status: 'succeeded' }),
  ];
  const { nodes } = stepsToGraph(steps);
  const group = nodes.find((n) => n.type === 'n7-group');
  expect(group).toBeDefined();
  expect(group?.data).toMatchObject({ status: 'running', childCount: 3 });
  // colapsado por defecto: los hijos NO se pintan.
  expect(nodes.filter((n) => n.type === 'step')).toHaveLength(0);
});

test('el grupo N7 expandido emite sus hijos con parentId', () => {
  const steps = [
    snap({ id: 'a', nodeKey: 'N7a', status: 'succeeded' }),
    snap({ id: 'b', nodeKey: 'N7b', status: 'running' }),
  ];
  const { nodes } = stepsToGraph(steps, { expandedVariants: new Set(['N7']) });
  const children = nodes.filter((n) => n.type === 'step');
  expect(children).toHaveLength(2);
  expect(children.every((c) => c.parentId === 'n7-group')).toBe(true);
});

// T4.11 — la caja del nodo de grupo N7 mide su altura REAL (contrato de subflows de React Flow:
// `extent:'parent'` recorta los hijos a la caja del padre). Colapsado = 120; expandido = `groupHeight`.
// El altura es la MISMA fuente que dagre reserva en layout.ts.
test('el nodo de grupo N7 fija height/width: colapsado 120, expandido = groupHeight', () => {
  const steps = [
    snap({ id: 'a', nodeKey: 'N7a', status: 'succeeded' }),
    snap({ id: 'b', nodeKey: 'N7b', status: 'succeeded' }),
    snap({ id: 'c', nodeKey: 'N7c', status: 'succeeded' }),
  ];
  const collapsed = stepsToGraph(steps).nodes.find((n) => n.type === 'n7-group')!;
  expect(collapsed.height).toBe(groupHeight(false, 3));
  expect(collapsed.width).toBeGreaterThan(0);

  const expanded = stepsToGraph(steps, { expandedVariants: new Set(['N7']) }).nodes.find(
    (n) => n.type === 'n7-group',
  )!;
  expect(expanded.height).toBe(groupHeight(true, 3));
});

// T4.11 — CONTROL de que los hijos CABEN en la caja del grupo expandido (si no, `extent:'parent'` los
// recorta/solapa y el click se intercepta, que es el bug que esto blinda). Se afirma que el borde
// inferior de cada hijo (posición relativa + altura del step) no rebasa la height del grupo. CONTROL
// NEGATIVO: forzar la height del grupo a la colapsada (120) con expanded=true → el hijo más bajo la
// rebasa → ROJO (demuestra la mordida).
test('los hijos del grupo N7 expandido CABEN dentro de la height reservada del grupo', () => {
  const CHILD_RENDER_HEIGHT = 124; // = SIZE.step.height en layout.ts
  const steps = [
    snap({ id: 'a', nodeKey: 'N7a', status: 'succeeded' }),
    snap({ id: 'b', nodeKey: 'N7b', status: 'succeeded' }),
    snap({ id: 'c', nodeKey: 'N7c', status: 'succeeded' }),
    snap({ id: 'd', nodeKey: 'N7d', status: 'succeeded' }),
    snap({ id: 'e', nodeKey: 'N7e', status: 'succeeded' }),
  ];
  const { nodes } = layoutGraph(stepsToGraph(steps, { expandedVariants: new Set(['N7']) }));
  const group = nodes.find((n) => n.type === 'n7-group')!;
  const children = nodes.filter((n) => n.parentId === group.id);
  expect(children).toHaveLength(5);
  const boxH = group.height!;
  for (const c of children) {
    // posición del hijo es relativa al grupo (contrato v12): su borde inferior debe caber en la caja.
    expect(c.position.y + CHILD_RENDER_HEIGHT).toBeLessThanOrEqual(boxH);
  }
});

test('edge hacia un hijo N7 colapsado se remapea al grupo (con dedupe)', () => {
  const steps = [
    snap({ id: 'src', nodeKey: 'N6', status: 'succeeded' }),
    snap({ id: 'a', nodeKey: 'N7a', dependsOn: ['src'] }),
    snap({ id: 'b', nodeKey: 'N7b', dependsOn: ['src'] }),
  ];
  const { edges } = stepsToGraph(steps); // colapsado
  // dos hijos con la misma dep → UNA sola edge src→grupo (dedupe), no dos.
  expect(edges).toHaveLength(1);
  expect(edges[0]).toMatchObject({ source: 'src', target: 'n7-group' });
});

// ── Agrupación POR VARIANTE (T4.11) ──────────────────────────────────────────────────
test('los N7 de variantes distintas caen en grupos DISTINTOS (uno por variante)', () => {
  const steps = [
    snap({ id: 'a1', nodeKey: 'N7a', variantId: 'V1', status: 'succeeded' }),
    snap({ id: 'b1', nodeKey: 'N7b', variantId: 'V1', status: 'running' }),
    snap({ id: 'a2', nodeKey: 'N7a', variantId: 'V2', status: 'failed' }),
    snap({ id: 'b2', nodeKey: 'N7b', variantId: 'V2', status: 'succeeded' }),
  ];
  const { nodes } = stepsToGraph(steps);
  const groups = nodes.filter((n) => n.type === 'n7-group');
  // DOS grupos, no uno: sin `variantId` en el snapshot todos caerían juntos (el bug que
  // T4.11 cierra). Cada grupo lleva SU variante y el peor estado de SUS hijos.
  expect(groups).toHaveLength(2);
  const byVariant = new Map(groups.map((g) => [(g.data as { variantId: string }).variantId, g]));
  expect(byVariant.get('V1')?.data).toMatchObject({ status: 'running', childCount: 2 });
  expect(byVariant.get('V2')?.data).toMatchObject({ status: 'failed', childCount: 2 });
});

test('expandir UNA variante no expande la otra (expandedVariants keyed por variantId)', () => {
  const steps = [
    snap({ id: 'a1', nodeKey: 'N7a', variantId: 'V1' }),
    snap({ id: 'a2', nodeKey: 'N7a', variantId: 'V2' }),
  ];
  const { nodes } = stepsToGraph(steps, { expandedVariants: new Set(['V1']) });
  const children = nodes.filter((n) => n.type === 'step');
  // Solo el hijo de V1 se pinta (con parentId de SU grupo); el de V2 sigue colapsado.
  expect(children).toHaveLength(1);
  expect(children[0]).toMatchObject({ id: 'a1', parentId: 'n7-group-V1' });
});

test('edges se remapean al grupo de LA variante correcta al colapsar', () => {
  const steps = [
    snap({ id: 'n6v1', nodeKey: 'N6', variantId: 'V1', status: 'succeeded' }),
    snap({ id: 'n6v2', nodeKey: 'N6', variantId: 'V2', status: 'succeeded' }),
    snap({ id: 'a1', nodeKey: 'N7a', variantId: 'V1', dependsOn: ['n6v1'] }),
    snap({ id: 'a2', nodeKey: 'N7a', variantId: 'V2', dependsOn: ['n6v2'] }),
  ];
  const { edges } = stepsToGraph(steps); // colapsado
  // Cada N6 apunta al grupo de SU variante — no se cruzan.
  expect(edges).toContainEqual(expect.objectContaining({ source: 'n6v1', target: 'n7-group-V1' }));
  expect(edges).toContainEqual(expect.objectContaining({ source: 'n6v2', target: 'n7-group-V2' }));
  expect(edges).toHaveLength(2);
});

test('sin steps → grafo vacío', () => {
  const { nodes, edges } = stepsToGraph([]);
  expect(nodes).toHaveLength(0);
  expect(edges).toHaveLength(0);
});
