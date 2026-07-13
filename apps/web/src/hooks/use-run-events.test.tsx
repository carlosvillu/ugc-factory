import { renderHook, act, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource } from '@ugc/test-utils';
import type { RunResponse } from '@/lib/api-client';
import { RunStoreProvider, useRunStore } from '@/stores/run-store';
import { useRunEvents } from './use-run-events';

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

// Sin globals:true en vitest, la auto-limpieza de testing-library no corre: los
// hooks montados en un test dejarían su listener de `visibilitychange` vivo y
// contaminarían el test de visibilidad (streams zombis cruzando tests). Desmonta
// explícitamente entre tests.
afterEach(() => {
  cleanup();
});

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

function wrapper({ children }: { children: ReactNode }) {
  return <RunStoreProvider initial={{ run }}>{children}</RunStoreProvider>;
}

// Un StepSnapshot de SSE completo (la forma que el frame `data:` porta).
function snap(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    nodeKey: id,
    status,
    cost: null,
    outputExcerpt: null,
    dependsOn: [],
    isCheckpoint: false,
    costEstimated: null,
    costActual: null,
    durationMs: null,
    errorExcerpt: null,
    ...extra,
  };
}

// El hook lee del store; para observar los steps montamos ADEMÁS un selector.
function useHarness(runId: string) {
  const { status } = useRunEvents(runId);
  const steps = useRunStore((s) => s.steps);
  return { status, steps };
}

test('snapshot puebla el estado; un delta actualiza solo su step; heartbeat no re-renderiza', () => {
  const { result } = renderHook(() => useHarness('run_01'), { wrapper });
  const es = FakeEventSource.last();

  act(() => {
    es.open();
    es.emit(
      'snapshot',
      {
        event: 'snapshot',
        runId: 'run_01',
        steps: [snap('s1', 'running'), snap('s2', 'awaiting_deps')],
      },
      '1',
    );
  });
  expect(result.current.steps.s1?.status).toBe('running');
  expect(result.current.steps.s2?.status).toBe('awaiting_deps');

  act(() => {
    es.emit(
      'step_changed',
      {
        event: 'step_changed',
        ...snap('s1', 'succeeded', { costActual: 20, durationMs: 5100 }),
        stepId: 's1',
      },
      '2',
    );
  });
  expect(result.current.steps.s1?.status).toBe('succeeded');
  expect(result.current.steps.s1?.costActual).toBe(20);
  expect(result.current.steps.s2?.status).toBe('awaiting_deps'); // el delta no toca al resto

  const before = result.current.steps;
  act(() => {
    es.emit('heartbeat', { event: 'heartbeat', ts: 1 }, '3');
  });
  expect(result.current.steps).toBe(before); // heartbeat no cambia la referencia de steps
});

test('tras reconectar, el re-snapshot SUSTITUYE (sin steps fantasma)', () => {
  const { result } = renderHook(() => useHarness('run_01'), { wrapper });
  const es1 = FakeEventSource.last();
  act(() => {
    es1.open();
    es1.emit(
      'snapshot',
      { event: 'snapshot', runId: 'run_01', steps: [snap('s1', 'running')] },
      '1',
    );
  });
  expect(result.current.steps.s1).toBeDefined();

  // el navegador reconecta (nueva instancia): el server re-snapshotea con s1
  // superseded → s1b, y s1 ya no aparece.
  act(() => {
    es1.readyState = FakeEventSource.CLOSED;
    es1.fail();
  });
  const es2 = FakeEventSource.last();
  act(() => {
    es2.open();
    es2.emit(
      'snapshot',
      { event: 'snapshot', runId: 'run_01', steps: [snap('s1b', 'succeeded')] },
      '9',
    );
  });
  expect(result.current.steps.s1b).toBeDefined();
  expect(result.current.steps.s1).toBeUndefined(); // sustituye, no mergea
});

test('un evento con shape inválido se ignora (forward-compat), no rompe el stream', () => {
  const { result } = renderHook(() => useHarness('run_01'), { wrapper });
  const es = FakeEventSource.last();
  act(() => {
    es.open();
    es.emit(
      'snapshot',
      { event: 'snapshot', runId: 'run_01', steps: [snap('s1', 'running')] },
      '1',
    );
    // un delta con status inexistente: el safeParse falla → ignorado.
    es.emit('step_changed', { event: 'step_changed', stepId: 's1', status: 'NOT_A_STATUS' }, '2');
  });
  expect(result.current.steps.s1?.status).toBe('running'); // intacto
});

test('montada en segundo plano NO abre stream; al enfocar abre exactamente uno', () => {
  // Simula la pestaña oculta al montar (cmd+click). El connect inicial NO debe
  // disparar; sin la guarda de visibilidad se filtraría un segundo stream al enfocar.
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  try {
    renderHook(() => useHarness('run_01'), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(0); // oculta ⇒ ningún stream

    // Al enfocar: exactamente UN stream (close-then-connect no deja zombis).
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(FakeEventSource.instances).toHaveLength(1); // enfocar abre UNO, no dos
  } finally {
    visibility.mockRestore();
  }
});
