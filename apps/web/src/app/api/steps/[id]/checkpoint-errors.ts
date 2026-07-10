// Mapeo compartido de los errores del orquestador (core) al envelope de la API
// (api.md §2) para las rutas de checkpoint/skip/cancel (T0.8). Core lanza errores
// de dominio PLANOS (no AppError): el handler los traduce al `code` HTTP correcto.
//   - StepNotFoundError → 404 not_found (el step no existe).
//   - IllegalTransitionError → 409 invalid_transition (el step no está en un
//     estado que admita la acción, p. ej. approve sobre un step ya succeeded).
// Cualquier otro error sube tal cual y acaba en el 500 opaco de toErrorResponse.
import { AppError } from '@ugc/core/contracts';
import { IllegalTransitionError, StepNotFoundError } from '@ugc/core/orchestrator';

export function toCheckpointError(err: unknown): unknown {
  if (err instanceof StepNotFoundError) {
    return new AppError('not_found', 'step no encontrado');
  }
  if (err instanceof IllegalTransitionError) {
    return new AppError('invalid_transition', 'el step no admite esta acción en su estado actual');
  }
  return err;
}
