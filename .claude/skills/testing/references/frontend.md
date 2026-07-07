# Testing de frontend (apps/web)

Testing de componentes y lógica de UI de `apps/web` con **Vitest (environment jsdom) + @testing-library/react + @testing-library/user-event + msw**. Esta capa cubre lógica de UI en aislamiento; el flujo humano completo en navegador real pertenece a Playwright (`apps/web/e2e/`) y al gate CUA de cada tarea.

## Índice

1. [Alcance y criterio de entrada](#1-alcance-y-criterio-de-entrada)
2. [Setup jsdom (obligatorio para React Flow)](#2-setup-jsdom-obligatorio-para-react-flow)
3. [React Flow: qué assertar en jsdom y qué no](#3-react-flow-qué-assertar-en-jsdom-y-qué-no)
4. [SSE: hook de run con EventSource fake](#4-sse-hook-de-run-con-eventsource-fake)
5. [Checkpoints: CP1, CP2, CP3](#5-checkpoints-cp1-cp2-cp3)
6. [Formularios, loading y errores (msw)](#6-formularios-loading-y-errores-msw)
7. [Reglas transversales](#7-reglas-transversales)

---

## 1. Alcance y criterio de entrada

**El criterio para escribir (o no) un unit test de UI es una sola pregunta: ¿este componente/hook tiene lógica condicional o transformación de datos?**

- **Sí → unit test aquí.** Ejemplos del proyecto: el mapeo `step_run[] → nodos/edges` del canvas, el recálculo de coste al cambiar tier en CP2, los badges extraído/inferido de CP1, el estado de reconexión del cliente SSE, la validación del formulario de intake.
- **No → NO escribas unit test.** Un componente que solo pinta props (una card de variante, una leyenda de colores, un layout) no tiene nada que pueda romperse que TypeScript no detecte ya; su renderizado real lo cubren E2E/CUA. Un test que solo verifica "renderiza sin explotar" es coste de mantenimiento sin señal. El proyecto es mono-desarrollador: cada test debe pagar su alquiler.

| Se testea en jsdom | Se testea en E2E/CUA (no aquí) |
|---|---|
| Estado/props/texto renderizado de nodos y paneles | Layout visual, posiciones dagre, colores "en vivo" |
| Interacción → valor renderizado (tier → coste) | Flujo completo URL → CP1 → CP2 → CP3 |
| Cliente SSE contra EventSource fake | SSE real atravesando Next/Caddy |
| Estados de error/loading con msw | Errores reales de red/backend |

**Server components de Next**: @testing-library/react no renderiza componentes async de servidor de forma soportada. No lo intentes. La regla es estructural: **extrae la lógica del server component a funciones puras** (en `apps/web/src/lib/` o `packages/core`) y testéalas como unit tests normales (sin jsdom); el rendering del server component lo cubre E2E. Ejemplo: la agregación "gasto del mes por proyecto" del dashboard es una función pura sobre filas de `cost_entry`, no un test de página.

Ubicación: co-locados junto al código, `src/**/*.test.ts(x)`. Corren con `pnpm test:unit` (proyecto `web:unit`, declarado en `test.projects` del `vitest.config.ts` raíz).

## 2. Setup jsdom (obligatorio para React Flow)

React Flow (`@xyflow/react`) **no renderiza en jsdom** sin tres mocks: `ResizeObserver`, `DOMMatrixReadOnly` y `matchMedia` (más dimensiones de elementos, que en jsdom son 0). Sin ellos el canvas monta vacío y los tests dan falsos negativos silenciosos. Es el patrón documentado por xyflow para tests; centralízalo en el setup del proyecto web para que ningún test lo repita:

```ts
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web:unit', // OBLIGATORIO: los scripts raíz filtran por --project '*:unit'
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/*.live.test.ts', '**/node_modules/**'],
    setupFiles: ['@ugc/test-utils/setup-env', './vitest.setup.ts'],
    unstubGlobals: true, // limpia vi.stubGlobal (EventSource fake, etc.) entre tests
  },
});
```

```ts
// apps/web/vitest.setup.ts
import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// React Flow lee el zoom del transform CSS vía DOMMatrixReadOnly
class DOMMatrixReadOnlyMock {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale ? Number(scale) : 1;
  }
}
globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }),
});

// jsdom devuelve 0 en offsetWidth/Height: React Flow necesita un viewport medible
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { get: () => 1280 },
  offsetHeight: { get: () => 720 },
});
(SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
```

## 3. React Flow: qué assertar en jsdom y qué no

El canvas de `/runs/[id]` es una vista 1:1 de `step_run` (PRD §7). Divide el testing en dos piezas de coste muy distinto:

**(a) La transformación pura — donde vive casi todo el valor.** La derivación `steps → {nodes, edges}` (agrupación del sub-DAG N7, estado→color/badge, coste estimado vs real, extracto del output) es una función pura. Testéala directamente, sin renderizar nada: es rápido, no necesita mocks y sobrevive a cualquier rediseño visual.

```ts
// apps/web/src/components/run-canvas/steps-to-graph.test.ts
import { expect, test } from 'vitest';
import { makeRun, makeStep } from '@ugc/test-utils';
import { stepsToGraph } from './steps-to-graph';

test('un step waiting_approval produce un nodo checkpoint con su coste', () => {
  const steps = [
    makeStep({ id: 's1', nodeKey: 'N3', status: 'waiting_approval', isCheckpoint: true, costActual: 0.09 }),
    makeStep({ id: 's2', nodeKey: 'N4', status: 'awaiting_deps', dependsOn: ['s1'] }),
  ];
  const { nodes, edges } = stepsToGraph(makeRun(), steps);

  expect(nodes.find((n) => n.id === 's1')?.data).toMatchObject({
    status: 'waiting_approval', isCheckpoint: true, costActual: 0.09,
  });
  expect(edges).toContainEqual(expect.objectContaining({ source: 's1', target: 's2' }));
});
```

**(b) Un smoke test renderizado del canvas** (uno, no uno por estado): monta el componente con los mocks de §2 y verifica que los nodos custom aparecen con su contenido. Envuelve en `ReactFlowProvider` si el componente no lo incluye.

```tsx
// apps/web/src/components/run-canvas/run-canvas.test.tsx
import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { makeRun, makeStep } from '@ugc/test-utils';
import { RunStoreProvider } from '@/stores/run-store';
import { RunCanvas } from './run-canvas';

test('pinta un nodo por step con estado y coste visibles', async () => {
  const run = makeRun();
  const steps = [makeStep({ id: 's1', nodeKey: 'N3', status: 'running', costEstimated: 0.1 })];
  // RunCanvas no recibe props: lee del store del run (skill frontend, state-and-sse.md §2);
  // el snapshot inicial entra por el provider.
  render(
    <RunStoreProvider initial={{ run, steps }}>
      <RunCanvas />
    </RunStoreProvider>,
  );

  const node = await screen.findByRole('article', { name: /N3/i }); // el nodo custom expone accessible name
  expect(within(node).getByText(/running/i)).toBeInTheDocument();
  expect(within(node).getByText('$0.10')).toBeInTheDocument();
});
```

**Qué SÍ puedes assertar en jsdom**: presencia/ausencia de nodos, su `data` renderizada (texto de estado, coste, extracto de output), número de nodos, que click en un nodo dispara el callback de abrir panel.

**Qué NO intentes assertar en jsdom** (pertenece a E2E/CUA, p. ej. la verificación de T0.11 "ver los nodos cambiar de color en vivo"): posiciones x/y tras el layout dagre/elkjs, rutas de edges, pan/zoom/fitView, drag, animación de pulso del checkpoint, solapes visuales. jsdom no hace layout: cualquier assert geométrico es ficción.

## 4. SSE: hook de run con EventSource fake

jsdom no implementa `EventSource`. Usa un fake controlable desde el test (exportado por `@ugc/test-utils`) e instálalo con `vi.stubGlobal`. El contrato a testear es el de PRD §9.0: **snapshot al conectar → deltas `step_changed` → tras reconexión llega un re-snapshot que SUSTITUYE (no mergea) el estado**. Testea ese contrato observable, no la mecánica interna de reconexión del hook.

Dos notas de armonización con la skill `frontend` (state-and-sse.md): (a) `useRunEvents` lee del store del run — los `renderHook` de abajo se montan con `wrapper: RunStoreProvider` (con un snapshot inicial de factories); se omite en los ejemplos por brevedad. (b) `FakeEventSource` declara las constantes estáticas del estándar (`static CONNECTING = 0; static OPEN = 1; static CLOSED = 2`) para que el código del hook que compara `readyState` funcione idéntico contra el fake.

```ts
// packages/test-utils/src/fake-event-source.ts (esquema)
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static last() { return this.instances.at(-1)!; }
  static reset() { this.instances = []; }

  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Set<(ev: MessageEvent) => void>>();

  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(fn);
  }
  removeEventListener(type: string, fn: (ev: MessageEvent) => void) { this.listeners.get(type)?.delete(fn); }
  close() { this.readyState = 2; }

  // ---- helpers solo-test ----
  open() { this.readyState = 1; this.onopen?.(new Event('open')); }
  emit(type: string, data: unknown, id = '') {
    const ev = new MessageEvent(type, { data: JSON.stringify(data), lastEventId: id });
    this.listeners.get(type)?.forEach((fn) => fn(ev));
  }
  fail() { this.onerror?.(new Event('error')); }
}
```

```tsx
// apps/web/src/hooks/use-run-events.test.tsx
import { renderHook, act } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { FakeEventSource, makeRun, makeStep } from '@ugc/test-utils';
import { useRunEvents } from './use-run-events';

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

const snapshot = (steps: ReturnType<typeof makeStep>[]) => ({ run: makeRun(), steps });

test('snapshot puebla el estado; un delta actualiza solo su step', () => {
  const { result } = renderHook(() => useRunEvents('run_01'));
  const es = FakeEventSource.last();

  act(() => {
    es.open();
    es.emit('snapshot', snapshot([
      makeStep({ id: 's1', nodeKey: 'N1', status: 'running' }),
      makeStep({ id: 's2', nodeKey: 'N3', status: 'awaiting_deps' }),
    ]), '1');
  });
  expect(result.current.steps.s1.status).toBe('running');

  act(() => es.emit('step_changed', { stepId: 's1', status: 'succeeded', cost: 0.02 }, '2'));
  expect(result.current.steps.s1.status).toBe('succeeded');
  expect(result.current.steps.s2.status).toBe('awaiting_deps'); // el delta no toca al resto

  const before = result.current.steps;
  act(() => es.emit('heartbeat', {}, '3'));
  expect(result.current.steps).toBe(before); // heartbeat no provoca re-render de datos
});

test('tras reconectar, el re-snapshot sustituye el estado (sin steps fantasma)', () => {
  const { result } = renderHook(() => useRunEvents('run_01'));
  const es1 = FakeEventSource.last();
  act(() => {
    es1.open();
    es1.emit('snapshot', snapshot([makeStep({ id: 's1', status: 'running' })]), '1');
    es1.fail(); // conexión caída
  });

  const es2 = FakeEventSource.last(); // el hook (o el EventSource nativo) reconecta
  act(() => {
    es2.open();
    // el servidor re-snapshotea: s1 fue superseded y ahora existe s1b
    es2.emit('snapshot', snapshot([makeStep({ id: 's1b', status: 'succeeded', supersedesId: 's1' })]), '9');
  });
  expect(result.current.steps.s1b).toBeDefined();
  expect(result.current.steps.s1).toBeUndefined(); // sustituye, no mergea
});
```

Si la reconexión de tu implementación es asíncrona (setTimeout con backoff), usa `vi.useFakeTimers()` y avanza el reloj dentro de `act`; no metas sleeps reales.

## 5. Checkpoints: CP1, CP2, CP3

Los paneles de checkpoint son los componentes con más lógica de toda la UI: son exactamente lo que esta capa existe para cubrir. Regla de oro común: **interactúa como el usuario (roles/texto + `userEvent`) y asserta el valor renderizado o el payload emitido** — nunca estado interno de React. Dale a cada fila/campo un accessible name (`aria-label` o heading): no es solo accesibilidad, es tu API de test estable.

### CP1 — Editor de brief (badges evidence/confidence)

La lógica: campos con `evidence` (cita literal de la página) muestran badge "extraído" con la cita; sin `evidence`, "inferido". Editar un campo debe emitir el brief modificado (el versionado v1→v2 lo verifica la capa de integración/E2E).

```tsx
// apps/web/src/components/checkpoints/brief-editor.test.tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { makeBrief } from '@ugc/test-utils';
import { BriefEditor } from './brief-editor';

test('badge extraído-con-cita vs inferido, y editar emite el brief nuevo', async () => {
  const user = userEvent.setup();
  const brief = makeBrief({
    benefits: [
      { text: 'Hidrata 24h', evidence: { quote: 'hidratación de 24 horas', confidence: 0.95 } },
      { text: 'Mejora el ánimo', evidence: null },
    ],
  });
  const onSave = vi.fn();
  render(<BriefEditor brief={brief} onSave={onSave} />);

  const row0 = screen.getByRole('group', { name: /hidrata 24h/i });
  expect(within(row0).getByText(/extraído/i)).toBeInTheDocument();
  expect(within(row0).getByText(/hidratación de 24 horas/i)).toBeInTheDocument(); // la cita es visible

  const row1 = screen.getByRole('group', { name: /mejora el ánimo/i });
  expect(within(row1).getByText(/inferido/i)).toBeInTheDocument();

  await user.click(within(row0).getByRole('button', { name: /editar/i }));
  const input = within(row0).getByRole('textbox');
  await user.clear(input);
  await user.type(input, 'Hidratación intensa 24h');
  await user.click(screen.getByRole('button', { name: /guardar/i }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      benefits: expect.arrayContaining([expect.objectContaining({ text: 'Hidratación intensa 24h' })]),
    }),
  );
});
```

Testea también los warnings del validador con perfil `manual` (PRD §9.2): un brief con `missing_hero_image` debe renderizar la decisión bloqueante (subir imágenes vs derivar a packshot-IA) y deshabilitar "Aprobar" hasta resolverla.

### CP2 — Matriz y recálculo de coste

La lógica crítica: cambiar el tier recalcula el coste total renderizado a partir de las `recipe`. **El valor esperado del assert se calcula A MANO desde los datos de las factories** (aquí: 12 variantes × $0,90 tier test = $10,80; × $3,40 standard = $40,80) — si el test re-implementa la fórmula del estimador, no testea nada. Los datos se construyen en memoria con las factories puras `makeX` (`seedFixtures` es de BD: async, exige `db` e inserta filas — nunca en jsdom).

```tsx
// apps/web/src/components/checkpoints/matrix-panel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { makeBrief, makePersona, makeRecipe } from '@ugc/test-utils';
import { MatrixPanel } from './matrix-panel';

test('cambiar el tier recalcula el coste total mostrado', async () => {
  const user = userEvent.setup();
  const recipes = [
    makeRecipe({ tier: 'test', usdPerVariant: 0.9 }),
    makeRecipe({ tier: 'standard', usdPerVariant: 3.4 }),
  ];
  const personas = [makePersona()];
  // matriz: 2 ángulos × 3 hooks × 1 persona × (es,en) = 12 variantes
  render(<MatrixPanel brief={makeBrief()} recipes={recipes} personas={personas} />);

  expect(screen.getByRole('status', { name: /coste estimado/i })).toHaveTextContent('$10.80');

  await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'standard');
  expect(screen.getByRole('status', { name: /coste estimado/i })).toHaveTextContent('$40.80');
});
```

Otros asserts que pagan su alquiler en CP2: quitar un hook reduce el número de variantes mostrado; el selector de personas solo lista las compatibles con el `avatar_hint` del segmento; el desglose por variante suma el total.

### CP3 — Editor de guiones (re-lint al guardar)

La lógica: editar una escena y guardar dispara el re-lint del servidor; un claim bloqueado renderiza la explicación + sugerencia y bloquea la aprobación (PRD §15.2). El linter en sí es lógica de `packages/core` con sus propios unit tests: aquí testeas la reacción de la UI a su respuesta, con msw.

```tsx
// apps/web/src/components/checkpoints/script-editor.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { makeVariant, useHttpMocks } from '@ugc/test-utils';
import { ScriptEditor } from './script-editor';

// useHttpMocks registra beforeAll/afterEach/afterAll y onUnhandledRequest: 'error' solo
useHttpMocks(
  http.post('*/api/steps/:id/edit', () =>
    HttpResponse.json(
      { code: 'guardrail_blocked', message: 'Claim médico prohibido: "cura el acné"',
        details: { suggestion: 'ayuda a mantener la piel limpia' } },
      { status: 422 },
    ),
  ),
);

test('un claim bloqueado muestra explicación + sugerencia y no aprueba', async () => {
  const user = userEvent.setup();
  render(<ScriptEditor variant={makeVariant({ status: 'scripting' })} stepId="s5" />);

  await user.type(screen.getByRole('textbox', { name: /escena 1/i }), ' cura el acné');
  await user.click(screen.getByRole('button', { name: /guardar/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/claim médico prohibido/i);
  expect(alert).toHaveTextContent(/mantener la piel limpia/i); // la sugerencia es accionable
  expect(screen.getByRole('button', { name: /aprobar/i })).toBeDisabled();
});
```

## 6. Formularios, loading y errores (msw)

Mockea HTTP con **msw en modo node** vía `useHttpMocks(...overrides)` de `@ugc/test-utils` (nunca `vi.mock` del módulo cliente: msw testea también la serialización real de la request). `useHttpMocks` registra el ciclo de vida (`beforeAll/afterEach/afterAll`) y `onUnhandledRequest: 'error'` automáticamente, para que una llamada no mockeada explote en vez de colgar el test; para un override puntual dentro de un test usa el export secundario `server` (`server.use(...)`). Una trampa de jsdom: el `fetch` global de Node exige URLs absolutas — centraliza la base en un helper (`apiUrl('/api/…')` que en test resuelve a `http://localhost:3000`) y escribe handlers con patrón `*/api/...`. Los handlers/fixtures compartidos viven en `packages/test-utils/fixtures/http/`.

Patrón para el formulario de intake (los tres estados en un solo test cada uno — feliz, loading, error):

```tsx
// apps/web/src/components/intake/intake-form.test.tsx
useHttpMocks(); // handlers por defecto; el override puntual va con server.use(...)

test('submit muestra loading y deshabilita; un 500 re-habilita con error visible', async () => {
  server.use(
    http.post('*/api/runs', async () => {
      await new Promise((r) => setTimeout(r, 50)); // ventana para assertar el loading
      return HttpResponse.json({ code: 'internal', message: 'boom' }, { status: 500 });
    }),
  );
  const user = userEvent.setup();
  render(<IntakeForm />);

  await user.type(screen.getByRole('textbox', { name: /url/i }), 'https://tienda.example/producto');
  await user.click(screen.getByRole('button', { name: /analizar/i }));

  expect(screen.getByRole('button', { name: /analizando/i })).toBeDisabled(); // loading observable

  expect(await screen.findByRole('alert')).toHaveTextContent(/error/i);
  expect(screen.getByRole('button', { name: /analizar/i })).toBeEnabled(); // recuperable, no atascado
});
```

Qué testear en cada formulario del proyecto: **intake** — conmutación URL/texto libre (el modo texto libre no exige URL), validación de URL inválida renderizada como mensaje, payload correcto del `IntakeConfig` (asserta el body en el handler msw); **settings** — que una key guardada NUNCA se re-renderiza en claro (assert negativo: `queryByText(key)` es null; la UI solo muestra un placeholder enmascarado), estados de guardado/error. Si un componente usa `useRouter`, stubbea `next/navigation` con `vi.mock` mínimo (`{ useRouter: () => ({ push: vi.fn() }) }`).

## 7. Reglas transversales

1. **Queries por rol y texto, en este orden de preferencia**: `getByRole` (con `name`) > `getByLabelText` > `getByText` > `getByTestId` (último recurso, p. ej. nodos de React Flow). Por qué: el test queda acoplado a lo que el usuario percibe, no al DOM; sobrevive a refactors de markup y detecta regresiones de accesibilidad gratis.
2. **`userEvent`, no `fireEvent`**: `userEvent` simula la secuencia real (focus, keydown, input...), que es lo que tus handlers verán en producción. `fireEvent` solo para eventos que userEvent no cubre.
3. **Asíncrono con `findBy*` / `waitFor`**, jamás sleeps. Timers propios (reconexión SSE, debounce) con `vi.useFakeTimers()`.
4. **Sin snapshot tests de componentes**: en un proyecto mono-desarrollador se convierten en `--update` reflejo y no detectan nada. Los golden files se reservan para outputs deterministas del compilador de prompts y FFmpeg (ver sus references), no para árboles JSX.
5. **Datos siempre desde las factories de `@ugc/test-utils`** (`makeBrief()`, `makeRun()`, `makeStep()`, `makeVariant()`...): construyen objetos válidos según los contratos Zod de `packages/core`, así un cambio de contrato rompe los tests en compilación, no en producción.
6. **No testees implementación**: nada de assertar `useState` interno, ni contar renders, ni espiar métodos privados. Si no puedes expresarlo como "el usuario hace X y ve Y" (o "el componente emite el payload Z"), probablemente pertenece a otra capa.
7. **Duda razonable = no lo testees aquí**: si el valor del test está en el píxel (layout, color en vivo, overlay de safe zones), es E2E/CUA; si está en la regla de negocio (estimador de coste, linter, máquina de estados), es un unit de `packages/core` o integración con Postgres real (ver db-integration.md). Esta capa cubre exactamente el pegamento: interacción → transformación → render.
