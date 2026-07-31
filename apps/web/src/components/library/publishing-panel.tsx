'use client';

// PANEL DE PUBLICACIÓN (T6.2, §15.4 / §preámbulo F6) — vive en el detalle de una variante aprobada de
// `/library`, bajo la descarga del bundle. Tres bloques:
//   · CHECKLIST de compliance por plataforma (§15.4), MARCABLE: cada ítem es un Checkbox del DS cuyo estado
//     se persiste (`publishingActions.markItem`). Incluye el aviso de RESET del toggle AIGC al duplicar
//     campañas (§15.4, ítem `tiktok_duplicate_recheck` — reusado del bundle, no un aviso nuevo).
//   · OPCIÓN SPARK: un botón/afordance que se OFRECE (`ai_bed`) o se BLOQUEA con explicación
//     (`native_trending`, §14 pt 2). Ambas ramas son observables en el MISMO slot (`spark-option`).
//   · CP5 (checkpoint OPCIONAL del flujo de publicación en modo degradado manual): un Switch que activa el
//     checkpoint + los controles del flujo (iniciar → con CP5 PAUSA en confirmación → confirmar reanuda).
//
// El estado vive en un solo objeto `PublishingState` que cada mutación DEVUELVE completo (la UI no
// re-consulta): marcar un ítem, togglear CP5 o mover el flujo re-setean el estado con la respuesta.
import { useEffect, useState } from 'react';
import { ApiError, publishingActions, type PublishingState } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';

const PLATFORM_LABEL: Record<string, string> = {
  all: 'Ambas',
  tiktok: 'TikTok',
  meta: 'Meta',
};

const FLOW_LABEL: Record<PublishingState['flowState'], string> = {
  ready: 'Listo para publicar',
  waiting_confirmation: 'Pausado en CP5 — esperando confirmación',
  confirmed: 'Confirmado — sube el vídeo siguiendo el checklist',
};

export function PublishingPanel({ variantId }: { variantId: string }) {
  const [state, setState] = useState<PublishingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publishingActions
      .get(variantId)
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(
            e instanceof ApiError ? e.message : 'No se pudo cargar el estado de publicación.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [variantId]);

  // Cada mutación DEVUELVE el estado completo → se re-setea. Un fallo se surfacea sin romper el estado actual.
  async function run(op: () => Promise<PublishingState>) {
    setActionError(null);
    setBusy(true);
    try {
      setState(await op());
    } catch (e: unknown) {
      setActionError(e instanceof ApiError ? e.message : 'No se pudo aplicar el cambio.');
    } finally {
      setBusy(false);
    }
  }

  if (loadError !== null) {
    return (
      <div className="mt-6" data-slot="publishing-panel">
        <Alert tone="danger" data-slot="publishing-load-error">
          {loadError}
        </Alert>
      </div>
    );
  }
  if (state === null) {
    return (
      <div className="mt-6" data-slot="publishing-panel">
        <p className="text-mono text-text-3">Cargando publicación…</p>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6" data-slot="publishing-panel">
      <div>
        <div className="mb-3 font-mono text-micro font-semibold tracking-widest text-text-3">
          CHECKLIST DE PUBLICACIÓN (§15.4)
        </div>
        <ul className="flex flex-col gap-2.5" data-slot="publishing-checklist">
          {state.checklist.map((item) => (
            <li key={item.id} data-slot="checklist-item">
              {/* La etiqueta es el CONTENIDO del control (el botón ES la fila entera, patrón del DS): así el
                  control conserva su caja aunque el ✓ del indicador solo se monte al marcar — un checkbox
                  con solo el indicador aria-hidden colapsa a 0px sin texto. Los badges son spans no
                  interactivos, seguros dentro del label. */}
              <Checkbox
                checked={item.done}
                disabled={busy}
                data-slot="checklist-checkbox"
                data-item-id={item.id}
                data-done={item.done}
                className="items-start"
                onCheckedChange={(checked) => {
                  void run(() => publishingActions.markItem(variantId, item.id, checked));
                }}
                label={
                  <span className="min-w-0 text-mono">
                    <span>{item.label}</span>{' '}
                    <Badge tone={item.required ? 'danger' : 'neutral'} mono>
                      {item.required ? 'obligatorio' : 'opcional'}
                    </Badge>{' '}
                    <span className="font-mono text-micro text-text-3">
                      {PLATFORM_LABEL[item.platform] ?? item.platform}
                    </span>
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </div>

      {/* OPCIÓN SPARK (§14 pt 2): se OFRECE o se BLOQUEA con explicación, según audio_source. Ambas ramas en
          el MISMO slot para que el control negativo (revertir la regla → Spark ofrecido para native_trending)
          sea observable. */}
      <div data-slot="spark-section">
        <div className="mb-2 font-mono text-micro font-semibold tracking-widest text-text-3">
          SPARK AD (orgánico → promocionado)
        </div>
        <Button
          variant="primary"
          data-slot="spark-option"
          data-allowed={state.spark.allowed}
          disabled={!state.spark.allowed}
          aria-disabled={!state.spark.allowed}
        >
          Generar Spark code
        </Button>
        {!state.spark.allowed && state.spark.reason !== undefined ? (
          <div className="mt-2">
            <Alert tone="warning" data-slot="spark-blocked-reason">
              {state.spark.reason}
            </Alert>
          </div>
        ) : null}
      </div>

      {/* CP5 · el checkpoint OPCIONAL del flujo de publicación en modo degradado manual (§preámbulo F6). */}
      <div data-slot="cp5-section">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-micro font-semibold tracking-widest text-text-3">
            CP5 · CONFIRMAR PUBLICACIÓN
          </span>
          <label className="flex items-center gap-2 text-mono text-text-2">
            <span>Pedir confirmación</span>
            <Switch
              checked={state.cp5Enabled}
              disabled={busy}
              data-slot="cp5-toggle"
              data-enabled={state.cp5Enabled}
              onCheckedChange={(checked) => {
                void run(() => publishingActions.toggleCp5(variantId, checked));
              }}
            />
          </label>
        </div>

        <div
          className="rounded-md border border-border bg-surface p-3"
          data-slot="cp5-flow"
          data-flow-state={state.flowState}
        >
          <p className="text-mono text-text-2" data-slot="cp5-flow-label">
            {FLOW_LABEL[state.flowState]}
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {state.flowState === 'ready' ? (
              <Button
                variant="primary"
                data-slot="cp5-start"
                disabled={busy}
                onClick={() => {
                  void run(() => publishingActions.flow(variantId, 'start'));
                }}
              >
                Iniciar publicación
              </Button>
            ) : null}
            {state.flowState === 'waiting_confirmation' ? (
              <Button
                variant="primary"
                data-slot="cp5-confirm"
                disabled={busy}
                onClick={() => {
                  void run(() => publishingActions.flow(variantId, 'confirm'));
                }}
              >
                Confirmar y reanudar
              </Button>
            ) : null}
            {state.flowState !== 'ready' ? (
              <Button
                variant="secondary"
                data-slot="cp5-reopen"
                disabled={busy}
                onClick={() => {
                  void run(() => publishingActions.flow(variantId, 'reopen'));
                }}
              >
                Reabrir
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {actionError !== null ? (
        <Alert tone="danger" data-slot="publishing-action-error">
          {actionError}
        </Alert>
      ) : null}
    </div>
  );
}
