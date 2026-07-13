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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useRunStore } from '@/stores/run-store';
import { ApiError, runActions } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { nodeBadgeLabel, nodeTitle } from './node-titles';
import { StepArtifactDialog } from './step-artifact-dialog';
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
  // Qué visor grande está abierto (T1.16): el del output (que pide el artefacto COMPLETO
  // a la API) o el del error. `null` = ninguno.
  const [viewer, setViewer] = useState<'output' | 'error' | null>(null);

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
        <div className="min-w-0">
          <div className="font-mono text-micro font-semibold tracking-wide text-text-3">
            INSPECTOR
          </div>
          {/* T1.16: el TÍTULO HUMANO del nodo (§7.2) es el encabezado; la clave queda como
              badge mono secundario (y sigue en el aria-label del aside: API de tests). El
              estado, que antes era el h2, baja a línea de detalle. */}
          <h2 className="mt-1 text-h3 font-semibold text-text">{nodeTitle(step.nodeKey)}</h2>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge mono tone={isCheckpoint ? 'warning' : 'neutral'} data-slot="panel-node-key">
              {nodeBadgeLabel(step.nodeKey, isCheckpoint)}
            </Badge>
            <span className="text-mono text-text-2">{statusLabel[step.status]}</span>
          </div>
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

      {/* Visor de error (solo si el step falló). La caja es un BOTÓN → modal grande con el
          error COMPLETO (el excerpt del SSE lo trunca a 200 chars). */}
      {step.errorExcerpt ? (
        <ArtifactBox
          kind="error"
          excerpt={step.errorExcerpt}
          onOpen={() => {
            setViewer('error');
          }}
        />
      ) : null}

      {/* Visor del output / artefacto JSON. Mismo trato: la caja es CLICABLE y la modal pide el
          `output_refs` ENTERO a `GET /api/steps/:id` — lo que se pinta aquí es el excerpt, que
          el SERVIDOR trunca (no es un problema de CSS: el resto NO está en el cliente). */}
      {step.outputExcerpt ? (
        <ArtifactBox
          kind="output"
          excerpt={step.outputExcerpt}
          onOpen={() => {
            setViewer('output');
          }}
        />
      ) : (
        <section aria-label="Output del paso" data-slot="output-viewer">
          <div className="mb-1.5 font-mono text-micro font-semibold tracking-wide text-text-3">
            OUTPUT
          </div>
          <p className="text-mono text-text-3">Sin output todavía.</p>
        </section>
      )}

      {/* La modal del artefacto: una sola instancia, el `kind` decide qué muestra. */}
      {viewer !== null ? (
        <StepArtifactDialog
          open
          onOpenChange={(open) => {
            if (!open) setViewer(null);
          }}
          kind={viewer}
          stepId={stepId}
          nodeKey={step.nodeKey}
          fallback={(viewer === 'output' ? step.outputExcerpt : step.errorExcerpt) ?? ''}
        />
      ) : null}

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

// La caja del artefacto en el inspector: el EXCERPT del SSE (el recorte de 200 caracteres)
// como preview clicable que abre el visor completo. Output y error eran el mismo bloque
// escrito dos veces —mismo `<section>`, mismo botón, mismo `<pre>`, misma llamada a la
// acción— con cinco valores distintos; extraerla deja la a11y (rol de botón, `aria-label`,
// `focus-visible`) en UN sitio.
//
// Es un `<button>` con clases de token y no una primitiva del DS porque el DS no tiene
// "región de preview clicable" (Card no es interactiva, Button no envuelve un bloque con
// scroll). Lo que sí es del DS: cada color, cada radio y cada sombra.
const BOX: Record<
  'output' | 'error',
  { label: string; slot: string; box: string; pre: string; cta: string; action: string }
> = {
  output: {
    label: 'Output del paso',
    slot: 'output',
    box: 'border-border bg-surface-2 hover:border-border-strong',
    pre: 'max-h-56 text-text-2',
    // La LLAMADA A LA ACCIÓN va en `--text` (texto fuerte), no en un color de acento ni de
    // estado. Medido sobre la superficie REAL de cada caja (T1.16, tras el FAIL del verifier):
    //
    //     CTA                     dark    light
    //     text-accent (output)    3,20 ❌  5,07     ← el acento es MARCA, no texto: mismo hex en
    //                                                 ambos temas Y elegible por el usuario
    //     text-danger  (error)    4,45 ❌  5,30     ← a 0,05 del umbral: margen escaso = deuda
    //     text-text    (ambas)   15,24    14,86  ✅  ← el elegido
    //
    // Lo que un CTA necesita es DESTACAR, y el peso (600) + la caja ya coloreada lo consiguen;
    // el color del texto no tiene que cargar también con eso. Mismo razonamiento que la paleta
    // del visor (`json-token-palette.ts`): margen amplio, y nada atado a `--accent`.
    cta: 'text-text',
    action: 'Ver el output completo',
  },
  error: {
    label: 'Error del paso',
    slot: 'error',
    box: 'border-danger-border bg-danger-soft hover:border-danger',
    pre: 'max-h-40 text-text',
    cta: 'text-text',
    action: 'Ver el error completo',
  },
};

function ArtifactBox({
  kind,
  excerpt,
  onOpen,
}: {
  kind: 'output' | 'error';
  excerpt: string;
  onOpen: () => void;
}) {
  const v = BOX[kind];
  return (
    <section aria-label={v.label} data-slot={`${v.slot}-viewer`}>
      <div
        className={cn(
          'mb-1.5 font-mono text-micro font-semibold tracking-wide',
          kind === 'error' ? 'text-danger' : 'text-text-3',
        )}
      >
        {kind === 'error' ? 'ERROR' : 'OUTPUT'}
      </div>
      <button
        type="button"
        aria-label={v.action}
        data-slot={`open-${v.slot}-dialog`}
        onClick={onOpen}
        className={cn(
          'block w-full cursor-pointer rounded-md border p-3 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none',
          v.box,
        )}
      >
        <pre
          className={cn(
            'overflow-hidden font-mono text-micro whitespace-pre-wrap break-words',
            v.pre,
          )}
        >
          {excerpt}
        </pre>
        <span className={cn('mt-2 block text-micro font-semibold', v.cta)}>{v.action} →</span>
      </button>
    </section>
  );
}
