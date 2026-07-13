// EL «COSTE REAL» DE LA CABECERA DEL RUN — regresión permanente de un BUG DE DINERO (T1.17).
//
// La cabecera calculaba su KPI «Coste real» sumando los steps del SSE:
//
//     stepList.reduce((acc, s) => acc + (s.costActual ?? 0), 0)
//
// y `costActual` es `step_run.cost_actual`, una columna que **se queda NULL cuando un step
// FALLA**: `rollupStepCost` (T1.10b) solo la recomputa al cerrar BIEN un step. Un step que muere
// HABIENDO GASTADO no la escribe jamás. Consecuencia observada en la BD real del usuario: los dos
// runs que murieron en N3 gastaron 16 y 13 céntimos de Sonnet, y al abrir su canvas la cabecera
// decía **«Coste real: $0.00»**. Dinero real, invisible, justo en los runs que más interesa
// auditar.
//
// El fix: el total lo computa el SERVIDOR desde el LEDGER (`cost_entry`) y viaja en el objeto run
// (`costActualCents`, `GET /api/runs/:id`) — la MISMA función que alimenta el listado `/runs`.
//
// Estos tests reproducen el escenario EXACTO del bug (step `failed` con `cost_actual` NULL + un
// cargo real en el ledger) y exigen ver el dinero. CONTROL NEGATIVO comprobado al escribirlos:
// devolviendo la línea al `reduce` sobre los steps, el primer test se pone ROJO ($0.00 ≠ $0.13).
import { render, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test } from 'vitest';
import type { StepSnapshot } from '@ugc/core/orchestrator';
import type { RunResponse } from '@/lib/api-client';
import { RunStoreProvider } from '@/stores/run-store';
import { RunHeader } from './run-shell';

function makeRun(overrides: Partial<RunResponse> = {}): RunResponse {
  return {
    id: 'run_01',
    projectId: 'proj_01',
    kind: 'full',
    autopilot: false,
    status: 'pending', // como en la BD real: el agregado NO lo mantiene nadie (deuda de T0.8)
    startedAt: null,
    finishedAt: null,
    totalCostEstimated: null,
    totalCostActual: null, // la OTRA columna muerta: NULL siempre
    costActualCents: 0,
    ...overrides,
  };
}

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

/**
 * Renderiza la cabecera y devuelve un lector de KPIs ACOTADO a ESE render (`within(container)`,
 * no el `screen` global): esta suite monta varias cabeceras y una consulta global encontraría
 * «Coste real» en todas.
 */
function renderHeader(run: RunResponse, steps: StepSnapshot[]) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <RunStoreProvider initial={{ run, steps }}>{children}</RunStoreProvider>;
  }
  const { container } = render(<RunHeader runId={run.id} />, { wrapper: Wrapper });

  /** El texto de la tarjeta del KPI cuyo label es `label` (label + valor van en la misma). */
  return function kpi(label: string): string {
    const node = within(container).getByText(label).closest('div')?.parentElement;
    return node?.textContent ?? '';
  };
}

describe('RunHeader · «Coste real» (T1.17 — bug de dinero)', () => {
  test('un run MUERTO enseña el dinero que gastó, no $0.00', () => {
    // El escenario REAL: N1/N2 cerraron bien (0 céntimos), N3 FALLÓ con `cost_actual` NULL…
    // habiendo gastado 13 céntimos, que solo constan en el LEDGER. El servidor los agrega y los
    // manda en `costActualCents`.
    const kpi = renderHeader(makeRun({ status: 'pending', costActualCents: 13 }), [
      snap({ id: 's1', nodeKey: 'N1', status: 'succeeded', costActual: 0 }),
      snap({ id: 's2', nodeKey: 'N2', status: 'succeeded', costActual: 0 }),
      // ← LA FILA DEL BUG: falló, gastó, y su columna de coste es NULL.
      snap({ id: 's3', nodeKey: 'N3', status: 'failed', costActual: null }),
    ]);

    // Sumar los steps daría $0.00 (0 + 0 + null→0). Tiene que decir $0.13.
    expect(kpi('Coste real')).toContain('$0.13');
    expect(kpi('Coste real')).not.toContain('$0.00');
  });

  test('un run COMPLETADO también sale del ledger (y coincide con el listado)', () => {
    const kpi = renderHeader(makeRun({ costActualCents: 18 }), [
      snap({ id: 's1', nodeKey: 'N1', status: 'succeeded', costActual: 0 }),
      snap({ id: 's2', nodeKey: 'N3', status: 'succeeded', costActual: 18 }),
    ]);
    expect(kpi('Coste real')).toContain('$0.18');
  });

  test('un run que no ha gastado nada es $0.00 (y eso NO es la mentira: es la verdad)', () => {
    const kpi = renderHeader(makeRun({ costActualCents: 0 }), [
      snap({ id: 's1', nodeKey: 'N1', status: 'running' }),
    ]);
    expect(kpi('Coste real')).toContain('$0.00');
  });

  test('el coste ESTIMADO sí se sigue sumando de los steps (esa columna no miente)', () => {
    // `cost_estimated` lo escribe la CREACIÓN del run y no depende de que el step acabe bien, así
    // que sumarlo de los steps es correcto — y por eso el fix no lo tocó.
    const kpi = renderHeader(makeRun({ costActualCents: 13 }), [
      snap({ id: 's1', nodeKey: 'N1', status: 'succeeded', costEstimated: 10 }),
      snap({ id: 's2', nodeKey: 'N3', status: 'failed', costEstimated: 25, costActual: null }),
    ]);
    expect(kpi('Coste estimado')).toContain('$0.35');
    expect(kpi('Coste real')).toContain('$0.13'); // el real, del ledger
  });
});
