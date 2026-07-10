// Unit puro de la definición de DAG (T0.7b): estado inicial por nodo y validación
// estructural. Sin BD — es lógica pura (unit-core.md).
import { describe, expect, it } from 'vitest';
import { initialStatus, validateDag } from './run-definition';
import type { RunDefinitionInput } from './run-definition';

describe('initialStatus', () => {
  it('root (sin deps) ⇒ pending', () => {
    expect(initialStatus({ key: 'A', nodeKey: 'demo.sleep', dependsOn: [] })).toBe('pending');
  });
  it('con deps ⇒ awaiting_deps', () => {
    expect(initialStatus({ key: 'B', nodeKey: 'demo.sleep', dependsOn: ['A'] })).toBe(
      'awaiting_deps',
    );
  });
});

describe('validateDag', () => {
  const base = (nodes: RunDefinitionInput['nodes']): RunDefinitionInput => ({
    projectId: 'p',
    nodes,
  });

  it('cadena válida N0→N1→N2 ⇒ null', () => {
    expect(
      validateDag(
        base([
          { key: 'N0', nodeKey: 'demo.sleep.N0', dependsOn: [] },
          { key: 'N1', nodeKey: 'demo.sleep.N1', dependsOn: ['N0'] },
          { key: 'N2', nodeKey: 'demo.sleep.N2', dependsOn: ['N1'] },
        ]),
      ),
    ).toBeNull();
  });

  it('clave duplicada ⇒ error', () => {
    expect(
      validateDag(
        base([
          { key: 'A', nodeKey: 'demo.sleep', dependsOn: [] },
          { key: 'A', nodeKey: 'demo.sleep', dependsOn: [] },
        ]),
      ),
    ).toMatch(/duplicada/);
  });

  it('node_key duplicado en el run ⇒ error (aunque las keys sean distintas)', () => {
    // Dos nodos con `key` distinta pero el MISMO node_key colisionarían en el
    // singletonKey de encolado (`${runId}:${nodeKey}`, policy short): el segundo
    // quedaría queued sin job. La frontera debe rechazarlo.
    expect(
      validateDag(
        base([
          { key: 'A', nodeKey: 'demo.sleep', dependsOn: [] },
          { key: 'B', nodeKey: 'demo.sleep', dependsOn: ['A'] },
        ]),
      ),
    ).toMatch(/node_key duplicado/);
  });

  it('dependencia colgante ⇒ error', () => {
    expect(validateDag(base([{ key: 'A', nodeKey: 'demo.sleep', dependsOn: ['NOPE'] }]))).toMatch(
      /inexistente/,
    );
  });

  it('sin ningún root ⇒ error', () => {
    expect(
      validateDag(
        base([
          { key: 'A', nodeKey: 'demo.a', dependsOn: ['B'] },
          { key: 'B', nodeKey: 'demo.b', dependsOn: ['A'] },
        ]),
      ),
    ).toMatch(/raíz|ciclo/);
  });

  it('ciclo (con root) ⇒ error de ciclo', () => {
    // A es root; B↔C forman un ciclo aparte. node_keys distintos para aislar el
    // fallo al ciclo (no a node_key duplicado, que se comprueba antes).
    expect(
      validateDag(
        base([
          { key: 'A', nodeKey: 'demo.a', dependsOn: [] },
          { key: 'B', nodeKey: 'demo.b', dependsOn: ['C'] },
          { key: 'C', nodeKey: 'demo.c', dependsOn: ['B'] },
        ]),
      ),
    ).toMatch(/ciclo/);
  });
});
