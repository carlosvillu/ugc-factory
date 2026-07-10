'use client';

// El ÚNICO sitio que monta el SSE (architecture.md §2.2): `useRunEvents` se monta
// UNA vez aquí (dentro del RunStoreProvider) y puebla el store; canvas, panel y
// cabecera leen del store con selectores. Compone la vista cockpit del mockup 1b:
// cabecera con id/estado + toggle autopilot + KPIs, grafo (canvas) y el inspector.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useRunEvents } from '@/hooks/use-run-events';
import { useRunStore } from '@/stores/run-store';
import { ApiError, runActions } from '@/lib/api-client';
import { RunCanvas } from './run-canvas';
import { StepPanel } from './step-panel';
import { formatCost } from './status';

export function RunShell({ runId }: { runId: string }) {
  const { status } = useRunEvents(runId); // SSE → store; se monta UNA vez

  return (
    <div className="flex h-dvh flex-col bg-bg-subtle">
      <RunHeader runId={runId} />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <RunCanvas />
        </div>
        <StepPanel />
      </div>
      {/* estado de conexión SSE observable (accesible + para e2e) */}
      <output role="status" aria-label="conexión" data-slot="sse-status" className="sr-only">
        {status}
      </output>
    </div>
  );
}

function RunHeader({ runId }: { runId: string }) {
  const run = useRunStore((s) => s.run);
  const autopilot = useRunStore((s) => s.autopilot);
  const setAutopilot = useRunStore((s) => s.setAutopilot);
  const steps = useRunStore((s) => s.steps);

  const [pending, setPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const stepList = Object.values(steps);
  const total = stepList.length;
  const done = stepList.filter((s) => s.status === 'succeeded' || s.status === 'skipped').length;
  const costActual = stepList.reduce((acc, s) => acc + (s.costActual ?? 0), 0);
  const costEstimated = stepList.reduce((acc, s) => acc + (s.costEstimated ?? 0), 0);

  // Toggle autopilot: actualiza el store LOCALMENTE (el SSE no ecoa el objeto run —
  // el snapshot es {runId, steps}, sin run) Y persiste por PATCH. NO es un optimistic
  // update de STEP (el guard prohíbe adivinar estado de step, no de run): el autopilot
  // es estado de nivel run que solo esta UI muta. Si el PATCH falla, se revierte.
  async function onToggleAutopilot(next: boolean) {
    const prev = autopilot;
    setAutopilot(next);
    setPending(true);
    try {
      await runActions.setAutopilot(runId, next);
    } catch (e) {
      setAutopilot(prev); // revertir si el server rechaza
      if (!(e instanceof ApiError)) throw e;
    } finally {
      setPending(false);
    }
  }

  // Cancelar el lote: fetch a la API (el estado nuevo llega por SSE, sin optimistic
  // update). Captura el fallo como el resto de acciones — sin catch sería un
  // unhandled rejection sin feedback al usuario.
  async function onCancel() {
    setCancelError(null);
    try {
      await runActions.cancelRun(runId);
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : 'No se pudo cancelar el lote');
    }
  }

  return (
    <header
      data-slot="run-header"
      data-run-autopilot={autopilot}
      className="border-b border-border bg-bg-subtle px-6 py-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-micro font-semibold tracking-wide text-text-3">
            /runs/{run.id} · {run.kind}
          </div>
          <h1 className="mt-1 text-h3 font-semibold text-text" data-slot="run-title">
            Run {run.id.slice(-6)}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2.5">
            <span className="text-mono font-medium text-text-2">Autopilot</span>
            <Switch
              checked={autopilot}
              disabled={pending}
              onCheckedChange={(next) => void onToggleAutopilot(next)}
              aria-label="Autopilot"
              data-slot="autopilot-toggle"
            />
          </label>
          {/* Cancelar el LOTE: acción de nivel RUN (no de step), por eso vive en la
              cabecera y está SIEMPRE disponible (aunque no haya nodo seleccionado).
              fetch a la API → el estado nuevo llega por SSE (sin optimistic update). */}
          <Button
            size="sm"
            variant="danger-ghost"
            data-slot="cancel-action"
            onClick={() => void onCancel()}
          >
            Cancelar lote
          </Button>
        </div>
      </div>
      {cancelError ? (
        <p role="alert" className="mb-3 text-mono text-danger" data-slot="cancel-error">
          {cancelError}
        </p>
      ) : null}
      <div className="grid grid-cols-4 gap-3">
        <Kpi
          label={`Progreso · ${String(done)}/${String(total)}`}
          value={total > 0 ? `${String(Math.round((done / total) * 100))}%` : '0%'}
        />
        <Kpi label="Coste real" value={formatCost(costActual)} />
        <Kpi label="Coste estimado" value={formatCost(costEstimated)} muted />
        <Kpi label="Pasos" value={String(total)} />
      </div>
    </header>
  );
}

function Kpi({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3.5 py-3">
      <div className={muted ? 'font-mono text-h3 text-text-2' : 'font-mono text-h3 text-text'}>
        {value}
      </div>
      <div className="mt-1 text-micro text-text-3">{label}</div>
    </div>
  );
}
