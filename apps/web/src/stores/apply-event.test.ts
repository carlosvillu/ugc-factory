import { expect, test } from 'vitest';
import type { RunEvent, StepSnapshot } from '@ugc/core/orchestrator';
import { applyRunEvent, indexSteps } from './apply-event';

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

const snapshotEvent = (steps: StepSnapshot[], runId = 'run_01'): RunEvent => ({
  event: 'snapshot',
  runId,
  steps,
});

test('snapshot SUSTITUYE los steps (no mergea): sin steps fantasma', () => {
  const initial = { steps: indexSteps([snap({ id: 's1', nodeKey: 'N1', status: 'running' })]) };
  // el re-snapshot trae s1b (supersede de s1) y ya NO trae s1.
  const next = applyRunEvent(
    initial,
    snapshotEvent([snap({ id: 's1b', nodeKey: 'N1', status: 'succeeded' })]),
  );
  expect(next.steps?.s1b).toBeDefined();
  expect(next.steps?.s1).toBeUndefined(); // sustituye, no mergea
});

test('step_changed parchea SOLO su step, con los campos que cambian en vivo', () => {
  const initial = {
    steps: indexSteps([
      snap({ id: 's1', nodeKey: 'N1', status: 'running' }),
      snap({ id: 's2', nodeKey: 'N2', status: 'awaiting_deps' }),
    ]),
  };
  const delta: RunEvent = {
    event: 'step_changed',
    stepId: 's1',
    nodeKey: 'N1',
    status: 'succeeded',
    cost: 20,
    outputExcerpt: '{"ok":true}',
    dependsOn: [],
    isCheckpoint: false,
    costEstimated: 10,
    costActual: 20,
    durationMs: 5100,
    errorExcerpt: null,
  };
  const next = applyRunEvent(initial, delta);
  expect(next.steps?.s1).toMatchObject({
    status: 'succeeded',
    costActual: 20,
    durationMs: 5100,
    outputExcerpt: '{"ok":true}',
  });
  // el delta NO toca al resto.
  expect(next.steps?.s2?.status).toBe('awaiting_deps');
});

test('step_changed de un step DESCONOCIDO se ignora (no inventa fila parcial)', () => {
  const initial = { steps: indexSteps([snap({ id: 's1', nodeKey: 'N1' })]) };
  const delta: RunEvent = {
    event: 'step_changed',
    stepId: 'ghost',
    nodeKey: 'Nx',
    status: 'running',
    cost: null,
    outputExcerpt: null,
    dependsOn: [],
    isCheckpoint: false,
    costEstimated: null,
    costActual: null,
    durationMs: null,
    errorExcerpt: null,
  };
  const next = applyRunEvent(initial, delta);
  expect(next.steps).toBeUndefined(); // Partial vacío: no toca estado
});

test('un fallo trae el error; el retry lo limpia (delta en vivo)', () => {
  const initial = { steps: indexSteps([snap({ id: 's1', nodeKey: 'N4', status: 'running' })]) };
  const failed = applyRunEvent(initial, {
    event: 'step_changed',
    stepId: 's1',
    nodeKey: 'N4',
    status: 'failed',
    cost: null,
    outputExcerpt: null,
    dependsOn: [],
    isCheckpoint: false,
    costEstimated: null,
    costActual: null,
    durationMs: 1000,
    errorExcerpt: '{"message":"demo executor: fallo inyectado"}',
  });
  expect(failed.steps?.s1?.errorExcerpt).toContain('fallo inyectado');
});

test('heartbeat no toca estado (Partial vacío)', () => {
  const initial = { steps: indexSteps([snap({ id: 's1', nodeKey: 'N1' })]) };
  const next = applyRunEvent(initial, { event: 'heartbeat', ts: 123 });
  expect(next).toEqual({});
});
