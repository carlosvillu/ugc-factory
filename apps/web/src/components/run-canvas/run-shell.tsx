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
import { BriefEditor } from '@/components/checkpoints/brief-editor';
import { useBriefCheckpoint } from '@/components/checkpoints/use-brief-checkpoint';
import { RunCanvas } from './run-canvas';
import { StepPanel } from './step-panel';
import { formatCost } from './status';

export function RunShell({ runId }: { runId: string }) {
  const { status } = useRunEvents(runId); // SSE → store; se monta UNA vez

  // CP1 (T1.10b): cuando el checkpoint del brief pausa en `waiting_approval`, el editor de brief
  // pasa a ser el ÁREA DE TRABAJO del run. Pero el CANVAS SIGUE MONTADO — y esto no es un detalle
  // de layout:
  //
  //   - El mockup 3a lo dice en su propia barra de URL (`ugcfactory.local/runs/8f21 · CP1`): CP1
  //     es un ESTADO DENTRO de la página del run, no una página que la sustituye.
  //   - El canvas es el hogar del run: el usuario tiene que poder seguir viendo N1/N2/N3 (sus
  //     estados, su coste) MIENTRAS revisa el brief. Desmontarlo dejaba el pipeline ciego justo
  //     en el momento en el que se está decidiendo si continúa.
  //
  // Reparto: el canvas cede la anchura al editor (un grafo de 3 nodos se lee igual en una
  // columna estrecha; un formulario en tarjetas + rail de trazabilidad, no) y el INSPECTOR
  // genérico (`StepPanel`) se retira — mientras CP1 está abierto, el artefacto que importa es el
  // brief, y dos paneles compitiendo por la derecha sería ruido. Al aprobar, el step deja
  // `waiting_approval` (por SSE) y la vista cockpit vuelve sola.
  //
  // QUÉ ABRE CP1, exactamente: un checkpoint pausado CUYO ARTEFACTO ES UN BRIEF — se discrimina
  // por la FORMA del artefacto (`N3OutputSchema`), igual que en el servidor
  // (`server/brief-checkpoint.ts`), y NUNCA por `node_key` (que no identifica una fila tras un
  // supersede) ni solo por `isCheckpoint` (demasiado ancho: los checkpoints de demo de F0 y los
  // CP2/CP3 de F2 también lo son, y CP1 les secuestraría el panel genérico). El detalle —y por qué
  // la detección no vive en la proyección del SSE— está en `useBriefCheckpoint`.
  //
  // Mientras no haya CONFIRMACIÓN de brief, el hook devuelve `null` y la vista es la cockpit de
  // siempre: en la duda no se secuestra la UI de nadie.
  const cp1 = useBriefCheckpoint();
  const cp1Open = cp1 !== null;

  return (
    // `h-full` (no `h-dvh`): desde T1.13 el viewport lo fija el layout del grupo `(app)`,
    // que resta la altura de la topbar y da al hijo la región restante. Un `h-dvh` aquí
    // sumaría la nav ENCIMA del alto completo → la página del canvas scrollearía.
    <div className="flex h-full flex-col bg-bg-subtle">
      <RunHeader runId={runId} />
      <div className="flex min-h-0 flex-1">
        {/* El canvas NUNCA se desmonta: con CP1 abierto se estrecha, no desaparece. */}
        <div className={cp1Open ? 'w-64 shrink-0 border-r border-border' : 'min-w-0 flex-1'}>
          <RunCanvas />
        </div>
        {cp1 !== null ? (
          <BriefEditor
            stepId={cp1.stepId}
            briefId={cp1.briefId}
            brief={cp1.brief}
            warnings={cp1.warnings}
          />
        ) : (
          <StepPanel />
        )}
      </div>
      {/* estado de conexión SSE observable (accesible + para e2e) */}
      <output role="status" aria-label="conexión" data-slot="sse-status" className="sr-only">
        {status}
      </output>
    </div>
  );
}

/**
 * La cabecera del run (KPIs + toggle autopilot + cancelar). Se EXPORTA —y no solo la consume
 * `RunShell`— para poder testear su «Coste real» sin montar el canvas ni el SSE: es donde vivió
 * un bug de dinero (ver el comentario de `costActual` abajo) y el test tiene que aterrizar
 * exactamente ahí, no dos capas más arriba.
 */
export function RunHeader({ runId }: { runId: string }) {
  const run = useRunStore((s) => s.run);
  const autopilot = useRunStore((s) => s.autopilot);
  const setAutopilot = useRunStore((s) => s.setAutopilot);
  const steps = useRunStore((s) => s.steps);

  const [pending, setPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const stepList = Object.values(steps);
  const total = stepList.length;
  const done = stepList.filter((s) => s.status === 'succeeded' || s.status === 'skipped').length;

  // ────────────────────────────────────────────────────────────────────────────────────────
  // EL «COSTE REAL» SALE DEL LEDGER (servidor), **NO** DE SUMAR LOS STEPS DEL SSE.
  //
  // Aquí había un BUG DE DINERO REAL. Esta línea era:
  //
  //     const costActual = stepList.reduce((acc, s) => acc + (s.costActual ?? 0), 0)
  //
  // y `s.costActual` es `step_run.cost_actual`, que **se queda NULL cuando un step FALLA**:
  // `rollupStepCost` (T1.10b) solo recomputa esa columna al cerrar BIEN un step. Un step que
  // muere HABIENDO GASTADO no la escribe nunca. Resultado observable en la BD del usuario: los
  // dos runs que murieron en N3 gastaron 16 y 13 céntimos de Sonnet, y al abrir su canvas la
  // cabecera decía **«Coste real: $0.00»**. Dinero real, invisible, justo en los runs que más
  // interesa auditar (los que fallaron).
  //
  // La verdad del dinero es el LEDGER (`cost_entry`, append-only) — y ahora la computa el
  // SERVIDOR (`runLedgerCost`, la MISMA función que alimenta el listado `/runs`), así que el
  // canvas y la lista no pueden contradecirse sobre lo que costó un run.
  //
  // TRADEOFF ACEPTADO Y CONSCIENTE: este número llega por REST al cargar la página, así que es
  // una FOTO, no un contador vivo — durante un run en curso no sube con cada step, sube al
  // recargar. Hacerlo vivo exigiría que el SSE llevara coste honesto por step (o un total de
  // run), lo que toca el stream: es tarea aparte. Un total honesto-y-estático es estrictamente
  // mejor que uno vivo-y-mentiroso, y en los runs TERMINALES —que son los que se auditan— es
  // exacto. El coste ESTIMADO sí se sigue sumando de los steps: `cost_estimated` lo escribe la
  // creación del run y NO depende de que el step acabe bien, así que no miente.
  // ────────────────────────────────────────────────────────────────────────────────────────
  const costActual = run.costActualCents;
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
