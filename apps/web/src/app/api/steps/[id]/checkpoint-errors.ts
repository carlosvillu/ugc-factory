// Mapeo compartido de los errores del orquestador (core) al envelope de la API
// (api.md §2) para las rutas de checkpoint/skip/cancel (T0.8). Core lanza errores
// de dominio PLANOS (no AppError): el handler los traduce al `code` HTTP correcto.
//   - StepNotFoundError → 404 not_found (el step no existe).
//   - IllegalTransitionError → 409 invalid_transition (el step no está en un
//     estado que admita la acción, p. ej. approve sobre un step ya succeeded).
//   - PersonaWithoutReferenceImageError → 400 validation_error (T5.15, regla 5a): aprobar CP3 con una
//     persona SIN imágenes de referencia es un fallo de DATOS accionable (le falta subir imágenes), no un
//     error interno. Antes caía al 500 opaco porque es un `PermanentStepError` que este mapeo no reconocía.
//     Se distingue POR TIPO (`instanceof`), NUNCA por substring del mensaje (trampa T1.8): el RESTO de
//     `PermanentStepError` (voz incoherente, endpoint-aún-etiqueta) son fallos de cableado/config y SIGUEN
//     subiendo al 500 opaco — no se colapsan en el mismo 400 (principio 9). El mensaje del error SÍ es
//     accionable (nombra la persona), así que se propaga tal cual en el envelope.
// Cualquier otro error sube tal cual y acaba en el 500 opaco de toErrorResponse.
import { AppError } from '@ugc/core/contracts';
import {
  IllegalTransitionError,
  PersonaWithoutReferenceImageError,
  StepNotFoundError,
} from '@ugc/core/orchestrator';

export function toCheckpointError(err: unknown): unknown {
  if (err instanceof StepNotFoundError) {
    return new AppError('not_found', 'step no encontrado');
  }
  if (err instanceof IllegalTransitionError) {
    return new AppError('invalid_transition', 'el step no admite esta acción en su estado actual');
  }
  if (err instanceof PersonaWithoutReferenceImageError) {
    // El mensaje ya es accionable (nombra la persona y dice qué hacer): se propaga literal.
    return new AppError('validation_error', err.message);
  }
  return err;
}
