import { expect, test } from 'vitest';
import type { StepSnapshot } from '@ugc/core/orchestrator';
import { stepsToGraph } from './steps-to-graph';

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

test('sin steps → grafo vacío', () => {
  const { nodes, edges } = stepsToGraph([]);
  expect(nodes).toHaveLength(0);
  expect(edges).toHaveLength(0);
});
