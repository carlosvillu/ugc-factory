'use client';

// CP4 — REVISIÓN DE VARIANTES (T5.6, §9.7 N9 / §9.0). El checkpoint humano de F5: cada variante que
// terminó su máster tiene un step N9 pausado en `waiting_approval` (§9.7: N9 es el ÚNICO checkpoint
// del DAG de generación, `alwaysPause:true`). Aquí el usuario ve el vídeo, comprueba las safe zones y
// los resultados del QA, y aprueba o rechaza — POR VARIANTE.
//
// LA DIFERENCIA ESTRUCTURAL con CP1/CP2/CP3 (must-carry de T5.6): CP4 son N pausas EN PARALELO, no
// una. `useQaCheckpoints` recoge TODOS los N9 pausados (no `paused[0]`); este panel los lista en el
// sidebar izquierdo y resuelve cada uno POR SEPARADO. Aprobar/rechazar son PLANOS (sin `decision`):
// el efecto per-variante (`ad_variant.status`) lo pone el SERVIDOR por la forma del artefacto N9
// (T5.5c). No hay optimistic update: al resolver, el step deja `waiting_approval` por SSE, el store
// se re-pinta y la variante desaparece de la lista (patrón `scripts-panel`).
//
// DE DÓNDE SALEN LOS DATOS de la variante seleccionada:
//   · el `masterAssetId` (para el <video>): de la FILA `ad_variant` por REST (`variantActions.get`),
//     porque el artefacto de N9 NO lo lleva (solo `{variantId, passed, qaReport}`).
//   · el `qaReport` (los 8 checks + score): del ARTEFACTO de N9 por `getStep` (el `outputExcerpt` del
//     SSE va recortado a 200 caracteres), validado con `QaReportSchema` en la frontera del cliente.
import { useEffect, useState } from 'react';
import type { QaChecks, QaReport } from '@ugc/core/contracts';
import { N9OutputSchema, QaReportSchema } from '@ugc/core/contracts';
import { ApiError, runActions, variantActions, type VariantResponse } from '@/lib/api-client';
import type { QaCheckpointStep } from './use-qa-checkpoints';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricsTable } from '@/components/ui/metrics-table';
import { Tabs } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { SafeZoneFrame, type SafeZonePreset } from '@/components/ui/safe-zone-overlay';

export interface QaPanelProps {
  /** Los steps N9 pausados del run (una variante cada uno). Los provee `useQaCheckpoints`. */
  steps: QaCheckpointStep[];
}

/** El conmutador de safe zones. `off` = sin overlay (ver el frame limpio). El orden ES el de las
 *  tabs (el índice que emite `Tabs.onChange` indexa esta lista). */
const PRESET_TABS: { label: string; preset: SafeZonePreset }[] = [
  { label: 'Universal', preset: 'universal' },
  { label: 'TikTok', preset: 'tiktok' },
  { label: 'Meta', preset: 'meta' },
  { label: 'Sin overlay', preset: 'off' },
];

/** Etiqueta legible de cada uno de los 8 checks del `qa_report` (las claves son contrato, §9.7 N9). */
const CHECK_LABEL: Record<keyof QaChecks, string> = {
  resolution: 'Resolución (1080×1920)',
  fps: 'FPS (30)',
  codec: 'Códec (H.264 / yuv420p)',
  duration: 'Duración',
  loudness: 'Loudness (−14 LUFS)',
  av_duration_diff: 'Sincronía A/V',
  captions_safe_zone: 'Subtítulos en safe zone',
  filesize: 'Tamaño (≤ 500 MB)',
};

const CHECK_ORDER: (keyof QaChecks)[] = [
  'resolution',
  'fps',
  'codec',
  'duration',
  'loudness',
  'av_duration_diff',
  'captions_safe_zone',
  'filesize',
];

/** Lo que el panel carga para la variante seleccionada: su fila (máster + identidad) y su `qaReport`
 *  (del artefacto de N9). `null` mientras carga; el `error` lo separa del "aún no". */
interface VariantDetail {
  variant: VariantResponse;
  qaReport: QaReport;
}

export function QaPanel({ steps }: QaPanelProps) {
  // La variante que el usuario PIDIÓ ver (por `stepId`, identidad estable del N9). `null` = "aún no
  // ha elegido" ⇒ se usa la primera de la lista. Se guarda solo la elección explícita; la selección
  // EFECTIVA se DERIVA en el render (no por un effect que resetee estado — eso dispara renders en
  // cascada, que el linter veta): así, cuando la elegida se resuelve y sale de la lista, la selección
  // efectiva cae sola a la primera que quede sin necesidad de sincronizar estado.
  const [pickedStepId, setPickedStepId] = useState<string | null>(null);

  const selectedStep = steps.find((s) => s.stepId === pickedStepId) ?? steps[0];

  if (steps.length === 0 || selectedStep === undefined) {
    // No debería montarse sin pausados (run-shell no lo abre), pero si la última se resuelve entre
    // renders, un estado limpio es mejor que un panel con datos huérfanos.
    return (
      <div
        data-slot="qa-panel"
        className="flex min-h-0 flex-1 items-center justify-center bg-bg p-6"
      >
        <EmptyState
          title="Sin variantes por revisar"
          description="Todas las variantes de este lote se han resuelto."
        />
      </div>
    );
  }

  return (
    <div
      data-slot="qa-panel"
      aria-label="Revisión de variantes (CP4)"
      className="flex min-h-0 flex-1 bg-bg"
    >
      {/* IZQUIERDA · la lista de variantes que esperan revisión (patrón tarjetas-por-variante). */}
      <aside
        data-slot="qa-variant-list"
        className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-subtle"
      >
        <div className="border-b border-border px-4 py-4">
          <div className="mb-1 font-mono text-micro font-semibold tracking-widest text-warning">
            ◆ CP4 · REVISIÓN
          </div>
          <p className="text-mono text-text-3">
            <span className="font-mono text-text-2">{steps.length}</span>{' '}
            {steps.length === 1 ? 'variante' : 'variantes'} por revisar
          </p>
        </div>
        <ul className="flex flex-col gap-1.5 p-2.5">
          {steps.map((s) => (
            <li key={s.stepId}>
              <VariantListItem
                step={s}
                selected={s.stepId === selectedStep.stepId}
                onSelect={() => {
                  setPickedStepId(s.stepId);
                }}
              />
            </li>
          ))}
        </ul>
      </aside>

      {/* CENTRO + DERECHA: el detalle de la variante seleccionada. `key` para que el estado interno
          (preset del overlay, carga) se REINICIE al cambiar de variante. */}
      <VariantReview key={selectedStep.stepId} step={selectedStep} />
    </div>
  );
}

/** Una tarjeta de la lista izquierda: la identidad de la variante (se pide su fila por REST para el
 *  `filename_code` legible) y si está seleccionada. */
function VariantListItem({
  step,
  selected,
  onSelect,
}: {
  step: QaCheckpointStep;
  selected: boolean;
  onSelect: () => void;
}) {
  const [variant, setVariant] = useState<VariantResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    variantActions
      .get(step.variantId)
      .then((v) => {
        if (!cancelled) setVariant(v);
      })
      .catch(() => {
        // La tarjeta cae a mostrar el id de variante: degradar es mejor que romper la lista.
      });
    return () => {
      cancelled = true;
    };
  }, [step.variantId]);

  return (
    <button
      type="button"
      data-slot="qa-variant-item"
      data-variant-id={step.variantId}
      data-step-id={step.stepId}
      data-selected={selected}
      aria-current={selected}
      onClick={onSelect}
      className={
        selected
          ? 'w-full rounded-md border border-accent-border bg-accent-soft px-3 py-2.5 text-left'
          : 'w-full rounded-md border border-border bg-surface px-3 py-2.5 text-left hover:border-border-strong'
      }
    >
      <div className="truncate text-mono font-medium text-text">
        {variant?.angleName ?? 'Variante'}
      </div>
      <div className="mt-0.5 truncate font-mono text-micro text-accent">
        {variant?.filenameCode ?? step.variantId}
      </div>
    </button>
  );
}

/** El detalle de UNA variante: player + overlay de safe zones (centro) y resultados de QA +
 *  aprobar/rechazar (derecha). Carga su fila (máster) y su `qaReport` (artefacto de N9) al montar. */
function VariantReview({ step }: { step: QaCheckpointStep }) {
  const [detail, setDetail] = useState<VariantDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState<SafeZonePreset>('universal');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // `VariantReview` se REMONTA al cambiar de variante (`key={selectedStepId}` en el padre), así que
  // `detail`/`loadError` ya arrancan limpios en cada montaje — no hace falta resetearlos aquí (y
  // hacerlo síncronamente en el effect dispararía renders en cascada, que el linter veta).
  useEffect(() => {
    let cancelled = false;
    Promise.all([variantActions.get(step.variantId), runActions.getStep(step.stepId)])
      .then(([variant, stepDetail]) => {
        if (cancelled) return;
        // El artefacto de N9 es `unknown` en su frontera (patrón N3/N4): se valida con su schema, y
        // el `qaReport` de dentro con `QaReportSchema` — el veredicto que el humano resuelve viene
        // de aquí, no de la columna `ad_variant.qa_report`.
        const parsed = N9OutputSchema.safeParse(stepDetail.outputRefs);
        if (!parsed.success) {
          setLoadError('El artefacto de QA no tiene la forma esperada.');
          return;
        }
        const qa = QaReportSchema.safeParse(parsed.data.qaReport);
        if (!qa.success) {
          setLoadError('El informe de QA no se pudo leer.');
          return;
        }
        setDetail({ variant, qaReport: qa.data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(e instanceof ApiError ? e.message : 'No se pudo cargar la variante.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [step.stepId, step.variantId]);

  /** Aprobar/rechazar: op PLANA (sin `decision`). El estado nuevo llega por SSE ⇒ la variante sale de
   *  la lista sola (sin optimistic update). Solo se captura el fallo para dar feedback. */
  async function resolve(action: 'approve' | 'reject') {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (action === 'approve') await runActions.approve(step.stepId);
      else await runActions.reject(step.stepId);
      // El step deja `waiting_approval` por SSE ⇒ `QaPanel` re-encaja la selección. No hay estado
      // local que limpiar.
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : 'No se pudo guardar la decisión.');
      setSubmitting(false);
    }
  }

  if (loadError !== null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p role="alert" data-slot="qa-load-error" className="text-mono text-danger">
          {loadError}
        </p>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-mono text-text-3">Cargando variante…</p>
      </div>
    );
  }

  const { variant, qaReport } = detail;

  return (
    <div
      data-slot="qa-variant-review"
      data-variant-id={variant.id}
      data-step-id={step.stepId}
      className="flex min-h-0 flex-1 overflow-hidden"
    >
      {/* CENTRO · el player + el conmutador de safe zones. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="mb-4">
          <h2 className="text-h3 font-semibold text-text" data-slot="qa-variant-title">
            {variant.angleName}
          </h2>
          <p className="mt-0.5 font-mono text-micro text-accent">{variant.filenameCode}</p>
        </div>

        <Tabs
          tabs={PRESET_TABS.map((t) => t.label)}
          onChange={(index) => {
            const next = PRESET_TABS[index];
            if (next) setPreset(next.preset);
          }}
          className="mb-4"
        />

        {/* El <video> CRUDO (superficie DS-exenta, precedente AssetMedia): no hay primitiva "media
            player" en el DS. El overlay de safe zones va TRANSPARENTE encima (SafeZoneFrame, sin
            hatch ni scrim → no tapa el vídeo). El contenedor es `relative` + 9:16 para que el frame
            lo llene. Si la variante no tiene máster, no hay src que reproducir. */}
        {variant.masterAssetId !== null ? (
          <div
            data-slot="qa-player"
            className="relative mx-auto aspect-9/16 w-full max-w-80 overflow-hidden rounded-lg border border-border-2 bg-black"
          >
            <video
              data-slot="qa-video"
              src={`/api/assets/${variant.masterAssetId}/download`}
              controls
              preload="metadata"
              className="h-full w-full"
            />
            <SafeZoneFrame preset={preset} data-slot="qa-safe-zone" />
          </div>
        ) : (
          <Alert tone="warning" data-slot="qa-no-master">
            Esta variante no tiene máster para reproducir.
          </Alert>
        )}
      </div>

      {/* DERECHA · resultados de QA + acciones. */}
      <aside
        data-slot="qa-results"
        className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border bg-bg-subtle"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-mono font-semibold text-text">Resultados de QA</h3>
          <div className="flex items-center gap-2">
            <Badge tone={qaReport.passed ? 'success' : 'danger'} mono data-slot="qa-verdict">
              {qaReport.passed ? '✓ Apto' : '✕ No apto'}
            </Badge>
            <Badge tone="neutral" mono data-slot="qa-score">
              {qaReport.score}/100
            </Badge>
          </div>
        </div>

        <div className="p-5" data-slot="qa-checks">
          <MetricsTable
            columns={[
              { key: 'check', label: 'Check', width: '2fr' },
              { key: 'verdict', label: 'Resultado', align: 'right', width: '1fr' },
            ]}
            rows={CHECK_ORDER.map((key) => ({
              check: CHECK_LABEL[key],
              verdict: qaReport.checks[key],
              // El key crudo va en un campo oculto para que el e2e localice la fila por check.
              _key: key,
            }))}
            renderCell={(row, col) => {
              if (col.key !== 'verdict') return row[col.key];
              const pass = row.verdict === 'pass';
              return (
                <Badge
                  tone={pass ? 'success' : 'danger'}
                  mono
                  data-slot="qa-check"
                  data-check={row._key}
                  data-verdict={row.verdict}
                >
                  {pass ? '✓ pass' : '✕ fail'}
                </Badge>
              );
            }}
          />
        </div>

        {/* ACCIONES · aprobar (verde) / rechazar (rojo, con confirmación destructiva por AlertDialog).
            Sticky abajo: siempre a la vista mientras se recorre el QA. */}
        <div className="sticky bottom-0 mt-auto flex flex-col gap-3 border-t border-border bg-surface px-5 py-4">
          {submitError !== null ? (
            <p role="alert" data-slot="qa-error" className="text-mono text-danger">
              {submitError}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            {/* RECHAZAR → confirmación (rechazo es destructivo: la variante pasa a `rejected`). */}
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="danger"
                    disabled={submitting}
                    data-slot="reject-variant"
                    className="flex-1"
                  />
                }
              >
                Rechazar
              </AlertDialogTrigger>
              <AlertDialogPopup>
                <AlertDialogTitle>¿Rechazar esta variante?</AlertDialogTitle>
                <AlertDialogDescription>
                  La variante <span className="font-mono">{variant.filenameCode}</span> pasará a{' '}
                  <span className="font-mono">rechazada</span> y su máster se descartará. Esta
                  acción no se puede deshacer aquí.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button type="button" variant="secondary" size="sm" />}>
                    Cancelar
                  </AlertDialogClose>
                  <AlertDialogClose
                    render={
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        data-slot="confirm-reject"
                        onClick={() => void resolve('reject')}
                      />
                    }
                  >
                    Rechazar variante
                  </AlertDialogClose>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>

            {/* APROBAR → directo (aprobar no es destructivo). Verde como en scripts-panel. */}
            <Button
              type="button"
              variant="primary"
              disabled={submitting}
              data-slot="approve-variant"
              onClick={() => void resolve('approve')}
              className="flex-1 border-success bg-success text-success-on hover:border-success hover:bg-success focus-visible:border-success"
            >
              {submitting ? 'Guardando…' : 'Aprobar'}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
