// Cliente REST isomorfo (architecture.md §3.1): la ÚNICA pieza que hace fetch a la
// API interna del Apéndice E. Importable desde client components. En web NO hay DAL
// ni Server Actions: toda lectura/mutación pasa por aquí. `cache: 'no-store'`
// SIEMPRE (app dinámica, datos vivos por SSE). Toda respuesta se valida con el
// schema Zod que se le pasa; un HTTP no-ok se traduce a `ApiError` tipada por el
// `code` del envelope de core (`{code,message,details?}`), que es la rama de
// decisión de la UI (NUNCA branch sobre `message`, texto para humanos).
import { z } from 'zod';
import { ErrorEnvelopeSchema, type ErrorEnvelope } from '@ugc/core/contracts';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorEnvelope['code'],
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// En navegador: ruta relativa. En jsdom (tests) o servidor: absoluta (el fetch de
// Node exige URL absoluta — testing/frontend.md §6).
const base = () =>
  typeof window === 'undefined' || process.env.NODE_ENV === 'test' ? 'http://localhost:3000' : '';

export async function apiFetch<S extends z.ZodType>(
  path: string,
  schema: S,
  init: RequestInit & { baseUrl?: string } = {},
): Promise<z.infer<S>> {
  const { baseUrl, ...rest } = init;
  const res = await fetch(`${baseUrl ?? base()}${path}`, { ...rest, cache: 'no-store' });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const envelope = ErrorEnvelopeSchema.safeParse(body);
    if (envelope.success) {
      throw new ApiError(
        envelope.data.code,
        envelope.data.message,
        res.status,
        envelope.data.details,
      );
    }
    throw new ApiError('internal', `Respuesta sin envelope de ${path}`, res.status);
  }

  return schema.parse(await res.json());
}

const jsonInit = (body: unknown, method: string): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});

// `ok` schema para endpoints de mutación que devuelven `{ok:true, ...}`: no hay
// payload de dominio que consumir, solo confirmar el 2xx. Se valida igual (una
// respuesta sin `ok` es un contrato roto).
const OkSchema = z.object({ ok: z.literal(true) }).loose();

export const api = {
  get: <S extends z.ZodType>(path: string, schema: S) => apiFetch(path, schema),
  post: <S extends z.ZodType>(path: string, schema: S, body?: unknown) =>
    apiFetch(path, schema, jsonInit(body ?? {}, 'POST')),
  patch: <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
    apiFetch(path, schema, jsonInit(body, 'PATCH')),
  // Upload multipart (T1.6, POST /api/assets): NO se fija `content-type` — el
  // navegador añade el `multipart/form-data; boundary=…` correcto a partir del
  // `FormData`. Misma validación de respuesta y traducción de error que el resto.
  postForm: <S extends z.ZodType>(path: string, schema: S, form: FormData) =>
    apiFetch(path, schema, { method: 'POST', body: form }),
};

// ── Acciones del run/step del canvas (T0.11) ─────────────────────────────────
// Cada botón del panel/cabecera dispara una de estas y NO toca el store: el estado
// nuevo llega por SSE y el canvas se repinta solo (canvas.md §5, NO optimistic
// updates). EXCEPCIÓN documentada: `setRunAutopilot` — el autopilot es estado de
// nivel RUN que el SSE NO ecoa (el snapshot es `{runId, steps}`, sin objeto run),
// así que el toggle actualiza el store localmente Y persiste por PATCH; no es un
// optimistic update de STEP (el guard prohíbe adivinar estado de step, no de run).

/** Respuesta del objeto run (`GET /api/runs/:id`). Las fechas viajan como ISO. */
export const RunResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(['full', 'partial', 'regen']),
  autopilot: z.boolean(),
  status: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  totalCostEstimated: z.number().int().nullable(),
  totalCostActual: z.number().int().nullable(),
});
export type RunResponse = z.infer<typeof RunResponseSchema>;

export const runActions = {
  getRun: (runId: string) => api.get(`/api/runs/${runId}`, RunResponseSchema),
  setAutopilot: (runId: string, autopilot: boolean) =>
    api.patch(`/api/runs/${runId}`, OkSchema, { autopilot }),
  cancelRun: (runId: string) => api.post(`/api/runs/${runId}/cancel`, OkSchema),
  approve: (stepId: string) => api.post(`/api/steps/${stepId}/approve`, OkSchema),
  edit: (stepId: string, outputRefs: unknown) =>
    api.post(`/api/steps/${stepId}/edit`, OkSchema, { outputRefs }),
  reject: (stepId: string) => api.post(`/api/steps/${stepId}/reject`, OkSchema),
  retry: (stepId: string, config?: unknown) =>
    api.post(`/api/steps/${stepId}/retry`, OkSchema, config === undefined ? undefined : { config }),
  skip: (stepId: string) => api.post(`/api/steps/${stepId}/skip`, OkSchema),
};
