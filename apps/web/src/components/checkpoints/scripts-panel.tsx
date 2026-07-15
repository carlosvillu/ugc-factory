'use client';

// CP3 — EDITOR DE GUIONES (T2.6, PRD §7.2 N5 / §9.4). El checkpoint humano de F2: N5 escribe los
// guiones de todas las variantes del lote, el step pausa en `waiting_approval`, y aquí el usuario
// los revisa, edita la narración escena a escena, ve los flags de compliance y aprueba —por variante
// o el lote entero.
//
// DE DÓNDE SALE EL TEXTO. El artefacto de N5 es LIGERO (refs), no trae el guion. El panel pide los
// guiones vigentes por REST (`GET /api/batches/:id/scripts`), que reconstruye cada `AdScript` VÁLIDO
// (fila + matriz: la fila no guarda `filenameCode`/`sharedBodyKey`). El usuario edita ESE `AdScript`
// y lo RE-MANDA en el veredicto; el servidor lo re-deriva desde las narraciones y re-lintea.
//
// LOS DOS INVARIANTES QUE GOBIERNAN LA UI (el resto de la política es del SERVIDOR):
//
//   1. BLOQUEO ≠ CANDADO. Una variante con flag BLOQUEANTE no se puede aprobar TAL CUAL — pero si el
//      usuario la EDITA, se re-habilita: el cliente no puede re-lintear (no tiene el brief), así que
//      deja que el SERVIDOR sea el guard (re-lintea la edición y rechaza la transición si sigue
//      bloqueada). Sin esta regla, editar para RESOLVER un flag dejaría el botón muerto para siempre.
//
//   2. LA NARRACIÓN ES LA ÚNICA FUENTE. Se edita la `narration` de cada escena (agrupadas por
//      segmento). `hook`/`cta`/`fullText`/timing NO se editan: los deriva el servidor
//      (`rebuildEditedScript`). Exponerlos como campos aparte invitaría a que divergieran del texto.
import { useEffect, useState } from 'react';
import type { AdScript, BatchScript, GuardrailFlag } from '@ugc/core/contracts';
import { ApiError, batchActions, runActions } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

export interface ScriptsPanelProps {
  /** El step de CP3 (N5 en `waiting_approval`): a él van los veredictos. */
  stepId: string;
  /** El lote cuyos guiones se editan: el panel pide sus guiones vigentes por REST. */
  batchId: string;
}

/** El estado de UNA variante en el panel: su guion (editable), si el usuario decidió aprobarla, y
 *  si la ha tocado. `edited` gobierna dos cosas a la vez (por eso es UN flag, no dos): si se manda
 *  `editedScript` en el veredicto Y si se re-habilita el aprobar de una variante bloqueada. */
interface VariantState {
  meta: BatchScript;
  /** El guion editable: copia local del `AdScript`, mutada al tocar una narración. */
  script: AdScript;
  approved: boolean;
  edited: boolean;
}

/** ¿La variante tiene algún flag BLOQUEANTE en su versión vigente? (§15.2) */
function hasBlockingFlag(flags: GuardrailFlag[]): boolean {
  return flags.some((f) => f.blocking);
}

const SEGMENT_LABEL: Record<'hook' | 'body' | 'cta', string> = {
  hook: 'Hook',
  body: 'Body',
  cta: 'CTA',
};

export function ScriptsPanel({ stepId, batchId }: ScriptsPanelProps) {
  // El estado por variante. `null` = aún cargando (o falló la carga: el panel pide los guiones al
  // montar, como matrix-panel pide las personas). No se escribe estado síncrono al entrar.
  const [variants, setVariants] = useState<VariantState[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    batchActions
      .getScripts(batchId)
      .then((res) => {
        if (cancelled) return;
        setVariants(
          res.scripts.map((s) => ({ meta: s, script: s.script, approved: false, edited: false })),
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof ApiError ? e.message : 'No se pudieron cargar los guiones');
      });
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  /** Edita la narración de UNA escena de UNA variante. Marca la variante como editada (re-habilita
   *  su aprobar aunque tuviera flag bloqueante: el servidor re-lintea y decide). */
  function editScene(variantId: string, sceneIndex: number, narration: string) {
    setSubmitError(null);
    setVariants((prev) =>
      prev === null
        ? prev
        : prev.map((v) => {
            if (v.meta.variantId !== variantId) return v;
            const scenes = v.script.scenes.map((scene, i) =>
              i === sceneIndex ? { ...scene, narration } : scene,
            );
            return { ...v, script: { ...v.script, scenes }, edited: true };
          }),
    );
  }

  function toggleApprove(variantId: string, approved: boolean) {
    setSubmitError(null);
    setVariants((prev) =>
      prev === null
        ? prev
        : prev.map((v) => (v.meta.variantId === variantId ? { ...v, approved } : v)),
    );
  }

  function approveAll() {
    setVariants((prev) =>
      prev === null
        ? prev
        : prev.map((v) => {
            // Aprobar TODO no fuerza las bloqueadas-sin-editar: esas siguen sin poder aprobarse
            // (el servidor las rechazaría igual). Se aprueban las que el guard local permite.
            const blocked = hasBlockingFlag(v.meta.guardrailFlags) && !v.edited;
            return blocked ? v : { ...v, approved: true };
          }),
    );
  }

  /** Envía los veredictos: `editedScript` SOLO para las variantes tocadas (el servidor no-opea sobre
   *  un guion idéntico igualmente, pero mandarlo solo cuando cambió es más honesto). El estado nuevo
   *  del step llega por SSE ⇒ este panel se desmonta solo (sin optimistic update, canvas.md §5). */
  async function onSubmit() {
    if (variants === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await runActions.approve(stepId, {
        kind: 'scripts',
        verdicts: variants.map((v) => ({
          variantId: v.meta.variantId,
          approved: v.approved,
          ...(v.edited && { editedScript: v.script }),
        })),
      });
      // El step deja `waiting_approval` por SSE ⇒ el panel se desmonta. No hay estado que mantener.
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : 'No se pudieron guardar los guiones');
      setSubmitting(false);
    }
  }

  if (loadError !== null) {
    return (
      <div
        data-slot="scripts-panel"
        data-step-id={stepId}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg p-6"
      >
        <p role="alert" data-slot="scripts-load-error" className="text-mono text-danger">
          {loadError}
        </p>
      </div>
    );
  }

  if (variants === null) {
    return (
      <div
        data-slot="scripts-panel"
        data-step-id={stepId}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg p-6"
      >
        <p className="text-mono text-text-3">Cargando guiones…</p>
      </div>
    );
  }

  const approvedCount = variants.filter((v) => v.approved).length;

  return (
    <div
      data-slot="scripts-panel"
      data-step-id={stepId}
      data-batch-id={batchId}
      aria-label="Editor de guiones (CP3)"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg"
    >
      <div className="border-b border-border bg-bg-subtle px-6 py-5">
        <div className="mb-1.5 font-mono text-micro font-semibold tracking-widest text-warning">
          ◆ CP3 · EDITOR DE GUIONES
        </div>
        <h2 className="mb-1 text-h2 font-semibold text-text" data-slot="scripts-title">
          Revisa los guiones del lote
        </h2>
        <p className="max-w-2xl text-mono text-text-3">
          N5 escribió un guion por variante. Edita la narración escena a escena, resuelve los avisos
          de compliance y aprueba. El timing y el texto completo se recalculan solos al editar.
        </p>
      </div>

      <div className="flex flex-col gap-4 p-6" data-slot="scripts-list">
        {variants.map((v) => (
          <VariantCard
            key={v.meta.variantId}
            state={v}
            onEditScene={(sceneIndex, narration) => {
              editScene(v.meta.variantId, sceneIndex, narration);
            }}
            onToggleApprove={(approved) => {
              toggleApprove(v.meta.variantId, approved);
            }}
          />
        ))}
      </div>

      {/* Barra de acciones: aprobar el lote entero + confirmar. `sticky bottom-0` para que la acción
          esté a la vista mientras se recorren los guiones. */}
      <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-4 border-t border-border bg-surface px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-slot="approve-all"
            onClick={approveAll}
          >
            Aprobar todas las aptas
          </Button>
          <span className="text-micro text-text-3" data-slot="approved-count">
            <span className="font-mono text-text-2">{approvedCount}</span> / {variants.length}{' '}
            aprobadas
          </span>
        </div>
        <div className="flex items-center gap-3">
          {submitError !== null ? (
            <p role="alert" data-slot="scripts-error" className="text-mono text-danger">
              {submitError}
            </p>
          ) : null}
          <Button
            type="button"
            data-slot="confirm-scripts"
            disabled={submitting}
            onClick={() => void onSubmit()}
            variant="primary"
            className="border-success bg-success text-success-on hover:border-success hover:bg-success focus-visible:border-success"
          >
            {submitting ? 'Guardando…' : 'Confirmar guiones'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** La tarjeta de UNA variante: cabecera (ángulo · filename_code · persona), sus flags de compliance,
 *  sus escenas editables agrupadas por segmento y su control de aprobación. */
function VariantCard({
  state,
  onEditScene,
  onToggleApprove,
}: {
  state: VariantState;
  onEditScene: (sceneIndex: number, narration: string) => void;
  onToggleApprove: (approved: boolean) => void;
}) {
  const { meta, script, approved, edited } = state;
  const blocking = hasBlockingFlag(meta.guardrailFlags);
  // EL GUARD LOCAL (invariante #1): una variante bloqueada NO se puede aprobar hasta editarla. Una
  // vez editada, se re-habilita y el SERVIDOR decide (re-lintea y rechaza si sigue bloqueada).
  const approveBlocked = blocking && !edited;

  return (
    <section
      data-slot="variant-card"
      data-variant-id={meta.variantId}
      data-filename-code={meta.filenameCode}
      data-blocking={blocking}
      data-edited={edited}
      aria-label={`Guion de ${meta.filenameCode}`}
      className="rounded-lg border border-border bg-surface p-4.5"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-mono font-semibold text-text">{meta.angleName}</h3>
          <p className="mt-0.5 font-mono text-micro text-accent" data-slot="variant-filename">
            {meta.filenameCode}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="neutral" mono>
            {meta.personaName ?? 'sin persona'}
          </Badge>
          <Badge tone="neutral" mono>
            {script.language}
          </Badge>
        </div>
      </div>

      {/* FLAGS DE COMPLIANCE (§15.2): bloqueantes en `danger` (rojo), avisos en `warning` (ámbar).
          Primitiva `Alert` del DS, no HTML crudo. Cada flag muestra el fragmento que lo disparó y la
          sugerencia compliant. Los flags son los de la versión VIGENTE (los re-deriva el servidor al
          aprobar; aquí se pintan para que el usuario sepa qué corregir). */}
      {meta.guardrailFlags.length > 0 ? (
        <div className="mb-3 flex flex-col gap-2" data-slot="variant-flags">
          {meta.guardrailFlags.map((flag, i) => (
            <Alert
              key={`${flag.rule}-${String(i)}`}
              tone={flag.blocking ? 'danger' : 'warning'}
              data-slot={`flag-${flag.rule}`}
              data-blocking={flag.blocking}
            >
              <span>
                <strong className="font-semibold">
                  {flag.blocking ? 'Bloqueante' : 'Aviso'} · {flag.rule}.
                </strong>{' '}
                {flag.explanation} Detectado en «{flag.excerpt}». Sugerencia: {flag.suggestion}
              </span>
            </Alert>
          ))}
        </div>
      ) : null}

      {/* ESCENAS por segmento: la narración es lo editable (todo lo demás lo deriva el servidor). */}
      <div className="flex flex-col gap-2.5" data-slot="variant-scenes">
        {script.scenes.map((scene, i) => (
          <div key={`${meta.variantId}-scene-${String(i)}`} className="flex items-start gap-2.5">
            <Badge tone="neutral" mono className="mt-1 shrink-0">
              {SEGMENT_LABEL[scene.segment]}
            </Badge>
            <div className="min-w-0 flex-1">
              <label htmlFor={`${meta.variantId}-scene-${String(i)}`} className="sr-only">
                Narración de la escena {i + 1} ({scene.segment}) de {meta.filenameCode}
              </label>
              <Textarea
                id={`${meta.variantId}-scene-${String(i)}`}
                data-slot="scene-narration"
                data-segment={scene.segment}
                rows={2}
                value={scene.narration}
                onChange={(e) => {
                  onEditScene(i, e.target.value);
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* APROBACIÓN de la variante. Deshabilitada si está bloqueada y sin editar (invariante #1); el
          MOTIVO va en el texto de al lado para que el botón inerte no sea un misterio. */}
      <div className="mt-3.5 flex items-center gap-3 border-t border-border pt-3">
        <Checkbox
          checked={approved}
          disabled={approveBlocked}
          onCheckedChange={(next) => {
            onToggleApprove(next);
          }}
          label="Aprobar esta variante"
          data-slot="approve-variant"
        />
        {approveBlocked ? (
          <span className="text-micro text-danger" data-slot="approve-blocked">
            Tiene un flag bloqueante — edítala para poder aprobarla.
          </span>
        ) : edited ? (
          <span className="text-micro text-text-3" data-slot="variant-edited">
            Editada — se guardará como versión nueva.
          </span>
        ) : null}
      </div>
    </section>
  );
}
