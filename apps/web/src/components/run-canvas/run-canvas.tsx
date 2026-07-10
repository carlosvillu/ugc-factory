'use client';

// El canvas: ReactFlow + provider + wiring al store (canvas.md §5). Es un PROYECTOR
// del store Zustand del run — nunca dueño del estado. Lee `steps`/`expandedVariants`
// con `useShallow`, deriva `{nodes, edges}` con las funciones puras en cada render
// (sin memoizar — YAGNI con 6 nodos; ver la nota de deuda abajo), y las pinta.
// `nodesDraggable={false}`: las posiciones pertenecen al layout automático.
import { ReactFlow, ReactFlowProvider, Background, type NodeTypes } from '@xyflow/react';
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
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <Background />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
