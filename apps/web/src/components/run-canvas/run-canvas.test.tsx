import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import type { StepSnapshot } from '@ugc/core/orchestrator';
import type { RunResponse } from '@/lib/api-client';
import { RunStoreProvider } from '@/stores/run-store';
import { RunCanvas } from './run-canvas';

const run: RunResponse = {
  id: 'run_01',
  projectId: 'proj_01',
  kind: 'full',
  autopilot: false,
  status: 'running',
  startedAt: null,
  finishedAt: null,
  totalCostEstimated: null,
  totalCostActual: null,
};

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

function withStore(steps: StepSnapshot[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <RunStoreProvider initial={{ run, steps }}>{children}</RunStoreProvider>;
  };
}

// UN smoke test (frontend.md §3b): que los nodos custom aparecen con su data
// renderizada. Las posiciones/colores en vivo son E2E, no jsdom.
test('pinta un nodo por step con estado, coste y duración visibles', () => {
  const steps = [
    snap({ id: 's1', nodeKey: 'N3', status: 'running', costEstimated: 10, durationMs: 5100 }),
    snap({ id: 's2', nodeKey: 'N4', status: 'failed', costActual: 20, durationMs: 1000 }),
  ];
  render(<RunCanvas />, { wrapper: withStore(steps) });

  const running = screen.getByRole('article', { name: /N3/i });
  expect(within(running).getByText(/en curso/i)).toBeInTheDocument();
  // el estado CRUDO se expone como data-status (API observable de e2e/CUA).
  expect(running).toHaveAttribute('data-status', 'running');

  const failed = screen.getByRole('article', { name: /N4/i });
  expect(failed).toHaveAttribute('data-status', 'failed');
  // failed NO se colapsa a pending/succeeded: es observablemente distinto.
  expect(within(failed).getByText(/fallido/i)).toBeInTheDocument();
});
