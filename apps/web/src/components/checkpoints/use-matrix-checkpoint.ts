'use client';

// ¿EL CHECKPOINT QUE ESTÁ PAUSADO ES LA MATRIZ? (CP2, T2.3)
//
// Misma pregunta que hizo CP1 (`use-brief-checkpoint`), misma respuesta: lo decide la FORMA DEL
// ARTEFACTO (`N4OutputSchema`) — el mismo criterio que usa el servidor (`server/domain-effects.ts`)
// y por las mismas razones: `node_key` NO identifica una fila dentro de un run (el supersede de
// T0.8 crea filas NUEVAS con el mismo node_key) y `isCheckpoint` a secas es demasiado ancho (CP1 y
// los checkpoints de demo también lo son, y CP2 les secuestraría el panel).
//
// La plomería (qué step está pausado, pedirlo entero por REST, no escribir estado para descartar un
// hallazgo ajeno) es de `usePausedCheckpoint`. Aquí solo vive lo de CP2.
import {
  BatchConfigSchema,
  BatchPlanSchema,
  N4OutputSchema,
  ProductBriefSchema,
  type BatchConfig,
  type BatchPlan,
  type ProductBrief,
} from '@ugc/core/contracts';
import { usePausedCheckpoint } from './use-paused-checkpoint';

export interface MatrixCheckpoint {
  /** El step de CP2 (N4 en `waiting_approval`): a él va la aprobación con la decisión. */
  stepId: string;
  /** El brief, para pintar sus ángulos con sus hooks y el `avatar_hint` de su audiencia. */
  brief: ProductBrief;
  /** La config que N4 PROPUSO (el punto de partida del panel; el usuario la cambia). */
  config: BatchConfig;
  /** La matriz propuesta (preview, sin `batchDiscriminator`). El panel la re-pide al servidor en
   *  cuanto el usuario toca algo — pero esta es la que ya está pagada (bueno: $0) y evita un
   *  primer render vacío mientras vuela el primer fetch. */
  plan: BatchPlan;
}

/**
 * Parsea el `output_refs` de N4 a lo que CP2 necesita. `null` si el artefacto NO es una matriz —
 * que es justo la señal que distingue este checkpoint de cualquier otro.
 *
 * Definida a nivel de MÓDULO (no inline en el hook) porque entra en las deps del effect de
 * `usePausedCheckpoint`: una función nueva en cada render volvería a pedir el step en bucle.
 */
function parseMatrixArtifact(outputRefs: unknown): Omit<MatrixCheckpoint, 'stepId'> | null {
  const output = N4OutputSchema.safeParse(outputRefs);
  if (!output.success) return null;
  // El `brief` viaja como `unknown` en el artefacto (mismo criterio que N3: no se re-valida un
  // objeto grande en cada lectura). Aquí SÍ se valida, porque el panel lo va a pintar campo a campo.
  const brief = ProductBriefSchema.safeParse(output.data.brief);
  if (!brief.success) return null;

  // NO se expone el `briefId` del artefacto: el panel no lo necesita (el servidor saca el brief del
  // step al estimar y al crear) y tenerlo a mano solo invitaría a volver a mandarlo desde el
  // cliente — que es justo la procedencia que CP2 cerró.
  return {
    brief: brief.data,
    config: BatchConfigSchema.parse(output.data.config),
    plan: BatchPlanSchema.parse(output.data.plan),
  };
}

/** El checkpoint de la matriz que está esperando confirmación de gasto, o `null`. */
export function useMatrixCheckpoint(): MatrixCheckpoint | null {
  return usePausedCheckpoint(parseMatrixArtifact);
}
