'use client';

// ¿EL CHECKPOINT QUE ESTÁ PAUSADO ES UN BRIEF? (T1.10b)
//
// La pregunta parece trivial y no lo es. Un run puede pausar en CUALQUIER checkpoint —los de demo
// de F0 no producen brief, y F2–F4 traerán CP2/CP3 con sus propios artefactos—, y solo el
// checkpoint del BRIEF debe abrir el editor de CP1. Elegir mal tiene dos formas de romperse:
//
//   - Discriminar por `node_key` ('N3') es el ANTI-PATRÓN que T1.10a extirpó del worker:
//     `node_key` NO identifica una fila dentro de un run (el supersede de T0.8 crea filas NUEVAS
//     con el MISMO node_key), así que un `.find()` por clave puede devolver cualquiera de ellas.
//   - Discriminar solo por `isCheckpoint` es demasiado ANCHO: los checkpoints de demo también lo
//     son, y CP1 les secuestraría el panel genérico (nos lo cazaron 5 specs de F0).
//
// Lo que de verdad decide es la FORMA DEL ARTEFACTO — igual que en el servidor
// (`server/brief-checkpoint.ts`, que se discrimina con el MISMO `N3OutputSchema`). Y esa forma no
// está en el store: el SSE solo transporta un `outputExcerpt` RECORTADO a 200 caracteres (T0.10),
// que no basta ni para parsear ni —desde luego— para editar. Así que la discriminación ocurre AQUÍ:
// tras pedir el step ENTERO por REST.
//
// POR QUÉ NO SE AÑADE UN CAMPO "TIPO DE CHECKPOINT" A LA PROYECCIÓN SSE (que sería la alternativa
// obvia): `readChangedSteps` relee TODOS los steps del run en CADA NOTIFY. Meter ahí un
// discriminante por step —sea un `checkpoint_config.editor` o un `safeParse` del artefacto—
// pondría esa detección en el camino MÁS CALIENTE del sistema, para cada nodo y para siempre, al
// servicio de una decisión que solo importa cuando un checkpoint PAUSA (raro). Se paga cuando se
// usa, no en cada evento. Es el mismo criterio con el que `cost_actual` se resolvió como rollup y
// no como derivada en lectura.
//
// CONTRATO DEL HOOK: mientras no haya CONFIRMACIÓN de que el artefacto es un brief, devuelve
// `null` — y el llamante se queda con el panel genérico. O sea: en la duda, NO se secuestra la UI
// de nadie. Solo un brief confirmado abre CP1.
import { useEffect, useState } from 'react';
import {
  BriefWarningSchema,
  N3OutputSchema,
  ProductBriefSchema,
  type BriefWarning,
  type ProductBrief,
} from '@ugc/core/contracts';
import { runActions } from '@/lib/api-client';
import { useRunStore } from '@/stores/run-store';

export interface BriefCheckpoint {
  /** El step de CP1 (el que hay que aprobar/editar). */
  stepId: string;
  /** La FILA del brief (`product_brief.id`) que N3 persistió: la fuente de verdad versionada. */
  briefId: string;
  brief: ProductBrief;
  warnings: BriefWarning[];
}

/**
 * Parsea el `output_refs` de N3 al par (brief, warnings) que CP1 necesita. `null` si el artefacto
 * NO es un brief — que es justo la señal que distingue un checkpoint de brief de cualquier otro.
 *
 * Los warnings se parsean UNO A UNO y los que no casan con `BriefWarningSchema` se DESCARTAN, en
 * vez de tirar el lote: `N3Output.warnings` es una lista MIXTA a propósito (los del sintetizador
 * son `string`; los del validador T1.9 son objetos tipados — el executor los acumula sin pisarse).
 * Un `parse` estricto del array entero fallaría siempre.
 */
function parseBriefArtifact(outputRefs: unknown): Omit<BriefCheckpoint, 'stepId'> | null {
  const output = N3OutputSchema.safeParse(outputRefs);
  if (!output.success) return null;
  const brief = ProductBriefSchema.safeParse(output.data.brief);
  if (!brief.success) return null;

  const warnings: BriefWarning[] = [];
  for (const raw of output.data.warnings) {
    const parsed = BriefWarningSchema.safeParse(raw);
    if (parsed.success) warnings.push(parsed.data);
  }
  return { briefId: output.data.briefId, brief: brief.data, warnings };
}

/** El primer checkpoint PAUSADO del run, si lo hay. Es solo el CANDIDATO: que sea un brief lo
 *  decide el artefacto, no esto. Se ordena por id para que el ganador sea DETERMINISTA (un
 *  `.find()` sobre el store no lo era) — y por `isCheckpoint`, nunca por `node_key`. */
function usePausedCheckpointId(): string | null {
  return useRunStore((s) => {
    const paused = Object.values(s.steps)
      .filter((st) => st.isCheckpoint && st.status === 'waiting_approval')
      .sort((a, b) => a.id.localeCompare(b.id));
    return paused[0]?.id ?? null;
  });
}

/**
 * El checkpoint del brief que está esperando decisión, o `null` (no hay checkpoint pausado, aún
 * no sabemos qué es, o no es un brief). Pide el step ENTERO por REST porque el excerpt del SSE no
 * sirve para editar; el fetch se dispara UNA vez por step.
 */
export function useBriefCheckpoint(): BriefCheckpoint | null {
  const stepId = usePausedCheckpointId();
  // El hallazgo se guarda JUNTO al step que lo produjo, en vez de resetearse al principio del
  // effect: un `setState` síncrono dentro de un effect dispara renders en cascada (y el linter lo
  // veta con razón). Al llevar el `stepId` dentro, el RENDER decide si lo que tiene en la mano
  // sigue siendo válido — sin escribir estado para descartarlo.
  const [found, setFound] = useState<BriefCheckpoint | null>(null);

  useEffect(() => {
    if (stepId === null) return;
    let cancelled = false;
    runActions
      .getStep(stepId)
      .then((step) => {
        if (cancelled) return;
        const parsed = parseBriefArtifact(step.outputRefs);
        // Solo se ESCRIBE cuando hay brief confirmado. Un `null` no hace falta persistirlo: la
        // comparación de abajo ya descarta lo que no sea de este step.
        if (parsed !== null) setFound({ stepId, ...parsed });
      })
      .catch(() => {
        // No se pudo leer el artefacto: NO se abre CP1. El panel genérico sigue ahí y el usuario
        // conserva las acciones del checkpoint (aprobar/rechazar en crudo) — degradar a "no puedo
        // editar el brief" es mucho mejor que dejarle una pantalla de error sin salida.
      });
    return () => {
      cancelled = true;
    };
  }, [stepId]);

  // El hallazgo solo vale si es DE ESTE step: si el step pausado cambió (o dejó de haberlo, o
  // resultó no ser un brief), lo que tenemos guardado es de otro momento del run y NO se muestra.
  return found !== null && found.stepId === stepId ? found : null;
}
