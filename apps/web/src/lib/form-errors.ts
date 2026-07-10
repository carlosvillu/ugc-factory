// Mapea el envelope de error de la API (`{code, message, details}`) a `setError` de
// react-hook-form (forms.md §3). Lo usan TODOS los formularios (un solo patrón): un
// `validation_error` se reparte campo a campo desde el `details` de `z.flattenError`
// del servidor; cualquier otro código cae en un error `root.server` visible en un
// `role="alert"`. Los errores `root.*` de RHF no sobreviven a la siguiente
// validación — el error del servidor desaparece cuando el usuario reintenta.
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { z } from 'zod';

import type { ApiError } from '@/lib/api-client';

// Shape de `details` para validation_error: lo que produce `z.flattenError` en el
// route handler (api.md §1: parseOrThrow).
const ValidationDetailsSchema = z.object({
  formErrors: z.array(z.string()).default([]),
  fieldErrors: z.record(z.string(), z.array(z.string())).default({}),
});

export function applyEnvelopeToForm<T extends FieldValues>(
  error: ApiError,
  setError: UseFormSetError<T>,
): void {
  if (error.code === 'validation_error') {
    const parsed = ValidationDetailsSchema.safeParse(error.details);
    if (parsed.success) {
      for (const [field, messages] of Object.entries(parsed.data.fieldErrors)) {
        setError(field as Path<T>, { type: 'server', message: messages[0] ?? error.message });
      }
      if (parsed.data.formErrors.length > 0) {
        setError('root.server', {
          type: 'server',
          message: parsed.data.formErrors.join(' — '),
        });
      }
      return;
    }
  }
  setError('root.server', { type: error.code, message: error.message });
}
