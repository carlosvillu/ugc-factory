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
  costActualCents: 0, // el coste REAL del run: lo agrega el servidor desde el ledger (T1.17)
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

// T1.16: el nodo pinta el TÍTULO HUMANO del §7.2 como texto principal, la clave como
// badge — y el accessible name SIGUE llevando la clave (es la API de los tests e2e/jsdom:
// romperlo rompería `getByRole('article', {name:/N3/i})` en toda la suite).
test('el nodo muestra el título humano y conserva la clave en el accessible name', () => {
  const steps = [
    snap({ id: 's1', nodeKey: 'N2', status: 'running' }),
    // Clave PREFIJADA por el DAG (el de demo emite `demo.canvas.N3`): el título se
    // resuelve igual, y el accessible name conserva la clave COMPLETA con su prefijo.
    snap({ id: 's2', nodeKey: 'demo.canvas.N3', status: 'succeeded' }),
  ];
  render(<RunCanvas />, { wrapper: withStore(steps) });

  const n2 = screen.getByRole('article', { name: /\bN2\b/ });
  expect(within(n2).getByText('Análisis visual')).toBeInTheDocument();
  expect(within(n2).getByText('N2')).toBeInTheDocument(); // la clave sigue visible (badge)

  const n3 = screen.getByRole('article', { name: /demo\.canvas\.N3/ });
  expect(within(n3).getByText('ProductBrief')).toBeInTheDocument();
  expect(within(n3).getByText('demo.canvas.N3')).toBeInTheDocument();
});
