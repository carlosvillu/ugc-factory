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
import {
  BriefWarningSchema,
  N3OutputSchema,
  ProductBriefSchema,
  type BriefWarning,
  type ProductBrief,
} from '@ugc/core/contracts';
import { usePausedCheckpoint } from './use-paused-checkpoint';

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

/**
 * El checkpoint del brief que está esperando decisión, o `null` (no hay checkpoint pausado, aún
 * no sabemos qué es, o no es un brief).
 *
 * La plomería —qué checkpoint está pausado, pedir su step ENTERO por REST (el excerpt del SSE va
 * recortado y no sirve para editar), no escribir estado para descartar un hallazgo de otro step—
 * vive en `usePausedCheckpoint` desde T2.3, compartida con CP2. Lo ESPECÍFICO de CP1 es lo único
 * que queda aquí: qué forma de artefacto reconoce y qué saca de ella.
 */
export function useBriefCheckpoint(): BriefCheckpoint | null {
  return usePausedCheckpoint(parseBriefArtifact);
}
