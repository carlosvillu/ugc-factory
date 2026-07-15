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
import { MatrixPanel } from '@/components/checkpoints/matrix-panel';
import { useMatrixCheckpoint } from '@/components/checkpoints/use-matrix-checkpoint';
import { ScriptsPanel } from '@/components/checkpoints/scripts-panel';
import { useScriptsCheckpoint } from '@/components/checkpoints/use-scripts-checkpoint';
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
  // CP2 (T2.3): el checkpoint de la MATRIZ. Mismo trato que CP1 —el canvas sigue montado, el
  // inspector genérico se retira— y por las mismas razones. Los dos NUNCA están abiertos a la vez:
  // N4 depende de N3, así que mientras CP1 pausa, N4 está en `awaiting_deps`. El `cp1 !== null`
  // manda igualmente en el orden de comprobación: si por lo que fuera hubiera dos artefactos
  // reconocibles, gana el que bloquea al otro.
  const cp2 = useMatrixCheckpoint();
  // CP3 (T2.6): el checkpoint de GUIONES (N5). Mismo trato que CP1/CP2 —el canvas sigue montado, el
  // inspector genérico se retira—. Vive en el run de N5 (el que arranca la aprobación de CP2), un
  // run DISTINTO del de análisis: aquí NUNCA coexiste con CP1/CP2 (son de otro run). El editor pide
  // los guiones del lote por REST; el artefacto de N5 solo trae el `batchId`.
  const cp3 = useScriptsCheckpoint();
  const checkpointOpen = cp1 !== null || cp2 !== null || cp3 !== null;

  return (
    // `h-full` (no `h-dvh`): desde T1.13 el viewport lo fija el layout del grupo `(app)`,
    // que resta la altura de la topbar y da al hijo la región restante. Un `h-dvh` aquí
    // sumaría la nav ENCIMA del alto completo → la página del canvas scrollearía.
    <div className="flex h-full flex-col bg-bg-subtle">
      <RunHeader runId={runId} />
      <div className="flex min-h-0 flex-1">
        {/* El canvas NUNCA se desmonta: con un checkpoint abierto se estrecha, no desaparece. */}
        <div className={checkpointOpen ? 'w-64 shrink-0 border-r border-border' : 'min-w-0 flex-1'}>
          <RunCanvas />
        </div>
        {cp1 !== null ? (
          <BriefEditor
            stepId={cp1.stepId}
            briefId={cp1.briefId}
            brief={cp1.brief}
            warnings={cp1.warnings}
          />
        ) : cp2 !== null ? (
          <MatrixPanel stepId={cp2.stepId} brief={cp2.brief} config={cp2.config} />
        ) : cp3 !== null ? (
          <ScriptsPanel stepId={cp3.stepId} batchId={cp3.batchId} />
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
  // y `s.costActual` es `step_run.cost_actual`, que ENTONCES (T1.17) **se quedaba NULL cuando un
  // step FALLABA**: el rollup (T1.10b) vivía en el consumer del worker y solo corría al cerrar
  // BIEN un step, así que un step que moría HABIENDO GASTADO no la escribía nunca. Los dos runs
  // que murieron en N3 gastaron 16 y 13 céntimos de Sonnet y la cabecera decía «Coste real:
  // $0.00»: dinero real, invisible, justo en los runs que más interesa auditar.
  //
  // T1.20 ARREGLÓ LA COLUMNA EN ORIGEN (el rollup corre ahora dentro de `applyTransition`, en
  // TODOS los caminos de cierre, y una migración de backfill reparó los datos históricos), así
  // que `s.costActual` ya NO miente. Aun así **esta línea sigue leyendo del LEDGER vía servidor**,
  // y a propósito: `runLedgerCost` es la MISMA función que alimenta el listado `/runs`, de modo
  // que canvas y lista no pueden contradecirse sobre lo que costó un run; y el ledger es la
  // verdad del dinero, mientras que la columna es una proyección de él (recomputable, pero
  // proyección). Sumar la proyección para obtener un total que el ledger ya sabe dar es
  // preferir la copia al original.
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
