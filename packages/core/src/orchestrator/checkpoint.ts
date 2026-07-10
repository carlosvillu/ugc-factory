// Decisión PURA de checkpoint (§7.1.b, T0.8): al terminar el trabajo de un step,
// ¿pasa a `succeeded` o se PAUSA en `waiting_approval` esperando aprobación
// humana? La regla vive aquí (lógica pura, testeable sin BD) y la consume el
// consumer genérico (apps/worker) tras un executor exitoso, y el core de
// invalidación al re-encolar un sub-grafo.
//
// Frontera de core (SKILL.md backend, principio 1): sin BD, sin cola. Habla
// banderas, no filas.
import { z } from 'zod';

/**
 * Config de un checkpoint (`step_run.checkpoint_config`). `alwaysPause` es el
 * override "parar SIEMPRE aquí" per-nodo: GANA sobre `autopilot=true` del run.
 * `looseObject` (no strict): el shape puede crecer con F1+ sin romper el parse de
 * filas existentes.
 */
export const CheckpointConfigSchema = z.looseObject({
  alwaysPause: z.boolean().optional(),
});
export type CheckpointConfig = z.infer<typeof CheckpointConfigSchema>;

/** Entrada de la decisión de pausa: las tres banderas que la gobiernan. */
export interface ShouldPauseInput {
  /** ¿El step es un checkpoint? (`step_run.is_checkpoint`) */
  isCheckpoint: boolean;
  /** Config del checkpoint (`step_run.checkpoint_config`), o null. */
  checkpointConfig: unknown;
  /** ¿El run está en autopilot? (`pipeline_run.autopilot`) */
  autopilot: boolean;
}

/**
 * ¿Debe el step PAUSAR en `waiting_approval` al terminar su trabajo? Reglas
 * (§7.1.b + override per-nodo de T0.8):
 *  - Un nodo NO-checkpoint nunca pausa.
 *  - Un checkpoint pausa por defecto...
 *  - ...salvo que el run esté en `autopilot` (no hay pausas)...
 *  - ...PERO el override `checkpoint_config.alwaysPause=true` GANA sobre autopilot:
 *    un checkpoint marcado "parar siempre" pausa aunque autopilot esté on.
 *
 * Función PURA y total. Un `checkpointConfig` con shape inesperado se trata como
 * sin override (safeParse): un checkpoint mal configurado pausa (conservador), no
 * se salta la aprobación por un typo.
 */
export function shouldPause({
  isCheckpoint,
  checkpointConfig,
  autopilot,
}: ShouldPauseInput): boolean {
  if (!isCheckpoint) return false;
  const parsed = CheckpointConfigSchema.safeParse(checkpointConfig ?? {});
  const alwaysPause = parsed.success ? parsed.data.alwaysPause === true : false;
  if (alwaysPause) return true; // override per-nodo gana sobre autopilot
  return !autopilot; // checkpoint normal: pausa salvo autopilot
}
