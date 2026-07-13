// PURA: posiciona `{nodes, edges}` con dagre `rankdir:'LR'` (izq→der, PRD §8.2).
// Recibe nodos SIN posición (stepsToGraph los emite en 0,0) y devuelve los mismos
// nodos con `position` calculada. Determinista: mismo input → mismas posiciones (lo
// que testea testing/frontend.md §3a). Sin hooks, sin store, sin Date.now().
//
// En este diseño los nodos se re-derivan frescos del store en cada render
// (state-and-sse.md §5), así que `node.measured` (dimensiones reales que React Flow
// guarda en su store interno) NUNCA llega aquí: el layout usa SIEMPRE estas
// constantes de diseño, que DEBEN casar con el tamaño CSS real de los nodos o el
// layout solapa.
import { graphlib, layout as dagreLayout, type GraphLabel } from '@dagrejs/dagre';
import type { AppEdge, AppNode } from './steps-to-graph';

// El tipo instancia del grafo de dagre (graphlib.Graph). Anotar `g` con él da a
// setNode/setEdge/node/dagreLayout un receptor tipado en vez del `any` que el linter
// marca como acceso/argumento inseguro.
type DagreGraph = InstanceType<typeof graphlib.Graph>;

// T1.16: el nodo creció ~20 px de alto (el título humano del §7.2 es una línea NUEVA
// encima del estado, que baja a secundaria). La constante lo sigue: si se quedara en 104,
// dagre calcularía el ranking vertical con nodos más bajos de lo que son y los nodos
// contiguos se rozarían.
const SIZE = {
  step: { width: 224, height: 124 },
  'n7-group': { width: 224, height: 120 },
} as const;

// Devuelve una COPIA fresca del tamaño por nodo: dagre MUTA el objeto de label del
// nodo (le escribe x/y) — si todos los nodos compartieran la misma referencia de
// SIZE.step, dagre pisaría x/y en ese único objeto y todos los nodos acabarían con
// la posición del último. Copia obligatoria.
// Posición que dagre escribe en el label del nodo (centro + tamaño).
interface DagrePos {
  x: number;
  y: number;
  width: number;
  height: number;
}

function typeOf(node: AppNode): 'step' | 'n7-group' {
  return node.type === 'n7-group' ? 'n7-group' : 'step';
}

function sizeOf(node: AppNode): { width: number; height: number } {
  const s = SIZE[typeOf(node)];
  return { width: s.width, height: s.height };
}

export function layoutGraph({ nodes, edges }: { nodes: AppNode[]; edges: AppEdge[] }): {
  nodes: AppNode[];
  edges: AppEdge[];
} {
  const g: DagreGraph = new graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 44 } satisfies GraphLabel);

  // Solo el NIVEL SUPERIOR entra en dagre (dagre no entiende grafos compuestos): los
  // hijos de un grupo N7 expandido (parentId presente) se posicionan aparte, relativos
  // al padre.
  const topLevel = nodes.filter((n) => !n.parentId);
  const inGraph = new Set(topLevel.map((n) => n.id));
  for (const node of topLevel) g.setNode(node.id, sizeOf(node));
  // Solo edges cuyos DOS extremos están en el grafo dagre: cualquier otra que toque
  // un nodo no registrado rompería el layout en silencio.
  for (const edge of edges.filter((e) => inGraph.has(e.source) && inGraph.has(e.target))) {
    g.setEdge(edge.source, edge.target);
  }
  // Cast al tipo exacto del parámetro de `layout`: DagreGraph es `Graph<unknown,…>`
  // y `layout` pide `Graph<GraphLabel, NodeLabel, EdgeLabel>` (mismas labels en
  // runtime; solo difieren los parámetros de tipo). El cast es entre tipos
  // conocidos, no desde `any`.
  dagreLayout(g as Parameters<typeof dagreLayout>[0]);

  // Sub-layout determinista de los hijos N7 expandidos: apilados verticalmente
  // DENTRO del padre (posiciones relativas al grupo, contrato parentId de v12).
  const CHILD_H = 84;
  const CHILD_PAD_TOP = 36;
  const CHILD_PAD_X = 16;
  const childIndexByParent = new Map<string, number>();

  return {
    nodes: nodes.map((n) => {
      if (n.parentId) {
        const idx = childIndexByParent.get(n.parentId) ?? 0;
        childIndexByParent.set(n.parentId, idx + 1);
        return {
          ...n,
          position: { x: CHILD_PAD_X, y: CHILD_PAD_TOP + idx * CHILD_H },
        };
      }
      const pos = g.node(n.id) as DagrePos | undefined;
      if (pos === undefined) return n; // defensivo: nodo sin lugar en dagre
      const size = sizeOf(n);
      // dagre devuelve el CENTRO del nodo; React Flow interpreta position como la
      // esquina superior izquierda — sin esta resta todos aparecen desplazados.
      return { ...n, position: { x: pos.x - size.width / 2, y: pos.y - size.height / 2 } };
    }),
    edges,
  };
}
