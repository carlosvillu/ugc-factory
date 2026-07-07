# Estado de cliente (Zustand) y cliente SSE

Cómo se modela el estado en vivo del run en `apps/web` (Zustand con factory + provider) y cómo entran los eventos SSE del orquestador (§9.0 del PRD) hasta el canvas. Los tests de todo lo de aquí los define `testing/references/frontend.md` (especialmente §4).

## Índice

1. [Decisión: Zustand sí, TanStack Query no (v1)](#1-decisión-zustand-sí-tanstack-query-no-v1)
2. [Store del run: factory + provider + hook](#2-store-del-run-factory--provider--hook)
3. [Reducer puro de eventos SSE: apply-event.ts](#3-reducer-puro-de-eventos-sse-apply-eventts)
4. [use-event-source.ts: el cliente SSE transversal](#4-use-event-sourcets-el-cliente-sse-transversal)
5. [use-run-events.ts: componer SSE + store](#5-use-run-eventsts-componer-sse--store)
6. [Otros stores](#6-otros-stores)
7. [Qué NO va aquí](#7-qué-no-va-aquí)

---

## 1. Decisión: Zustand sí, TanStack Query no (v1)

- **Zustand es el dueño del estado del run en vivo.** El run es estado compartido push-based: un snapshot + deltas SSE que consumen a la vez el canvas, el panel lateral y la cabecera. Eso es exactamente un store con selectores, no N `useState` sincronizados a mano.
- **SIN TanStack Query en v1.** Las listas (proyectos, galería, biblioteca, métricas) llegan por RSC + fetch al api-client (`references/architecture.md`); el estado vivo llega por SSE. Añadir RQ hoy sería una segunda capa de caché sin consumidor. Si duele (paginación con caché client-side, mutaciones optimistas repetidas, revalidación fina), se reevalúa **deliberadamente actualizando esta skill** — nunca con un `npm install` silencioso.
- **Sin stores globales de módulo.** Prohibido `create()` exportando un hook a nivel de módulo:

```ts
// ❌ PROHIBIDO: el módulo se comparte entre requests en el servidor (SSR) —
// el estado de un request contamina otro — y en cliente sobrevive a la navegación:
// vuelves a /runs/otro-id y ves los steps zombis del run anterior.
export const useRunStore = create<RunStore>()((set) => ({ /* ... */ }));
```

La alternativa obligatoria es el patrón de §2: **una instancia por montaje de página**, creada dentro del árbol de React.

## 2. Store del run: factory + provider + hook

Dos ficheros en `apps/web/src/stores/`: el reducer puro (`apply-event.ts`, §3) y `run-store.ts` (`'use client'`), que reúne las tres piezas del patrón — factory + provider + hook. La página `/runs/[id]` (RSC) hace fetch del snapshot vía api-client y monta `<RunStoreProvider initial={snapshot}>` alrededor del client shell.

```tsx
// apps/web/src/stores/run-store.ts
'use client';

import { createContext, use, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { RunSnapshot, StepChanged, StepRun, PipelineRun } from '@ugc/core/contracts';
import { applyRunEvent, indexSteps } from './apply-event';

export interface RunState {
  run: PipelineRun;
  steps: Record<string, StepRun>; // indexado por step_run.id — acceso O(1) para los deltas
  selectedStepId: string | null;  // step abierto en el panel lateral
  autopilot: boolean;             // toggle de cabecera (PRD §7.3); seed desde run.autopilot
  expandedVariants: ReadonlySet<string>; // grupos N7 expandidos en el canvas (canvas.md)
}

export interface RunActions {
  applySnapshot: (snapshot: RunSnapshot) => void;   // SUSTITUYE steps — contrato §9.0
  applyStepChanged: (delta: StepChanged) => void;   // delta solo a su step
  selectStep: (stepId: string | null) => void;
  setAutopilot: (on: boolean) => void;              // solo estado local; el PATCH va por api-client
  toggleVariantExpanded: (variantId: string) => void; // expandir/colapsar un grupo N7 (canvas.md)
}

export type RunStore = RunState & RunActions;

export const createRunStore = (initial: RunSnapshot) =>
  createStore<RunStore>()((set) => ({
    run: initial.run,
    steps: indexSteps(initial.steps),
    selectedStepId: null,
    autopilot: initial.run.autopilot,
    expandedVariants: new Set<string>(),
    applySnapshot: (snapshot) => set((s) => applyRunEvent(s, { type: 'snapshot', data: snapshot })),
    applyStepChanged: (delta) => set((s) => applyRunEvent(s, { type: 'step_changed', data: delta })),
    selectStep: (stepId) => set({ selectedStepId: stepId }),
    setAutopilot: (autopilot) => set({ autopilot }),
    toggleVariantExpanded: (variantId) =>
      set((s) => {
        const next = new Set(s.expandedVariants);
        next.has(variantId) ? next.delete(variantId) : next.add(variantId);
        return { expandedVariants: next };
      }),
  }));

export type RunStoreApi = ReturnType<typeof createRunStore>;

const RunStoreContext = createContext<RunStoreApi | null>(null);

export function RunStoreProvider({ initial, children }: { initial: RunSnapshot; children: ReactNode }) {
  const storeRef = useRef<RunStoreApi | null>(null);
  storeRef.current ??= createRunStore(initial); // lazy-init en render: una instancia por montaje
  return <RunStoreContext value={storeRef.current}>{children}</RunStoreContext>; // React 19: Context como provider
}

export function useRunStore<T>(selector: (state: RunStore) => T): T {
  const store = use(RunStoreContext);
  if (store === null) throw new Error('useRunStore requiere <RunStoreProvider> (client shell de /runs/[id])');
  return useStore(store, selector);
}
```

Por qué así y no de otra forma:

- **Factory + provider** porque la instancia nace y muere con la página: navegar a otro run monta un provider nuevo con SU snapshot — imposible el estado zombi. En SSR, cada render crea su instancia; nada vive en scope de módulo.
- **`useRef` + `??=`** para crear el store exactamente una vez por montaje (React permite la lazy-init de refs en render), no una vez por render.
- **Acciones de dominio, no `setState` genérico.** Los componentes llaman `applyStepChanged(delta)`, nunca `set({steps: ...})` a pelo: la transición vive en un solo sitio (el reducer de §3) y es testeable.
- **`initial` es el `RunSnapshot` del contrato**, no props sueltas: el mismo shape que emite el SSE al conectar, así el hidrato inicial y el re-snapshot pasan por el mismo código.

### Selectores

Un valor → selector directo. Varios valores → `useShallow` (de `zustand/react/shallow`): sin él, el objeto literal nuevo de cada render fuerza re-render siempre.

```ts
import { useShallow } from 'zustand/react/shallow';

const status = useRunStore((s) => s.steps[stepId]?.status); // ✅ primitivo: compara por Object.is

const { autopilot, setAutopilot } = useRunStore(
  useShallow((s) => ({ autopilot: s.autopilot, setAutopilot: s.setAutopilot })), // ✅ shallow
);

const todo = useRunStore((s) => s); // ❌ suscribe a TODO: re-render por cada delta (el heartbeat ni llega al store, §3)
```

Las derivaciones con sustancia (steps → `{nodes, edges}`) NO van en el selector: selecciona `s.steps` y deriva con la función pura `stepsToGraph` (React Compiler memoiza el cálculo; el detalle en `references/canvas.md`).

## 3. Reducer puro de eventos SSE: apply-event.ts

La transición evento→estado es una **función pura separada del hook y del store**: se testea sin DOM, sin React y sin fakes (`testing/references/frontend.md` §1: es lógica de transformación, la capa donde vive el valor). Los eventos son la **discriminated union Zod de `@ugc/core`** (decisión vinculante: eventos SSE = discriminated unions), espejo del contrato del PRD §9.0:

```ts
// packages/core/src/contracts/run-events.ts (lo posee core; aquí solo se consume)
export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), data: RunSnapshotSchema }),        // {run, steps[]} completo
  z.object({ type: z.literal('step_changed'), data: StepChangedSchema }),    // {stepId, status, cost?, outputExcerpt?}
  z.object({ type: z.literal('heartbeat'), data: z.looseObject({}) }),       // cada 25 s, mantiene viva la conexión
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export const RUN_EVENT_TYPES = ['snapshot', 'step_changed', 'heartbeat'] as const;
```

```ts
// apps/web/src/stores/apply-event.ts — SIN 'use client': es TypeScript puro
import type { PipelineRun, RunEvent, StepRun } from '@ugc/core/contracts';

export interface RunEventState {
  run: PipelineRun;
  steps: Record<string, StepRun>;
}

export const indexSteps = (steps: StepRun[]): Record<string, StepRun> =>
  Object.fromEntries(steps.map((s) => [s.id, s]));

export function applyRunEvent(state: RunEventState, event: RunEvent): Partial<RunEventState> {
  switch (event.type) {
    case 'snapshot':
      // SUSTITUYE, no mergea (contrato §9.0): el snapshot ES el estado completo.
      // Steps superseded por invalidación desaparecen; los nuevos aparecen. Mergear
      // dejaría steps fantasma tras una reconexión — exactamente lo que testea
      // testing/references/frontend.md §4 ("sin steps fantasma").
      return { run: event.data.run, steps: indexSteps(event.data.steps) };

    case 'step_changed': {
      const prev = state.steps[event.data.stepId];
      // Delta de un step desconocido (p. ej. fila nueva por invalidación): no inventes
      // un StepRun parcial — ignora y confía en el siguiente snapshot del servidor.
      if (!prev) return {};
      return {
        steps: {
          ...state.steps, // inmutable: solo cambia la referencia del step tocado
          [event.data.stepId]: {
            ...prev,
            status: event.data.status,
            costActual: event.data.cost ?? prev.costActual,
            outputExcerpt: event.data.outputExcerpt ?? prev.outputExcerpt,
          },
        },
      };
    }

    case 'heartbeat':
      return {}; // no toca estado: ningún selector re-renderiza
  }
}
```

Reglas: el mapeo delta→campos de `StepRun` es **explícito** (nada de `{...prev, ...delta}`: si el contrato cambia, que lo detecte el compilador, no producción); un `step_changed` jamás toca otro step ni el `run`; el reducer devuelve `Partial` para que `set` de Zustand haga el merge de primer nivel.

## 4. use-event-source.ts: el cliente SSE transversal

Hook propio en `apps/web/src/hooks/` (~100 líneas), **sin librería npm**: el contrato de reconexión de §9.0 (query param `lastEventId`, backoff, visibility) es nuestro, y ninguna librería lo implementa como lo necesitamos. Es transversal: no sabe nada de runs.

Comportamientos que DEBE tener (el porqué de cada uno):

1. **Estados `'connecting' | 'open' | 'reconnecting' | 'closed'`** — la UI pinta el estado de conexión (badge `role="status"`) y decide fallbacks (PRD §8: revalidación cada 5 s si el SSE no levanta).
2. **`EventSource` reconecta solo** cuando el error es transitorio (`readyState === CONNECTING`) y reenvía `Last-Event-ID` como header él mismo: no le estorbes, solo marca `'reconnecting'`.
3. **Al RECREAR la conexión manualmente** (error fatal `readyState === CLOSED`, o vuelta de background) pasa `?lastEventId=` como **query param**: `EventSource` no admite headers custom, y el endpoint del servidor acepta ambas vías (skill backend, `references/api.md`).
4. **Backoff exponencial con jitter, cap ~30 s** — sin jitter, todas las pestañas martillean el servidor a la vez tras un reinicio.
5. **Pausa en `visibilitychange` oculto, reconexión al volver** — una pestaña de fondo no necesita el stream y cada conexión SSE abierta es un handler vivo en el servidor. Al volver, el servidor re-snapshotea y §3 sustituye: no se pierde nada.
6. **Cleanup estricto** (`es.close()` + `clearTimeout` en el return del effect) — sin él, cada navegación deja un stream zombi consumiendo conexión.
7. **`useEffectEvent` (React 19.2)** para `onEvent`: el effect depende solo de `[url, enabled]`, así un callback inline en el consumidor no re-suscribe la conexión en cada render.

```ts
// apps/web/src/hooks/use-event-source.ts (esqueleto)
'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';

export type EventSourceStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

interface UseEventSourceOptions {
  events: readonly string[]; // eventos SSE con nombre ("event: snapshot") — llegan por addEventListener, no por onmessage
  onEvent: (type: string, ev: MessageEvent<string>) => void;
  enabled?: boolean;         // false → cerrado (p. ej. run en estado terminal)
}

const MAX_BACKOFF_MS = 30_000;

export function useEventSource(url: string, { events, onEvent, enabled = true }: UseEventSourceOptions) {
  const [status, setStatus] = useState<EventSourceStatus>(enabled ? 'connecting' : 'closed');
  // lastEventId expuesto se actualiza SOLO en transiciones de conexión: actualizarlo por
  // evento sería un re-render por delta/heartbeat sin valor de UI. El tracking fino es un ref.
  const [lastEventId, setLastEventId] = useState('');
  const lastEventIdRef = useRef('');

  const fireEvent = useEffectEvent(onEvent); // siempre ve el onEvent actual sin re-suscribir

  useEffect(() => {
    if (!enabled) {
      setStatus('closed');
      return;
    }
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      const id = lastEventIdRef.current;
      es = new EventSource(id ? `${url}${url.includes('?') ? '&' : '?'}lastEventId=${encodeURIComponent(id)}` : url);

      es.onopen = () => { attempt = 0; setStatus('open'); setLastEventId(lastEventIdRef.current); };

      for (const type of events) {
        es.addEventListener(type, (ev) => {
          const msg = ev as MessageEvent<string>;
          if (msg.lastEventId) lastEventIdRef.current = msg.lastEventId; // id: monotónico (§9.0)
          fireEvent(type, msg);
        });
      }

      es.onerror = () => {
        if (disposed) return;
        if (es!.readyState === EventSource.CONNECTING) { setStatus('reconnecting'); return; } // el navegador ya reintenta
        es!.close(); // CLOSED: reintento manual con backoff + jitter
        setStatus('reconnecting');
        setLastEventId(lastEventIdRef.current);
        const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        es?.close();
        if (retryTimer) clearTimeout(retryTimer);
        setStatus('closed');
      } else {
        attempt = 0;
        setStatus('connecting');
        connect(); // con ?lastEventId= → el servidor re-snapshotea al reconectar
      }
    };

    setStatus('connecting');
    connect();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [url, enabled]);

  return { status, lastEventId };
}
```

Los timers del backoff se testean con `vi.useFakeTimers()` avanzando el reloj dentro de `act` — jamás sleeps reales (`testing/references/frontend.md` §4 y §7.3).

## 5. use-run-events.ts: componer SSE + store

El hook de dominio que une las piezas: `useEventSource` recibe los eventos crudos, aquí se **validan con `RunEventSchema` (Zod) y se despachan al store**. Es la ÚNICA puerta de entrada del estado del run: ningún componente escucha SSE por su cuenta.

```ts
// apps/web/src/hooks/use-run-events.ts
'use client';

import { RUN_EVENT_TYPES, RunEventSchema, isTerminalRunStatus } from '@ugc/core/contracts';
import { useRunStore } from '@/stores/run-store';
import { useEventSource } from './use-event-source';

export function useRunEvents(runId: string) {
  const applySnapshot = useRunStore((s) => s.applySnapshot);
  const applyStepChanged = useRunStore((s) => s.applyStepChanged);
  const steps = useRunStore((s) => s.steps);
  const runStatus = useRunStore((s) => s.run.status);

  const { status, lastEventId } = useEventSource(`/api/runs/${runId}/events`, {
    events: RUN_EVENT_TYPES,
    enabled: !isTerminalRunStatus(runStatus), // un run terminal ya no emite: libera la conexión
    onEvent: (type, ev) => {
      let payload: unknown;
      try { payload = JSON.parse(ev.data); } catch { return; } // data corrupta: ignora, no rompas el stream
      const parsed = RunEventSchema.safeParse({ type, data: payload });
      if (!parsed.success) return; // evento desconocido o shape inválido → ignorar (forward-compat)
      switch (parsed.data.type) {
        case 'snapshot': applySnapshot(parsed.data.data); break;      // SUSTITUYE (§3)
        case 'step_changed': applyStepChanged(parsed.data.data); break;
        case 'heartbeat': break; // solo mantiene viva la conexión; no toca el store
      }
    },
  });

  return { status, lastEventId, steps };
}
```

- Se monta **una vez** en el client shell de `/runs/[id]` (dentro del `RunStoreProvider`); el resto de componentes lee del store con selectores, no de este hook.
- **Tras una reconexión el servidor manda re-snapshot y `applySnapshot` sustituye el estado.** Este es el contrato exacto que `testing/references/frontend.md` §4 testea con `FakeEventSource` (snapshot puebla → delta toca solo su step → re-snapshot sin steps fantasma): esos tests son la especificación ejecutable de este hook — escríbelos con él. En `renderHook`, el `wrapper` es el `RunStoreProvider` con un snapshot inicial de las factories (`makeRun`/`makeStep` de `@ugc/test-utils`).
- Devuelve `steps` además de `status` para que el shell (que alimenta el canvas) y los tests tengan superficie observable; no lo uses como atajo en componentes profundos — ahí, `useRunStore(selector)`.

## 6. Otros stores

El patrón factory + provider de §2 se repite **solo** cuando hay estado compartido real entre componentes hermanos que no cuelga del servidor — p. ej. la selección múltiple de la galería si la comparten grid, toolbar de acciones bulk y diálogo de confirmación. Reglas:

- **Un `useState` local NO se promociona a store por costumbre.** Un diálogo abierto, un hover, un filtro de una sola vista: `useState`/`useReducer` en el componente. Store solo cuando el lifting a props cruza ≥2 niveles hacia ≥2 consumidores.
- **Estado de formularios jamás en Zustand**: react-hook-form es su dueño (`references/forms.md`).
- **Datos de servidor jamás copiados a un store "para cachearlos"**: eso es reinventar TanStack Query mal — las listas se re-piden por RSC/fetch (§1).
- Mismo esqueleto siempre (factory `createXStore` + `XStoreProvider` + `useXStore` en `stores/x-store.ts`): un solo patrón por problema, como manda el principio 6 del SKILL.md.

## 7. Qué NO va aquí

- **El endpoint SSE del servidor** (ReadableStream, LISTEN/NOTIFY, heartbeat `SSE_HEARTBEAT_MS`, soporte de `Last-Event-ID`/`?lastEventId=`, Caddy `flush_interval -1`) → skill **backend**, `references/api.md`.
- **El canvas** (stepsToGraph, nodos custom, layout dagre, reglas React Flow) → `references/canvas.md`; aquí solo se define de dónde lee (`useRunStore`).
- **Consumo de la API REST y páginas RSC** (api-client, snapshot inicial de la página) → `references/architecture.md`.
- **Cómo testear stores, reducer y hooks SSE** (FakeEventSource, jsdom, fake timers) → `testing/references/frontend.md` §4 y §7 — fuente de verdad; este documento no define tests.
