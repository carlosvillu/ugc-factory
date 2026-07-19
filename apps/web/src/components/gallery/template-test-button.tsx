'use client';

// BOTÓN «PROBAR TEMPLATE» (T4.12): genera una IMAGEN DE PRUEBA barata de un template desde la ficha,
// ANTES de comprometer un run, y la muestra con su coste. Solo para templates `kind:'image'` (el padre
// decide cuándo pintarlo; el servidor rechaza los de vídeo con `validation_error`).
//
// DS: el disparador es la primitiva `Button` con estado `loading`. La imagen resultante usa la primitiva
// `Image` del DS (que SÍ existe para imágenes y gestiona carga/error), apuntando al
// `GET /api/assets/:id/download` existente. El coste se pinta con las clases de token.
//
// CACHÉ: la primera prueba llama a `POST /api/templates/:id/test` (genera o reutiliza en el servidor) y
// memoiza `{assetId, costCents}`; volver a pulsar re-llama (el servidor hace cache-hit, 0 coste). El id
// depende del template: cambiar de template es OTRA ficha (React remonta por `key`).
import { useState } from 'react';
import { ApiError, templateActions } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Image } from '@/components/ui/image';
import { formatCost } from '@/lib/money';

export function TemplateTestButton({ templateId }: { templateId: string }) {
  // `assetId`/`costCents`/`cached` viajan SIEMPRE juntos (salen de una sola respuesta), así que son un
  // único slot `result`. `loading` y `error` sí son independientes (como en voice-preview-button).
  const [result, setResult] = useState<{
    assetId: string;
    costCents: number;
    cached: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runTest(): Promise<void> {
    setError(null);
    setLoading(true);
    try {
      setResult(await templateActions.test(templateId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo generar la imagen de prueba.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-slot="template-test">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={loading}
          data-slot="template-test-button"
          onClick={() => {
            void runTest();
          }}
        >
          Probar template
        </Button>
        {result !== null ? (
          <span className="text-micro text-text-3" data-slot="template-test-cost">
            Coste: {formatCost(result.costCents)}
            {result.cached ? ' (reutilizado)' : ''}
          </span>
        ) : null}
      </div>
      {error !== null ? (
        <span role="alert" className="text-micro text-danger" data-slot="template-test-error">
          {error}
        </span>
      ) : null}
      {result !== null ? (
        // La primitiva `Image` del DS (no un `<img>` crudo): gestiona el estado de carga/error de la
        // imagen generada de primera clase (un `download` que falle pinta "no disponible", no un glyph
        // roto). El `data-slot` va en el WRAPPER porque `Image` fija su propio `data-slot="image"`; el
        // `ratio="9/16"` reserva la altura del frame (portrait_16_9) antes de la carga. Mismo patrón que
        // step-asset-preview.tsx.
        <div className="max-w-xs" data-slot="template-test-image">
          <Image
            src={`/api/assets/${result.assetId}/download`}
            alt="Imagen de prueba del template"
            ratio="9/16"
            radius="md"
            className="w-full"
          />
        </div>
      ) : null}
    </div>
  );
}
