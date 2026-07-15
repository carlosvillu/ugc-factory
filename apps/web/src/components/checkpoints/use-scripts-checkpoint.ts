'use client';

// ¿EL CHECKPOINT QUE ESTÁ PAUSADO ES EL DE GUIONES? (CP3, T2.6)
//
// Misma pregunta que CP1/CP2, misma respuesta: lo decide la FORMA DEL ARTEFACTO (`N5OutputSchema`)
// — el mismo criterio que usa el servidor (`server/domain-effects.ts`) y por las mismas razones:
// `node_key` NO identifica una fila dentro de un run (el supersede de T0.8 crea filas NUEVAS con el
// mismo node_key) e `isCheckpoint` a secas es demasiado ancho.
//
// A DIFERENCIA de CP2, el artefacto de N5 es LIGERO: solo trae el `batchId` (y refs por variante),
// no el texto de los guiones. El panel pide los guiones vigentes por REST
// (`GET /api/batches/:id/scripts`), que reconstruye cada `AdScript` válido (fila + matriz). Aquí
// solo se extrae lo justo para abrir el panel: el `stepId` (a él va la aprobación) y el `batchId`.
//
// La plomería (qué step está pausado, pedirlo entero por REST, no escribir estado para descartar un
// hallazgo ajeno) es de `usePausedCheckpoint`. Aquí solo vive lo de CP3.
import { N5OutputSchema } from '@ugc/core/contracts';
import { usePausedCheckpoint } from './use-paused-checkpoint';

export interface ScriptsCheckpoint {
  /** El step de CP3 (N5 en `waiting_approval`): a él va la aprobación con los veredictos. */
  stepId: string;
  /** El lote cuyos guiones se editan: el panel pide sus guiones vigentes por REST. */
  batchId: string;
}

/**
 * Parsea el `output_refs` de N5 a lo que CP3 necesita. `null` si el artefacto NO es de guiones —
 * que es justo la señal que distingue este checkpoint de cualquier otro.
 *
 * Definida a nivel de MÓDULO (no inline en el hook) porque entra en las deps del effect de
 * `usePausedCheckpoint`: una función nueva en cada render volvería a pedir el step en bucle.
 */
function parseScriptsArtifact(outputRefs: unknown): Omit<ScriptsCheckpoint, 'stepId'> | null {
  const output = N5OutputSchema.safeParse(outputRefs);
  if (!output.success) return null;
  return { batchId: output.data.batchId };
}

/** El checkpoint de guiones que está esperando revisión, o `null`. */
export function useScriptsCheckpoint(): ScriptsCheckpoint | null {
  return usePausedCheckpoint(parseScriptsArtifact);
}
