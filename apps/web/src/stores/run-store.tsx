'use client';

// Store del run en vivo (state-and-sse.md §2): factory + provider + hook. SIN store
// global de módulo (contaminaría requests SSR y dejaría steps zombis al navegar):
// una instancia por montaje de página, creada con useRef `??=` en render.
//
// Reparto de fuentes (T0.11, decisión de contrato): el objeto RUN (autopilot, kind,
// status) viene por REST (`GET /api/runs/:id`) y siembra el store; los STEPS vienen
// por SSE — el snapshot inicial NO se pre-carga por REST, llega en el primer frame
// `snapshot` del stream (useRunEvents lo aplica al montar). Por eso `steps` arranca
// vacío y `applySnapshot` lo puebla en cuanto conecta el SSE.
import { createContext, use, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { RunSnapshot, StepChangedEvent, StepSnapshot } from '@ugc/core/orchestrator';
import type { RunResponse } from '@/lib/api-client';
import { applyRunEvent, indexSteps } from './apply-event';

// El objeto run del store es la respuesta REST del cliente (`RunResponse`): las
// fechas viajan como ISO string, el status como string. El store solo usa
// id/kind/autopilot/status para la cabecera — el detalle de tipos de la fila de BD
// (RunView) no cruza al cliente.
type RunClientView = RunResponse;

interface RunState {
  run: RunClientView; // objeto run desde REST (autopilot/kind/status/id)
  steps: Record<string, StepSnapshot>; // indexado por step id — O(1) para los deltas
  selectedStepId: string | null; // step abierto en el panel lateral
  autopilot: boolean; // toggle de cabecera; seed desde run.autopilot
  expandedVariants: ReadonlySet<string>; // grupos N7 expandidos en el canvas
}

interface RunActions {
  applySnapshot: (snapshot: RunSnapshot) => void; // SUSTITUYE steps (§9.0)
  applyStepChanged: (delta: StepChangedEvent) => void; // delta solo a su step
  selectStep: (stepId: string | null) => void;
  setAutopilot: (on: boolean) => void; // solo estado local; el PATCH va por api-client
  toggleVariantExpanded: (variantId: string) => void; // expandir/colapsar grupo N7
}

export type RunStore = RunState & RunActions;

export interface RunStoreInitial {
  run: RunClientView;
  // Steps iniciales OPCIONALES: la página no los pre-carga (llegan por SSE), pero
  // los tests siembran un snapshot inicial para no depender del fake de EventSource.
  steps?: StepSnapshot[];
}

const createRunStore = (initial: RunStoreInitial) =>
  createStore<RunStore>()((set) => ({
    run: initial.run,
    steps: indexSteps(initial.steps ?? []),
    selectedStepId: null,
    autopilot: initial.run.autopilot,
    expandedVariants: new Set<string>(),
    applySnapshot: (snapshot) => {
      set((s) =>
        applyRunEvent(s, { event: 'snapshot', runId: snapshot.runId, steps: snapshot.steps }),
      );
    },
    applyStepChanged: (delta) => {
      set((s) => applyRunEvent(s, delta));
    },
    selectStep: (selectedStepId) => {
      set({ selectedStepId });
    },
    setAutopilot: (autopilot) => {
      set({ autopilot });
    },
    toggleVariantExpanded: (variantId) => {
      set((s) => {
        const next = new Set(s.expandedVariants);
        if (next.has(variantId)) next.delete(variantId);
        else next.add(variantId);
        return { expandedVariants: next };
      });
    },
  }));

type RunStoreApi = ReturnType<typeof createRunStore>;

const RunStoreContext = createContext<RunStoreApi | null>(null);

export function RunStoreProvider({
  initial,
  children,
}: {
  initial: RunStoreInitial;
  children: ReactNode;
}) {
  // useState con inicializador perezoso: crea el store EXACTAMENTE una vez por
  // montaje (una instancia por página; navegar a otro run monta un provider nuevo).
  // Preferido sobre useRef porque no accede a `.current` en render (la regla
  // react-hooks/refs lo veta) y da la misma garantía de una-vez.
  const [store] = useState(() => createRunStore(initial));
  return <RunStoreContext value={store}>{children}</RunStoreContext>;
}

export function useRunStore<T>(selector: (state: RunStore) => T): T {
  const store = use(RunStoreContext);
  if (store === null) {
    throw new Error('useRunStore requiere <RunStoreProvider> (client shell de /runs/[id])');
  }
  return useStore(store, selector);
}
