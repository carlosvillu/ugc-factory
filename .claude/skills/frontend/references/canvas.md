# El canvas del pipeline (`/runs/[id]`) — React Flow v12

Cómo se construye el grafo de ejecución con **@xyflow/react v12**. El usuario descartó instalar la skill externa de React Flow: **este documento es la fuente de las reglas**. Si dudas de una API de v12, verifica en <https://reactflow.dev/llms.txt> o Context7 (`.mcp.json`) ANTES de escribirla — React Flow cambió APIs importantes entre v11 y v12 y los ejemplos antiguos de internet mienten.

## Índice

1. [Contexto: qué es el canvas](#1-contexto-qué-es-el-canvas)
2. [Reglas React Flow v12 (no negociables)](#2-reglas-react-flow-v12-no-negociables)
3. [Estructura del dominio `components/run-canvas/`](#3-estructura-del-dominio-componentsrun-canvas)
4. [Nodos custom: accesibles y testeables](#4-nodos-custom-accesibles-y-testeables)
5. [Integración con el store del run](#5-integración-con-el-store-del-run)
6. [Layout automático](#6-layout-automático)
7. [Qué se testea dónde](#7-qué-se-testea-dónde)
8. [Qué NO va aquí](#8-qué-no-va-aquí)

---

## 1. Contexto: qué es el canvas

El canvas de `/runs/[id]` es una **vista 1:1 de las filas `step_run`** del run (PRD §7, §8.2): un nodo por step (`N0…N11`), edges derivadas de `depends_on`, estado en vivo vía SSE. No es un editor de grafos — el usuario no crea ni conecta nodos; observa, aprueba y recupera.

Requisitos que fija el PRD §8.2 y que este documento materializa:

- **Un nodo por `step_run` vigente**; los sub-DAGs de N7 (`N7a–N7e`, uno por variante) se agrupan en un **nodo compuesto por variante, expandible**. Los steps `superseded` NO se pintan como nodos: el linaje (`supersedes_id`) se consulta en el panel lateral — pintar el histórico convertiría el grafo en una maraña ilegible.
- **Cada nodo muestra**: `node_key`, estado (color + icono), duración, coste estimado/real y un extracto del output (N3: producto + nº de ángulos; N7c: thumbnail; N8: preview del master).
- **Click en nodo → panel lateral** con el artefacto completo (brief CP1, matriz CP2, guion CP3, player CP4, `resolvedPrompt` de N6, logs/errores). El panel compone los editores de `components/checkpoints/` — sus formularios los gobierna `forms.md`.
- **Checkpoints**: un nodo en `waiting_approval` **pulsa visualmente**; las acciones (aprobar/editar/rechazar) viven en el panel.
- **Acciones de recuperación y autopilot** (§8.2): retry de un step fallido, skip, cancelar lote, toggle autopilot de cabecera y candado "parar siempre aquí" por nodo — todas viven en el panel/cabecera y son fetch vía api-client (`POST /api/steps/:id/retry|skip`, `POST /api/runs/:id/cancel`, `PATCH /api/steps/:id/checkpoint-config`), mismo patrón que approve (§5): NUNCA mutan el store; el estado nuevo llega por SSE.
- **Tiempo real**: los nodos cambian de estado sin refrescar (SSE → store → canvas, §5).

## 2. Reglas React Flow v12 (no negociables)

Cada regla existe porque su violación produce un bug concreto, casi siempre silencioso:

1. **Paquete `@xyflow/react`, export nombrado `ReactFlow`**: `import { ReactFlow, ReactFlowProvider, Background } from '@xyflow/react'`. El paquete `reactflow` (v11, default export) está muerto para nosotros; mezclarlos rompe tipos y estilos.
2. **Importa `'@xyflow/react/dist/style.css'`** en `run-canvas.tsx`. Sin él, el canvas "funciona" pero los nodos se apilan sin estilo y las edges no se ven — un canvas roto **sin ningún error en consola**, el falso negativo clásico.
3. **`nodeTypes`/`edgeTypes` a nivel de módulo, JAMÁS inline en el render.** Un objeto literal en JSX es una referencia nueva por render → React Flow desmonta y remonta TODOS los nodos en cada render (pierdes estado interno, warning en consola y el rendimiento se hunde con cada delta SSE).
4. **Componentes de nodo envueltos en `memo`.** Es la **excepción legítima** al "sin memo preventivo" del React Compiler que fija el SKILL.md: React Flow re-renderiza su lista interna de nodos en cada pan/zoom/cambio de viewport, y el patrón documentado por xyflow es memoizar el componente. No extiendas la excepción a nada fuera de `nodes/`.
5. **`useReactFlow` solo bajo `ReactFlowProvider`.** Fuera del provider lanza un error de store zustand ausente en runtime. Si el canvas necesita `fitView()` imperativo (p. ej. tras expandir N7), envuelve en `<ReactFlowProvider>` en el mismo client component.
6. **`node.measured.width/height` es donde v12 guarda las dimensiones reales** (`width`/`height` son otra cosa: dimensiones explícitas que la doc dice no setear a mano). Ojo: `measured` vive en las instancias del store interno de React Flow — en NUESTRO diseño (§5: los nodos se re-derivan del store Zustand en cada render) nunca llega al layout, que usa constantes de diseño casadas con el CSS (§6). La regla importa si algún día lees nodos vía `useReactFlow().getNodes()`.
7. **Tipado estricto**: `type AppNode = StepNode | N7GroupNode` (unión de `Node<Data, 'tipo'>`), componente `<ReactFlow<AppNode, AppEdge> …>`, nodos con `NodeProps<StepNode>`. Así los callbacks (`onNodeClick`…) reciben el tipo narrowed y un cambio en `StepNodeData` rompe la compilación — la señal deseada del principio 7 del SKILL.md.
8. **Handle IDs constantes y consistentes** (`'in'`/`'out'`): una edge cuyo `sourceHandle`/`targetHandle` no casa con ningún `<Handle id>` del nodo simplemente no se pinta (warning fácil de ignorar). Y sin `<Handle>` en el nodo custom las edges no tienen ancla. IDs como constantes exportadas, nunca strings repetidos.
9. **Montaje client-only**: `run-canvas.tsx` lleva `'use client'` y la página `/runs/[id]` (server component) solo compone. **Prohibido `dynamic(…, { ssr: false })` dentro de un RSC** — Next 16 lo rechaza; la frontera client se pone con el wrapper, no con dynamic.
10. **`nodrag` en todo control interactivo dentro de un nodo** (botones, inputs): React Flow captura el mousedown para el drag y se come el click. La clase `nodrag` es el mecanismo oficial.

## 3. Estructura del dominio `components/run-canvas/`

```
apps/web/src/components/run-canvas/
├─ run-canvas.tsx        # 'use client' — ReactFlow + provider + wiring al store
├─ steps-to-graph.ts     # PURA: StepRun[] → {nodes, edges}. LA pieza con tests
├─ layout.ts             # PURA: dagre LR sobre {nodes, edges} → nodes con position
├─ step-panel.tsx        # panel lateral (compone editores de components/checkpoints/)
└─ nodes/
   ├─ step-node.tsx      # nodo estándar (N0–N11 hoja)
   └─ n7-group-node.tsx  # nodo compuesto N7 por variante, expandible
```

La separación es deliberada: **toda la inteligencia vive en las dos funciones puras** (`steps-to-graph.ts`, `layout.ts`) y los componentes solo pintan. Es lo que permite testear el 90% del canvas sin renderizar nada (testing/frontend.md §3a) y sobrevivir a rediseños.

### `steps-to-graph.ts` — tipos y firma

```ts
// apps/web/src/components/run-canvas/steps-to-graph.ts
import type { Edge, Node } from '@xyflow/react';
import type { PipelineRun, StepRun, StepStatus } from '@ugc/core';

export interface StepNodeData extends Record<string, unknown> {
  nodeKey: string;               // 'N3', 'N7c'…
  label: string;
  status: StepStatus;            // enum de PRD §7.1
  isCheckpoint: boolean;
  costEstimated: number | null;
  costActual: number | null;
  durationMs: number | null;
  outputExcerpt: string | null;  // N3: producto + nº ángulos; N7c: url del thumbnail…
}

export interface N7GroupData extends Record<string, unknown> {
  variantId: string;
  label: string;                 // 'N7 · glow-serum-hook02'
  status: StepStatus;            // agregado de los hijos N7a–N7e (peor estado gana)
  expanded: boolean;
}

export type StepNode = Node<StepNodeData, 'step'>;
export type N7GroupNode = Node<N7GroupData, 'n7-group'>;
export type AppNode = StepNode | N7GroupNode;
export type AppEdge = Edge;

export function stepsToGraph(
  run: PipelineRun,
  steps: StepRun[],
  // Opcional con default "todo colapsado": el unit test canónico de testing/frontend.md §3a
  // la invoca con dos argumentos y debe seguir compilando tal cual.
  opts: { expandedVariants: ReadonlySet<string> } = { expandedVariants: new Set() },
): { nodes: AppNode[]; edges: AppEdge[] } {
  // 1. Descarta steps 'superseded' (el linaje va al panel, no al grafo).
  // 2. Agrupa N7a–N7e por variant_id en un N7GroupNode; si la variante está en
  //    expandedVariants, emite además los hijos con parentId = id del grupo y
  //    extent: 'parent' (contrato de subflows de v12).
  // 3. Edges desde depends_on: una por par (dep → step), id `${dep}->${step.id}`;
  //    si un extremo es hijo de un grupo colapsado, la edge se remapea al grupo
  //    (con dedupe: N variantes no significan N edges paralelas idénticas).
  // 4. position: { x: 0, y: 0 } en todos — las posiciones las pone layout.ts.
  // PURA: sin hooks, sin store, sin Date.now(), sin acceso a red.
}
```

Los nodos salen **sin posiciones** (`0,0`): posicionar es responsabilidad exclusiva de `layout.ts`. Mezclar derivación y layout haría ambas cosas intesteable la una sin la otra.

## 4. Nodos custom: accesibles y testeables

El accessible name del nodo **es la API de test** (principio 4 del SKILL.md): testing/frontend.md consulta con `getByRole('article', { name: /N3/i })`. Un nodo sin rol/label es un nodo que no se puede testear.

```tsx
// apps/web/src/components/run-canvas/nodes/step-node.tsx
'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { StepNode } from '../steps-to-graph';

export const HANDLE_IN = 'in';
export const HANDLE_OUT = 'out';

// memo: excepción documentada de React Flow (regla 4 de §2). No la copies fuera de nodes/.
export const StepNodeView = memo(function StepNodeView({ data, selected }: NodeProps<StepNode>) {
  return (
    <article
      role="article" // explícito: es la query de los tests, no dependas del rol implícito
      aria-label={`${data.nodeKey} ${data.label}`}
      data-status={data.status}
      data-slot="step-node"
      className={cn(
        'w-56 rounded-lg border bg-card text-card-foreground shadow-sm',
        'data-[status=running]:border-status-running',
        'data-[status=failed]:border-status-failed',
        'data-[status=waiting_approval]:animate-checkpoint-pulse',
        selected && 'ring-2 ring-ring',
      )}
    >
      <Handle type="target" position={Position.Left} id={HANDLE_IN} />
      <header className="flex items-center justify-between px-3 pt-2">
        <span className="font-medium">{data.nodeKey}</span>
        <StatusBadge status={data.status} />
      </header>
      {data.outputExcerpt ? (
        <p className="truncate px-3 text-sm text-muted-foreground">{data.outputExcerpt}</p>
      ) : null}
      <footer className="px-3 pb-2 text-xs text-muted-foreground">
        <CostLine estimated={data.costEstimated} actual={data.costActual} />
      </footer>
      <Handle type="source" position={Position.Right} id={HANDLE_OUT} />
    </article>
  );
});
```

Reglas del nodo:

- **`role="article"` + `aria-label` con el `nodeKey`** siempre — es el contrato con los tests de jsdom y con el lector de pantalla a la vez.
- **El estado se expresa como `data-status` + clases de tokens semánticos** (`--status-running`, `--status-failed`, `--status-waiting-approval`… definidos en `design-system.md`). **Prohibido cualquier color hardcodeado** (`border-amber-500`) — si falta un color de estado, se añade el token al DS primero.
- El pulso del checkpoint es una animación de token (`animate-checkpoint-pulse`) disparada por `data-status=waiting_approval`, no un estado React: el dato manda, el CSS reacciona. Respeta `prefers-reduced-motion` en la definición de la animación.
- `n7-group-node.tsx` sigue el mismo patrón con un botón expandir/colapsar (`aria-expanded`, `aria-label="Expandir N7 de <variante>"`, clase `nodrag`) que despacha la acción del store (§5).

## 5. Integración con el store del run

El canvas es un **proyector del store Zustand del run** (contrato completo en `state-and-sse.md`): nunca es dueño del estado.

```tsx
// apps/web/src/components/run-canvas/run-canvas.tsx
'use client';

import { ReactFlow, ReactFlowProvider, Background, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useShallow } from 'zustand/react/shallow';
import { useRunStore } from '@/stores/run-store';
import { StepNodeView } from './nodes/step-node';
import { N7GroupNodeView } from './nodes/n7-group-node';
import { stepsToGraph, type AppNode, type AppEdge } from './steps-to-graph';
import { layoutGraph } from './layout';

// Nivel de módulo — regla 3 de §2.
const nodeTypes = { step: StepNodeView, 'n7-group': N7GroupNodeView } satisfies NodeTypes;

export function RunCanvas() {
  const { run, steps, expandedVariants } = useRunStore(
    useShallow((s) => ({ run: s.run, steps: s.steps, expandedVariants: s.expandedVariants })),
  );
  const selectStep = useRunStore((s) => s.selectStep);

  // Derivación pura en render; el React Compiler memoiza — no añadas useMemo.
  const graph = stepsToGraph(run, Object.values(steps), { expandedVariants });
  const { nodes, edges } = layoutGraph(graph);

  return (
    <ReactFlowProvider>
      <ReactFlow<AppNode, AppEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => selectStep(node.id)}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
```

Reglas de flujo de datos (violarlas crea el bug de "dos verdades"):

- **El canvas lee `nodes`/`edges` derivados del store con `useShallow`** — nunca `useNodesState`/`onNodesChange`: esos hooks harían a React Flow copropietario del estado, y el dueño único es el store alimentado por SSE.
- **Seleccionar un nodo es una acción del store** (`selectStep`), porque el panel lateral (y potencialmente la URL) leen la selección — no un `useState` local del canvas.
- **Los botones de checkpoint del panel disparan `fetch` a la API** (`POST /api/steps/:id/approve|edit|reject` vía `api-client`) **y no tocan el store**: el estado nuevo llega por SSE (delta `step_changed` o re-snapshot) y el canvas se repinta solo. El canvas **JAMÁS muta estado local del run** — ni optimistic updates: con invalidación de sub-grafo (PRD §7.3), adivinar el estado resultante en cliente es reimplementar el orquestador mal.
- `nodesDraggable={false}`: las posiciones pertenecen al layout automático; permitir drag crearía posiciones fantasma que el siguiente re-layout pisaría.

## 6. Layout automático

`layout.ts` es una **función pura** que recibe `{nodes, edges}` y devuelve los mismos nodos con `position` calculada por **dagre con `rankdir: 'LR'`** (izquierda→derecha, PRD §8.2).

```ts
// apps/web/src/components/run-canvas/layout.ts
import dagre from '@dagrejs/dagre';
import type { AppEdge, AppNode } from './steps-to-graph';

// En este diseño los nodos se re-derivan frescos del store en cada render (§5), así que
// node.measured (que vive en las instancias del store interno de React Flow) NUNCA llega
// aquí: el layout se calcula SIEMPRE con estas constantes de diseño. Por eso DEBEN casar
// con el tamaño CSS real de los nodos (w-56 etc.) o el layout solapa. Si un nodo pasa a
// tener altura variable, la solución es leer dimensiones vía useReactFlow().getNodes()
// (decisión explícita, no un `?? fallback` que aparenta usar measured sin usarlo jamás).
const SIZE = { step: { width: 224, height: 96 }, 'n7-group': { width: 288, height: 128 } };

export function layoutGraph({ nodes, edges }: { nodes: AppNode[]; edges: AppEdge[] }) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 40 });

  const topLevel = nodes.filter((n) => !n.parentId);
  const inGraph = new Set(topLevel.map((n) => n.id));
  for (const node of topLevel) g.setNode(node.id, SIZE[node.type ?? 'step']);
  // Solo edges cuyos DOS extremos están en el grafo dagre: las edges de hijos de un grupo
  // expandido (parentId presente) ya llegan remapeadas al grupo desde stepsToGraph; cualquier
  // otra que toque un nodo no registrado rompería el layout en silencio.
  for (const edge of edges.filter((e) => inGraph.has(e.source) && inGraph.has(e.target))) {
    g.setEdge(edge.source, edge.target);
  }
  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      if (n.parentId) return n; // hijos: sub-layout propio relativo al padre (ver prescripciones)
      const pos = g.node(n.id);
      const size = SIZE[n.type ?? 'step'];
      // dagre devuelve el CENTRO del nodo; React Flow interpreta position como esquina
      // superior izquierda — sin esta resta, todos los nodos aparecen desplazados.
      return { ...n, position: { x: pos.x - size.width / 2, y: pos.y - size.height / 2 } };
    }),
    edges,
  };
}
```

Prescripciones:

- **Dagre solo posiciona el nivel superior** (no entiende grafos compuestos): los hijos `N7a–N7e` de un grupo expandido se posicionan con un sub-layout determinista propio, **relativo al padre** (contrato `parentId` de v12: la `position` del hijo es relativa al grupo). Si el sub-DAG creciera en complejidad, la alternativa es elkjs (soporta jerarquía nativa) — decisión explícita, no deriva silenciosa.
- **Cuándo se re-layouta**: cuando cambia la FORMA del grafo — nuevo snapshot SSE (steps invalidados/creados por `supersedes_id`) o expandir/colapsar un N7. Un delta que solo cambia `status`/`cost` no altera la forma: mismos ids y edges → dagre produce las mismas posiciones y nada salta. Como `layoutGraph` es pura y corre en render, esto sale gratis; si el profiling algún día dice lo contrario, se optimiza entonces (no antes).
- **`fitView` como prop** para el encuadre inicial. Tras expandir un N7, un `fitView({ nodes: hijosDelGrupo })` imperativo vía `useReactFlow` es aceptable — y es exactamente el caso que exige `ReactFlowProvider` (regla 5 de §2).

## 7. Qué se testea dónde

La skill `testing` es la fuente de verdad; este mapa solo rutea. Léelo junto a `testing/references/frontend.md` §2–3 (setup jsdom con los mocks de ResizeObserver/DOMMatrix — obligatorio — y el reparto jsdom vs E2E).

| Pieza | Capa | Reference de testing |
|---|---|---|
| `stepsToGraph` (agrupación N7, filtrado superseded, edges, remapeo colapsado) | Unit puro, sin render | frontend.md §3a |
| `layoutGraph` (determinismo: mismo input → mismas posiciones; fallbacks) | Unit puro, sin render | frontend.md §3a |
| Data renderizada del nodo (estado, coste, extracto), click → `selectStep` | jsdom, UN smoke test | frontend.md §3b |
| Posiciones dagre "en pantalla", colores en vivo, pulso, pan/zoom/fitView | E2E/CUA (jsdom no hace layout: todo assert geométrico ahí es ficción) | e2e.md + cua.md |
| Nodos cambiando de estado en vivo por SSE (verificación T0.11) | E2E + gate CUA | e2e.md + cua.md |

## 8. Qué NO va aquí

- **El contrato SSE, el hook `useEventSource`/`use-run-events` y el reducer evento→estado** → `state-and-sse.md`. Aquí solo importa que el canvas lee el resultado del store.
- **Los editores de checkpoint** (brief CP1, matriz CP2, guion CP3) que el panel lateral compone → `forms.md`.
- **Los tokens `--status-*`, la animación de pulso y cualquier decisión visual** → `design-system.md` (y Claude Design como fuente de verdad).
- **El endpoint SSE del servidor y las rutas approve/edit/reject** → skill `backend` (`references/api.md`).
- **Cómo escribir los tests** (setup jsdom, factories, qué assertar) → `testing/references/frontend.md`. Este documento solo dice qué pieza pertenece a qué capa.
