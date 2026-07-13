'use client';

// El canvas: ReactFlow + provider + wiring al store (canvas.md §5). Es un PROYECTOR
// del store Zustand del run — nunca dueño del estado. Lee `steps`/`expandedVariants`
// con `useShallow`, deriva `{nodes, edges}` con las funciones puras en cada render
// (sin memoizar — YAGNI con 6 nodos; ver la nota de deuda abajo), y las pinta.
// `nodesDraggable={false}`: las posiciones pertenecen al layout automático.
import { useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  useStore,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useShallow } from 'zustand/react/shallow';
import { useRunStore } from '@/stores/run-store';
import { StepNodeView } from './nodes/step-node';
import { N7GroupNodeView } from './nodes/n7-group-node';
import { stepsToGraph, type AppEdge, type AppNode } from './steps-to-graph';
import { layoutGraph } from './layout';

// Nivel de MÓDULO (canvas.md §2 regla 3): un objeto literal en JSX sería una
// referencia nueva por render → React Flow remonta TODOS los nodos en cada delta SSE.
const nodeTypes = { step: StepNodeView, 'n7-group': N7GroupNodeView } satisfies NodeTypes;

// Re-encuadre cuando cambia el TAMAÑO del lienzo (T1.16, deuda del verifier de T1.14).
//
// El problema real: `fitView` como PROP solo actúa en el montaje. Al abrir el editor de CP1
// el canvas se estrecha (de `flex-1` a `w-64`, ~255 px) SIN remontarse — el viewport se
// queda con el encuadre del lienzo ancho y N2/N3 se salen de la vista; sin controles de
// zoom había que panear a mano para descubrir que N2 seguía ahí.
//
// El tamaño del lienzo ya lo mide React Flow (su ResizeObserver escribe `width`/`height` en
// su store): se lee de ahí en vez de montar un segundo observer. Vive DENTRO de
// `<ReactFlow>` porque `useReactFlow`/`useStore` exigen el provider (canvas.md §2 regla 5).
//
// SIN `useNodesInitialized`: parece el guard natural ("no encuadres hasta que los nodos
// estén medidos"), y con ÉL EL FIT NO OCURRE NUNCA — comprobado en el navegador: el hook
// devuelve `false` para siempre en este canvas. Y es coherente con su diseño (§5): los nodos
// se RE-DERIVAN del store Zustand en cada render, así que los objetos que recibe React Flow
// son nuevos y sin `measured` una y otra vez; el flag de "inicializados" no llega a subir. El
// encuadre no lo necesita: las posiciones vienen del layout dagre (constantes de diseño
// casadas con el CSS, layout.ts) y `fitView` las usa tal cual — es exactamente lo que ya hace
// la prop `fitView` en el montaje, que sí funciona.
function FitOnResize() {
  const { fitView } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);

  useEffect(() => {
    if (width === 0 || height === 0) return;
    // SIN `duration`: el fit es INSTANTÁNEO. Una animación de viewport se interrumpe con el
    // siguiente delta SSE (que re-renderiza el grafo entero) y deja el encuadre a medias —
    // que era justo el síntoma a arreglar. Además respeta a quien pide menos movimiento.
    void fitView({ padding: 0.15 });
  }, [fitView, width, height]);

  return null;
}

// Los accessible name de los controles de React Flow vienen en INGLÉS por defecto
// ("Zoom In", "Fit View"…). La UI del proyecto es en español y el accessible name es lo
// que lee el usuario de lector de pantalla (y lo que consultan los tests): se localizan
// por el `ariaLabelConfig` de v12 (merge parcial sobre el default). A nivel de módulo:
// una referencia nueva por render remontaría el store de React Flow.
const ariaLabelConfig = {
  'controls.ariaLabel': 'Controles del lienzo',
  'controls.zoomIn.ariaLabel': 'Acercar',
  'controls.zoomOut.ariaLabel': 'Alejar',
  'controls.fitView.ariaLabel': 'Ajustar a la vista',
};

export function RunCanvas() {
  const { steps, expandedVariants } = useRunStore(
    useShallow((s) => ({ steps: s.steps, expandedVariants: s.expandedVariants })),
  );
  const selectStep = useRunStore((s) => s.selectStep);

  // Derivación pura en render: se recalcula en CADA render (incluido cada delta
  // SSE). No se memoiza a propósito — con 6 nodos el coste es negligible (YAGNI);
  // memoizar (o habilitar el React Compiler, que hoy NO está activo) es deuda para
  // F2+ cuando las matrices de variantes hagan crecer el grafo.
  const graph = stepsToGraph(Object.values(steps), { expandedVariants });
  const { nodes, edges } = layoutGraph(graph);

  return (
    <div className="h-full w-full" data-slot="run-canvas">
      <ReactFlowProvider>
        <ReactFlow<AppNode, AppEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => {
            // El grupo N7 no abre panel (no es un step); los steps sí.
            if (node.type === 'step') selectStep(node.id);
          }}
          fitView
          // `minZoom` por debajo del 0.5 por defecto de React Flow (T1.16). No es un
          // capricho: con el editor de CP1 abierto el lienzo baja a ~255 px y encuadrar el
          // DAG entero (3 nodos de 224 px + separaciones ≈ 830 px) exige un zoom de ~0,25.
          // Con el mínimo por defecto, `fitView` SE CLAVA en 0.5 y deja la mitad del grafo
          // fuera de la vista — el fit "funcionaba" y el usuario seguía sin ver N2. Con las
          // matrices de variantes de F2 el grafo será aún más ancho.
          minZoom={0.15}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          ariaLabelConfig={ariaLabelConfig}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          {/* Controles de zoom / fit / ajustar (T1.16): sin ellos, un lienzo estrecho
              (CP1 abierto) obligaba a panear a ciegas. `showInteractive={false}`: el
              toggle de "bloquear interacción" no aplica — los nodos NO son arrastrables
              (el layout es automático), así que sería un botón que no hace nada.
              Se estilan con los tokens del DS en globals.css (`.react-flow__controls`). */}
          <Controls showInteractive={false} />
          <FitOnResize />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
