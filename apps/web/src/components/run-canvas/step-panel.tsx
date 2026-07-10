'use client';

// Panel lateral del canvas (inspector inline, NO modal — el mockup 1b es un cockpit
// denso con el inspector fijo a la derecha). Se abre al click en un nodo (selección
// en el store). Muestra, del step seleccionado:
//   - visor genérico de output/JSON del artefacto (§8.2),
//   - visor de error/logs (el `errorExcerpt` del step fallido),
//   - botones de acción según el estado: approve/edit/reject (checkpoint),
//     retry (failed), skip (skippable), y cancelar el LOTE (siempre disponible).
//
// GUARD DE ALCANCE (canvas.md §5): los botones hacen fetch vía api-client y NO tocan
// el store — el estado nuevo llega por SSE y el canvas se repinta solo. NADA de
// optimistic updates (con invalidación de sub-grafo, adivinar el estado en cliente
// es reimplementar el orquestador mal). El "editar" abre un editor JSON genérico
// mínimo del output (NO el editor rico CP1/CP2/CP3 — eso es forms.md, tareas
// posteriores); el `approve_edited` de T0.8 acepta el diff.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useRunStore } from '@/stores/run-store';
import { ApiError, runActions } from '@/lib/api-client';
import { formatCostSplit, formatDuration, statusLabel } from './status';

// Estados en los que el skip es LEGAL (transitions.ts): awaiting_deps / pending. El
// botón solo aparece ahí (un skip ilegal daría 409; no lo ofrecemos).
const SKIPPABLE = new Set(['awaiting_deps', 'pending']);

export function StepPanel() {
  const selectedStepId = useRunStore((s) => s.selectedStepId);
  const step = useRunStore((s) => (s.selectedStepId ? s.steps[s.selectedStepId] : undefined));
  const selectStep = useRunStore((s) => s.selectStep);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');

  // Acción envuelta: marca busy, captura el error del envelope, y NO toca el store
  // (el SSE trae el estado nuevo). En éxito cierra el modo edición.
  async function run(action: () => Promise<unknown>, onOk?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onOk?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error inesperado');
    } finally {
      setBusy(false);
    }
  }

  if (!selectedStepId || !step) {
    return (
      <aside
        data-slot="step-panel"
        aria-label="Inspector del paso"
        className="flex w-96 shrink-0 flex-col border-l border-border bg-surface p-5"
      >
        <div className="font-mono text-micro font-semibold tracking-wide text-text-3">
          INSPECTOR
        </div>
        <p className="mt-4 text-mono text-text-3">
          Selecciona un nodo del grafo para ver su detalle.
        </p>
      </aside>
    );
  }

  // Id garantizado no-null tras el guard: las clausuras de los handlers lo capturan
  // (el narrowing de `selectedStepId` no cruza el borde de una función anidada).
  const stepId = selectedStepId;
  const isCheckpoint = step.status === 'waiting_approval';
  const isFailed = step.status === 'failed';
  const isSkippable = SKIPPABLE.has(step.status);

  function startEditing() {
    // Semilla del editor: el output actual del step (excerpt) como JSON legible, o
    // un objeto vacío. El editor es genérico (textarea) — NO un form de brief.
    setEditDraft(step?.outputExcerpt ?? '{}');
    setEditing(true);
    setError(null);
  }

  function submitEdit() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(editDraft);
    } catch {
      setError('El JSON del editor no es válido');
      return;
    }
    void run(
      () => runActions.edit(stepId, parsed),
      () => {
        setEditing(false);
      },
    );
  }

  return (
    <aside
      data-slot="step-panel"
      data-step-status={step.status}
      aria-label={`Inspector del paso ${step.nodeKey}`}
      className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-micro font-semibold tracking-wide text-text-3">
            INSPECTOR · {step.nodeKey}
          </div>
          <h2 className="mt-1 text-h3 font-semibold text-text">{statusLabel[step.status]}</h2>
        </div>
        <Button
          icon
          size="sm"
          variant="ghost"
          aria-label="Cerrar inspector"
          onClick={() => {
            selectStep(null);
          }}
        >
          ✕
        </Button>
      </header>

      {/* metadatos: duración + coste estimado/real */}
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <dt className="text-micro text-text-3">Duración</dt>
          <dd className="font-mono text-mono text-text" data-slot="panel-duration">
            {formatDuration(step.durationMs)}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <dt className="text-micro text-text-3">Coste</dt>
          <dd className="font-mono text-mono text-text" data-slot="panel-cost">
            {formatCostSplit(step.costActual, step.costEstimated)}
          </dd>
        </div>
      </dl>

      {/* visor de error / logs (solo si el step falló y hay error) */}
      {step.errorExcerpt ? (
        <section aria-label="Error del paso" data-slot="error-viewer">
          <div className="mb-1.5 font-mono text-micro font-semibold tracking-wide text-danger">
            ERROR
          </div>
          <pre className="max-h-40 overflow-auto rounded-md border border-danger-border bg-danger-soft p-3 font-mono text-micro whitespace-pre-wrap break-words text-text">
            {step.errorExcerpt}
          </pre>
        </section>
      ) : null}

      {/* visor genérico de output / artefacto JSON */}
      <section aria-label="Output del paso" data-slot="output-viewer">
        <div className="mb-1.5 font-mono text-micro font-semibold tracking-wide text-text-3">
          OUTPUT
        </div>
        {step.outputExcerpt ? (
          <pre className="max-h-56 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-micro whitespace-pre-wrap break-words text-text-2">
            {step.outputExcerpt}
          </pre>
        ) : (
          <p className="text-mono text-text-3">Sin output todavía.</p>
        )}
      </section>

      {/* editor JSON genérico (modo edición del checkpoint) */}
      {editing ? (
        <section aria-label="Editar output" data-slot="output-editor">
          <label htmlFor="output-editor" className="mb-1.5 block font-mono text-micro text-text-3">
            Editar output (JSON)
          </label>
          <Textarea
            id="output-editor"
            rows={6}
            value={editDraft}
            onChange={(e) => {
              setEditDraft(e.target.value);
            }}
            className="font-mono text-micro"
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={submitEdit}>
              Guardar y aprobar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancelar edición
            </Button>
          </div>
        </section>
      ) : null}

      {/* error de una acción (envelope de la API) */}
      {error ? (
        <p role="alert" className="text-mono text-danger" data-slot="action-error">
          {error}
        </p>
      ) : null}

      {/* botones de acción según el estado */}
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
        {isCheckpoint && !editing ? (
          <div className="flex flex-wrap gap-2" data-slot="checkpoint-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void run(() => runActions.approve(stepId))}
              className="border-success bg-success text-success-on hover:border-success hover:bg-success focus-visible:border-success"
            >
              Aprobar
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={startEditing}>
              Editar
            </Button>
            <Button
              size="sm"
              variant="danger-ghost"
              disabled={busy}
              onClick={() => void run(() => runActions.reject(stepId))}
            >
              Rechazar
            </Button>
          </div>
        ) : null}

        {isFailed ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            data-slot="retry-action"
            // Retry con patch de config `failRate=0` para que el reintento complete
            // (mismo criterio que la Verificación de T0.9). El body opcional del
            // endpoint acepta este patch en la misma tx.
            onClick={() => void run(() => runActions.retry(stepId, { failRate: 0 }))}
          >
            Reintentar
          </Button>
        ) : null}

        {isSkippable ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            data-slot="skip-action"
            onClick={() => void run(() => runActions.skip(stepId))}
          >
            Saltar
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
