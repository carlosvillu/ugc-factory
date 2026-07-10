'use client';

// Hook de dominio que une SSE + store (state-and-sse.md §5): `useEventSource` recibe
// los frames crudos, aquí se VALIDAN con `RunEventSchema` (Zod de core, contrato
// REAL de T0.10) y se despachan al store. Es la ÚNICA puerta de entrada del estado
// del run: ningún componente escucha SSE por su cuenta. Se monta UNA vez en el shell
// de `/runs/[id]`.
//
// Divergencias con state-and-sse.md (la skill está STALE vs lo shipped en T0.10):
//  - discriminador `event` (la skill dice `type`).
//  - el frame `data:` YA porta el `event` completo (`{event:'snapshot', runId,
//    steps}`) → se valida el payload entero, no `{type, data}`.
//  - exports reales en `@ugc/core/orchestrator` (no `@ugc/core/contracts`).
//  - SIEMPRE `enabled` en F0: NO se gatea con `isTerminalRunStatus` (ese campo no
//    existe — run.status derivado es deuda diferida de T0.8). Un run terminado
//    simplemente deja de emitir; la conexión se libera cuando la página se desmonta.
import { RUN_EVENT_TYPES, RunEventSchema } from '@ugc/core/orchestrator';
import { useRunStore } from '@/stores/run-store';
import { useEventSource } from './use-event-source';

export function useRunEvents(runId: string): {
  status: ReturnType<typeof useEventSource>['status'];
  lastEventId: string;
} {
  const applySnapshot = useRunStore((s) => s.applySnapshot);
  const applyStepChanged = useRunStore((s) => s.applyStepChanged);

  const { status, lastEventId } = useEventSource(`/api/runs/${runId}/events`, {
    events: RUN_EVENT_TYPES,
    enabled: true, // F0: siempre abierto (§brief T0.11); un run terminal deja de emitir
    onEvent: (_type, ev) => {
      let payload: unknown;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return; // data corrupta: ignora, no rompas el stream
      }
      const parsed = RunEventSchema.safeParse(payload);
      if (!parsed.success) return; // evento desconocido o shape inválido → ignorar (forward-compat)
      switch (parsed.data.event) {
        case 'snapshot':
          applySnapshot({ runId: parsed.data.runId, steps: parsed.data.steps });
          break;
        case 'step_changed':
          applyStepChanged(parsed.data);
          break;
        case 'heartbeat':
          break; // solo mantiene viva la conexión
      }
    },
  });

  return { status, lastEventId };
}
