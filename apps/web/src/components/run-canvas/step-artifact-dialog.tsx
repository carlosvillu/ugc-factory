'use client';

// Modal del artefacto de un step (T1.16): el visor GRANDE del output y del error, que la
// caja del inspector abre al clicarla.
//
// EL PROBLEMA QUE RESUELVE (y por qué no era solo CSS): el panel pinta `outputExcerpt` /
// `errorExcerpt`, y esa proyección la TRUNCA EL SERVIDOR a 200 caracteres a propósito
// (steps.repo.ts, `OUTPUT_EXCERPT_MAX`: un jsonb de KB no cabe en un frame SSE). Agrandar la
// caja no habría enseñado ni un carácter más: el resto del dato NO ESTÁ en el cliente.
//
// LOS DOS visores piden el dato COMPLETO al MISMO endpoint (`GET /api/steps/:id`), que desde
// T1.16 devuelve `output_refs` Y `error` enteros (la lectura de presentación `findStepDetail`
// del repo; el puerto `StepRow` del orquestador sigue sin saber nada del error). "Mismo trato
// para el visor de error" es misma COMPLETITUD, no solo el mismo marco de modal — y el error
// es donde más importa: un `PermanentStepError` de N3 arrastra el volcado de issues de Zod
// (varios KB), y cortado a 200 caracteres el usuario ve el prefijo y CERO issues.
//
// La única diferencia entre ambos: el output se tokeniza como JSON (`JsonViewer`); el error es
// TEXTO (un mensaje/stack no es JSON y pretender que lo es solo lo afea).
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, runActions } from '@/lib/api-client';
import { formatJson } from './json-highlight';
import { JsonViewer } from './json-viewer';
import { nodeTitle } from './node-titles';

type Kind = 'output' | 'error';

interface StepArtifactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Kind;
  stepId: string;
  nodeKey: string;
  /** El recorte que YA se tiene (del SSE): se pinta mientras llega el completo, y es a lo que
   *  se cae si la carga falla. El usuario nunca ve una modal vacía. */
  fallback: string;
}

// Estado de la carga del dato completo. Un único objeto (no tres `useState` sueltos): los
// valores cambian SIEMPRE juntos y separados producirían estados imposibles (cargando Y con
// error a la vez).
type Load =
  { phase: 'loading' } | { phase: 'loaded'; text: string } | { phase: 'failed'; message: string };

export function StepArtifactDialog({
  open,
  onOpenChange,
  kind,
  stepId,
  nodeKey,
  fallback,
}: StepArtifactDialogProps) {
  const isOutput = kind === 'output';
  // El componente se MONTA al abrir la modal (el panel lo renderiza condicionalmente), así
  // que el estado inicial ya es el correcto y el efecto no tiene que "resetear" nada — que es
  // lo que provoca renders en cascada (y lo que el lint prohíbe con razón).
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [copyState, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');

  useEffect(() => {
    // El guard de "ya no me importa la respuesta" es un AbortController y no un `let
    // cancelled` de closure: es el mecanismo estándar (y el linter no puede razonar sobre la
    // mutación de una variable capturada, así que el flag booleano le parece constante).
    const ac = new AbortController();
    void (async () => {
      try {
        const step = await runActions.getStep(stepId);
        if (ac.signal.aborted) return;
        // El error viaja ya PELADO del servidor (el `message`, no el `{message}`), mismo
        // criterio que el recorte del SSE. Un step que falló SIN error persistido cae al
        // recorte (no debería pasar; no se inventa un hueco vacío).
        const text = isOutput ? formatJson(step.outputRefs) : (step.error ?? fallback);
        setLoad({ phase: 'loaded', text });
      } catch (e) {
        if (!ac.signal.aborted) {
          setLoad({
            phase: 'failed',
            message: e instanceof ApiError ? e.message : 'No se pudo cargar el dato completo',
          });
        }
      }
    })();
    return () => {
      ac.abort();
    };
    // `fallback` no entra en las deps: es el valor del recorte con el que se montó la modal
    // (inmutable para esta apertura) y meterlo re-dispararía el fetch en cada delta SSE.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOutput, stepId]);

  // Mientras el fetch vuela (o si falla), se pinta el recorte que ya se tenía.
  const body = load.phase === 'loaded' ? load.text : isOutput ? formatJson(fallback) : fallback;

  // El copiado puede fallar (permiso de portapapeles denegado, contexto no seguro): se DICE,
  // no se traga en silencio — un botón que no hace nada y no explica nada es peor que un error.
  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopy('done');
    } catch {
      setCopy('failed');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        // La modal es GRANDE (un brief entero no se lee en 28rem) y de alto acotado: el cuerpo
        // scrollea dentro, la modal no crece con el payload. El alto máximo es la utilidad
        // `artifact-dialog` del DS (globals.css): el valor crudo no vive en un className
        // arbitrario.
        className="artifact-dialog w-full max-w-3xl"
        data-slot={isOutput ? 'output-dialog' : 'error-dialog'}
        // El pie es el dueño del cierre (el caso que `hideClose` documenta): con la ✕ de la
        // esquina habría DOS botones "Cerrar" con el mismo accessible name — ambigüedad para
        // el lector de pantalla (y para los tests). El Escape sigue cerrando (Base UI).
        hideClose
      >
        <DialogTitle>
          {isOutput ? 'Output de' : 'Error de'} {nodeTitle(nodeKey)}
        </DialogTitle>
        <DialogDescription className="flex items-center gap-2">
          <Badge mono tone={isOutput ? 'neutral' : 'danger'}>
            {nodeKey}
          </Badge>
          <span>
            {isOutput
              ? 'Artefacto completo del paso (JSON).'
              : 'Mensaje de error completo del executor.'}
          </span>
        </DialogDescription>

        {load.phase === 'loading' ? (
          <p role="status" className="text-mono text-text-3" data-slot="artifact-loading">
            Cargando el dato completo…
          </p>
        ) : null}
        {load.phase === 'failed' ? (
          <p role="alert" className="text-mono text-danger" data-slot="artifact-error">
            {load.message}
          </p>
        ) : null}

        {isOutput ? (
          <JsonViewer
            formatted={body}
            className="min-h-40 flex-1 overflow-auto rounded-md border border-border bg-surface-2 p-4 font-mono text-micro whitespace-pre"
          />
        ) : (
          <pre
            tabIndex={0}
            data-slot="error-text"
            className="min-h-40 flex-1 overflow-auto rounded-md border border-danger-border bg-danger-soft p-4 font-mono text-micro whitespace-pre-wrap break-words text-text"
          >
            {body}
          </pre>
        )}

        <DialogFooter>
          {copyState === 'done' ? (
            <span role="status" className="mr-auto text-mono text-success">
              Copiado
            </span>
          ) : null}
          {copyState === 'failed' ? (
            <span role="alert" className="mr-auto text-mono text-danger">
              No se pudo copiar al portapapeles
            </span>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => void copy()}>
            Copiar
          </Button>
          <DialogClose render={<Button size="sm" variant="ghost" />}>Cerrar</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
