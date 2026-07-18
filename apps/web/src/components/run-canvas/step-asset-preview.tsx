'use client';

// PREVIEW DE ASSETS de un sub-step del sub-DAG de generación (N6→N7) en el inspector (T4.11).
// Es la parte «rica» del panel para los nodos de generación: el `resolvedPrompt` de N6 y los
// players/thumbnails por asset de N7a–N7e.
//
// POR QUÉ HACE SU PROPIO FETCH: el panel pinta `outputExcerpt`, que el servidor TRUNCA a 200
// caracteres (steps.repo.ts) — de ahí no se pueden extraer los `assetId` de forma fiable. Este
// componente pide el `output_refs` COMPLETO a `GET /api/steps/:id` (mismo endpoint que
// `StepArtifactDialog`) y de ahí saca el prompt y los assets (`stepAssetsView`, pura).
//
// DS: no hay primitiva «media player» en el design system (y el brief lo prohíbe explícitamente:
// esto NO es un componente player reutilizable). La reproducción usa `<video>/<audio>` CRUDO —
// superficie legítima, mismo precedente que `voice-preview-button.tsx` (`new Audio()` crudo) — y la
// imagen usa la primitiva `Image` del DS (que SÍ existe y gestiona su estado de carga/error). El
// `src` apunta al `GET /api/assets/:id/download` existente. Los contenedores son divs de layout.
import { useEffect, useState } from 'react';
import { Image } from '@/components/ui/image';
import { ApiError, runActions } from '@/lib/api-client';
import { stepAssetsView, type StepAsset } from './step-assets';

type Load =
  | { phase: 'loading' }
  | { phase: 'loaded'; output: unknown }
  | { phase: 'failed'; message: string };

/** La URL de descarga proxificada de un asset (el mismo endpoint que usa el preview de voz). */
function assetUrl(assetId: string): string {
  return `/api/assets/${assetId}/download`;
}

export function StepAssetPreview({ stepId, nodeKey }: { stepId: string; nodeKey: string }) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const step = await runActions.getStep(stepId);
        if (ac.signal.aborted) return;
        setLoad({ phase: 'loaded', output: step.outputRefs });
      } catch (e) {
        if (!ac.signal.aborted) {
          setLoad({
            phase: 'failed',
            message: e instanceof ApiError ? e.message : 'No se pudo cargar el artefacto',
          });
        }
      }
    })();
    return () => {
      ac.abort();
    };
  }, [stepId]);

  if (load.phase === 'loading') {
    return (
      <p role="status" className="text-mono text-text-3" data-slot="assets-loading">
        Cargando el artefacto…
      </p>
    );
  }
  if (load.phase === 'failed') {
    return (
      <p role="alert" className="text-mono text-danger" data-slot="assets-error">
        {load.message}
      </p>
    );
  }

  const view = stepAssetsView(nodeKey, load.output);
  if (view.resolvedPrompt === null && view.assets.length === 0) return null;

  return (
    <div className="flex flex-col gap-4" data-slot="step-assets">
      {view.resolvedPrompt !== null ? (
        <section aria-label="Prompt resuelto" data-slot="resolved-prompt">
          <div className="mb-1.5 font-mono text-micro font-semibold tracking-wide text-text-3">
            PROMPT RESUELTO
          </div>
          <pre className="overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-micro whitespace-pre-wrap break-words text-text-2">
            {view.resolvedPrompt}
          </pre>
        </section>
      ) : null}

      {view.assets.length > 0 ? (
        <section aria-label="Assets generados" data-slot="generated-assets">
          <div className="mb-1.5 font-mono text-micro font-semibold tracking-wide text-text-3">
            ASSETS ({view.assets.length})
          </div>
          <ul className="flex flex-col gap-3">
            {view.assets.map((asset) => (
              <li key={asset.assetId} data-slot="asset-item" data-media-kind={asset.mediaKind}>
                <AssetMedia asset={asset} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** El elemento de media adecuado al tipo del asset. Vídeo/audio son `<video>/<audio>` CRUDOS con
 *  `controls` (precedente voice-preview); la imagen usa la primitiva `Image` del DS. */
function AssetMedia({ asset }: { asset: StepAsset }) {
  const src = assetUrl(asset.assetId);
  if (asset.mediaKind === 'video') {
    return (
      <video
        data-slot="asset-video"
        src={src}
        controls
        preload="metadata"
        className="w-full rounded-md border border-border bg-black"
      />
    );
  }
  if (asset.mediaKind === 'audio') {
    return (
      <audio data-slot="asset-audio" src={src} controls preload="metadata" className="w-full" />
    );
  }
  return <Image src={src} alt={`Asset ${asset.assetId}`} radius="md" className="w-full" />;
}
