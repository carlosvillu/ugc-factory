// Cliente REST isomorfo (architecture.md §3.1): la ÚNICA pieza que hace fetch a la
// API interna del Apéndice E. Importable desde client components. En web NO hay DAL
// ni Server Actions: toda lectura/mutación pasa por aquí. `cache: 'no-store'`
// SIEMPRE (app dinámica, datos vivos por SSE). Toda respuesta se valida con el
// schema Zod que se le pasa; un HTTP no-ok se traduce a `ApiError` tipada por el
// `code` del envelope de core (`{code,message,details?}`), que es la rama de
// decisión de la UI (NUNCA branch sobre `message`, texto para humanos).
import { z } from 'zod';
import {
  ErrorEnvelopeSchema,
  type CheckpointDecision,
  type ErrorEnvelope,
} from '@ugc/core/contracts';

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

/** Respuesta de `POST /api/runs` (createRun): el id del run recién creado. Nombre DISTINTO
 *  de `RunResponseSchema` a propósito — son cosas distintas (aquí solo nace un id; allí viaja
 *  el objeto run entero). Los dos formularios de intake declaraban cada uno su propia copia
 *  de esto, con el MISMO nombre que el schema de arriba y forma distinta: dos verdades
 *  homónimas en el mismo árbol de imports. */
const CreateRunResponseSchema = z.object({ runId: z.string() });

/**
 * El step COMPLETO (`GET /api/steps/:id`, T1.10b): con su `output_refs` ENTERO, no el
 * `outputExcerpt` de 200 caracteres del SSE. Lo consume CP1, que necesita el ProductBrief entero
 * (con todos los ángulos y sus evidencias) para editarlo campo a campo — un brief truncado no se
 * puede editar. `outputRefs` es `unknown`: quien lo consume lo valida contra SU contrato.
 */
const StepResponseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  nodeKey: z.string(),
  status: z.string(),
  isCheckpoint: z.boolean(),
  outputRefs: z.unknown(),
});

// NOTA: aquí NO hay un `briefActions`/`BriefResponseSchema` para `GET/PATCH /api/briefs/:id`. El
// endpoint standalone existe y está probado (Apéndice E), pero HOY no lo consume ningún cliente
// del navegador: CP1 edita el brief a través del checkpoint del step, no por esa ruta. Un cliente
// tipado sin consumidor sería código muerto que knip veta con razón; llegará con la pantalla de
// edición del brief fuera de un run (F2+), que es quien lo va a llamar.

export const runActions = {
  getRun: (runId: string) => api.get(`/api/runs/${runId}`, RunResponseSchema),
  /** El step con su artefacto COMPLETO (CP1 lo necesita entero; el SSE lo recorta). */
  getStep: (stepId: string) => api.get(`/api/steps/${stepId}`, StepResponseSchema),
  /** Edición TIPADA del checkpoint del brief (CP1): el servidor versiona (v2) y aprueba el step,
   *  invalidando el sub-grafo aguas abajo. Distinta de `edit` (canal JSON opaco genérico).
   *  `decision` (T1.11): lo que el humano DECIDIÓ en el checkpoint, que NO es parte del artefacto
   *  — se persiste aparte, en la misma tx que la transición. Opcional: la rama URL no decide. */
  editBrief: (stepId: string, brief: unknown, decision?: CheckpointDecision) =>
    api.post(
      `/api/steps/${stepId}/edit`,
      OkSchema,
      // `=== undefined` explícito (no `decision && …`): el truthiness sobre un objeto funciona
      // por casualidad y se copia mal al siguiente campo, que puede ser `0` o `''`. El body
      // OMITE la clave cuando no hay decisión — el schema del servidor es `.strict()` y
      // `{decision: undefined}` no es lo mismo que "sin decisión".
      decision === undefined ? { brief } : { brief, decision },
    ),
  /** Crea un run desde una definición de DAG (`POST /api/runs`) y devuelve su id. La usan los
   *  dos modos del intake (URL y texto libre): comparten la plomería del arranque del run,
   *  no el formulario (sus campos y su pre-paso son genuinamente distintos). */
  createRun: (definition: unknown) => api.post('/api/runs', CreateRunResponseSchema, definition),
  setAutopilot: (runId: string, autopilot: boolean) =>
    api.patch(`/api/runs/${runId}`, OkSchema, { autopilot }),
  cancelRun: (runId: string) => api.post(`/api/runs/${runId}/cancel`, OkSchema),
  /** Aprobar el checkpoint SIN editar. `decision` (T1.11): la decisión del humano, si ese
   *  checkpoint exigía una (CP1 modo manual: subir fotos vs packshot-IA). Sin ella, el body va
   *  vacío y el servidor no persiste nada — que es el caso de la rama URL y de los checkpoints
   *  genéricos del canvas. */
  approve: (stepId: string, decision?: CheckpointDecision) =>
    api.post(`/api/steps/${stepId}/approve`, OkSchema, decision === undefined ? {} : { decision }),
  edit: (stepId: string, outputRefs: unknown) =>
    api.post(`/api/steps/${stepId}/edit`, OkSchema, { outputRefs }),
  reject: (stepId: string) => api.post(`/api/steps/${stepId}/reject`, OkSchema),
  retry: (stepId: string, config?: unknown) =>
    api.post(`/api/steps/${stepId}/retry`, OkSchema, config === undefined ? undefined : { config }),
  skip: (stepId: string) => api.post(`/api/steps/${stepId}/skip`, OkSchema),
};
