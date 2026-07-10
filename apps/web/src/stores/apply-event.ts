// Reducer PURO evento SSE → estado del run (state-and-sse.md §3). Separado del hook
// y del store: se testea sin DOM, sin React, sin fakes (es lógica de transformación,
// testing/frontend.md §4). Los eventos son el discriminated union Zod de @ugc/core
// (run-events.ts), discriminado por `event` (NO `type` — la skill state-and-sse.md
// está desactualizada; el código shipped de T0.10 manda).
//
// Contrato §9.0:
//   - `snapshot` SUSTITUYE los steps (no mergea): la foto ES el estado completo.
//     Steps superseded por invalidación desaparecen; los nuevos aparecen. Mergear
//     dejaría steps fantasma tras una reconexión.
//   - `step_changed` parchea SOLO su step (por `stepId`); jamás toca otro ni el run.
//   - `heartbeat` no toca estado.
import type { RunEvent, StepSnapshot } from '@ugc/core/orchestrator';

// El estado que el reducer transforma: solo los `steps` (el run-level lo mantiene el
// store desde REST; el SSE no porta el objeto run — §9.0). El reducer devuelve un
// Partial para que `set` de Zustand mergee de primer nivel.
export interface RunEventState {
  steps: Record<string, StepSnapshot>;
}

export const indexSteps = (steps: StepSnapshot[]): Record<string, StepSnapshot> =>
  Object.fromEntries(steps.map((s) => [s.id, s]));

export function applyRunEvent(state: RunEventState, event: RunEvent): Partial<RunEventState> {
  switch (event.event) {
    case 'snapshot':
      // SUSTITUYE (contrato §9.0): el snapshot es el estado completo.
      return { steps: indexSteps(event.steps) };

    case 'step_changed': {
      const prev = state.steps[event.stepId];
      // Delta de un step desconocido (fila nueva por invalidación que el snapshot
      // aún no trajo): no inventes un StepSnapshot parcial — ignora y confía en el
      // siguiente snapshot del servidor. (En F0 el servidor re-lee TODOS los steps
      // por delta, así que este caso es raro, pero el reducer es defensivo.)
      if (!prev) return {};
      // Mapeo delta→campos EXPLÍCITO (nada de `{...prev, ...delta}`): si el contrato
      // cambia, que lo detecte el compilador, no producción. El delta enriquecido de
      // T0.11 porta los campos que CAMBIAN en vivo (status, coste, duración) — se
      // copian todos; `dependsOn`/`isCheckpoint` son invariantes pero se re-emiten y
      // se copian por consistencia (el delta describe el AHORA completo del step).
      return {
        steps: {
          ...state.steps, // inmutable: solo cambia la referencia del step tocado
          [event.stepId]: {
            ...prev,
            status: event.status,
            cost: event.cost,
            outputExcerpt: event.outputExcerpt,
            dependsOn: event.dependsOn,
            isCheckpoint: event.isCheckpoint,
            costEstimated: event.costEstimated,
            costActual: event.costActual,
            durationMs: event.durationMs,
            errorExcerpt: event.errorExcerpt,
          },
        },
      };
    }

    case 'heartbeat':
      return {}; // no toca estado: ningún selector re-renderiza
  }
}
