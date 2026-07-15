// Cliente REST isomorfo (architecture.md §3.1): la ÚNICA pieza que hace fetch a la
// API interna del Apéndice E. Importable desde client components. En web NO hay DAL
// ni Server Actions: toda lectura/mutación pasa por aquí. `cache: 'no-store'`
// SIEMPRE (app dinámica, datos vivos por SSE). Toda respuesta se valida con el
// schema Zod que se le pasa; un HTTP no-ok se traduce a `ApiError` tipada por el
// `code` del envelope de core (`{code,message,details?}`), que es la rama de
// decisión de la UI (NUNCA branch sobre `message`, texto para humanos).
import { z } from 'zod';
import {
  BatchEstimateSchema,
  BatchScriptsSchema,
  ErrorEnvelopeSchema,
  type BatchConfig,
  type CheckpointDecision,
  type ErrorEnvelope,
} from '@ugc/core/contracts';
import {
  PersonaCandidateListSchema,
  PersonaSchema,
  type PersonaBody,
  type PersonaPatch,
} from '@ugc/core/persona';

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

/**
 * Base URL del fetch **de servidor** (RSC y jsdom), resuelta por PRECEDENCIA (T1.13):
 *
 *   1. `INTERNAL_API_URL` — override explícito. Único canal para apuntar a otro host
 *      (proxy, contenedor, red interna); gana siempre.
 *   2. `http://localhost:${PORT}` — DERIVADA del puerto real en el que sirve este mismo
 *      proceso. El web se llama A SÍ MISMO: su base es su propio puerto, y `PORT` es la
 *      variable que Next lee para elegirlo (`PORT=3001 next dev` → sirve en 3001 Y expone
 *      `process.env.PORT='3001'` al runtime nodejs; verificado empíricamente).
 *   3. `http://localhost:3000` — el default de Next cuando nadie fija `PORT`.
 *
 * Por qué esto existe: hasta T1.13 el paso 2 no existía y la base estaba HARDCODEADA al
 * 3000. Arrancar en cualquier otro puerto (p. ej. porque el 3000 está ocupado) hacía que
 * los RSC (`/spend`, `/settings`, `/runs/[id]`) se llamaran al 3000 — un servidor ajeno o
 * ninguno → 404/ECONNREFUSED → 500 de la página. Derivar del PORT hace que la app funcione
 * en el puerto en el que de verdad está, sin ceremonia de env.
 *
 * Función PURA sobre el env (no lee `process.env` ella misma) para poder testear la
 * precedencia sin tocar variables globales.
 */
export function resolveServerBaseUrl(env: Record<string, string | undefined>): string {
  if (env.INTERNAL_API_URL) return env.INTERNAL_API_URL;
  const port = env.PORT?.trim();
  // Se valida la FORMA (dígitos), no el RANGO — y la distinción importa:
  //
  //   · `PORT=abc` → `http://localhost:abc` sería una URL inválida y el fetch moriría con un
  //     error incomprensible. Caer al default es diagnosticable. Por eso el `/^\d+$/`.
  //   · Validar el rango (1–65535) sería, en cambio, un ERROR. `PORT=99999` ni siquiera hace
  //     falta defenderlo: Next NO ARRANCA (ERR_SOCKET_BAD_PORT), así que ningún RSC renderiza
  //     y esta función jamás se llama con ese valor. Y `PORT=0` sería activamente DAÑINO
  //     rechazarlo: Next SÍ arranca (en un puerto EFÍMERO, p. ej. 64834), y caer al 3000
  //     apuntaría a un servidor ajeno ⇒ el MISMO 500 que T1.13 elimina, reintroducido por el
  //     guard que decía prevenirlo.
  //
  // La lección de fondo: **`process.env.PORT` no es «el puerto del servidor», es «el puerto
  // que se PIDIÓ»**. Con `PORT=0` esos dos números DIFIEREN, y ninguna validación del env
  // puede arreglarlo — el puerto real solo existe en el socket que escucha. `PORT=0` queda
  // como NO SOPORTADO: este proyecto es mono-usuario self-hosted con puerto fijo.
  const isNumericPort = port !== undefined && /^\d+$/.test(port);
  return `http://localhost:${isNumericPort ? port : '3000'}`;
}

// En navegador: ruta RELATIVA — la base es el propio origin desde el que se sirvió la
// página, así que el navegador acierta siempre y `PORT` (que es config del PROCESO
// servidor) no significa nada aquí. En jsdom (tests) o servidor: absoluta (el fetch de
// Node exige URL absoluta — testing/frontend.md §6). El guard de `typeof window` va
// PRIMERO: nunca se lee `PORT` en cliente.
const base = () =>
  typeof window === 'undefined' || process.env.NODE_ENV === 'test'
    ? resolveServerBaseUrl(process.env)
    : '';

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

/** La respuesta de `POST /api/steps/:id/approve` (T2.6): `ok` + un `nextRunId` OPCIONAL. Es un
 *  schema aparte de `OkSchema` a propósito: `OkSchema` es `.loose()`, así que `nextRunId` llegaría
 *  en el JSON pero NO en el TIPO inferido (`loose` no lo declara) — y el cliente que navega a CP3 lo
 *  perdería en compilación. Aprobar CP2 arranca el run de N5 y devuelve su id aquí; el resto de
 *  checkpoints (CP1, CP3, aprobar sin efecto) lo ven `undefined`. */
const ApproveResponseSchema = z.object({
  ok: z.literal(true),
  nextRunId: z.string().optional(),
});

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
  // `pipeline_run.total_cost_actual`: hasta T1.20 era un DATO FALSO (nadie hacía el rollup por
  // run: NULL en todos). T1.20 la mantiene —el orquestador la recomputa desde el ledger en cada
  // cierre de step, y una migración backfilló los runs viejos—, así que ya no miente. Aun así,
  // lo que la cabecera PINTA es `costActualCents` (abajo), que viene del ledger: una sola fuente
  // para el número que se enseña, y esta columna como proyección auditable contra ella.
  // Sigue pendiente `pipeline_run.status`, que NADIE mantiene (deuda de T0.8; el oráculo es
  // `deriveRunStatus`) — no la pintes.
  totalCostActual: z.number().int().nullable(),
  /**
   * EL COSTE REAL del run en céntimos, agregado del LEDGER (`cost_entry`) por el servidor (T1.17).
   *
   * Existe porque la cabecera del canvas lo calculaba antes en el CLIENTE sumando el `costActual`
   * de los steps del SSE — y ese campo sale de `step_run.cost_actual`, que ENTONCES se quedaba
   * **NULL en un step que fallaba habiendo gastado** (el rollup de T1.10b solo corría al cerrar
   * bien). Los dos runs que murieron en N3 gastando 16 y 13 céntimos mostraban «Coste real:
   * $0.00». T1.20 arregló la columna en origen (rollup en TODOS los cierres + backfill), pero
   * este total sigue viniendo del LEDGER: es el original, no una proyección de él.
   */
  costActualCents: z.number().int(),
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
 *
 * `error` (T1.16): el mensaje de error ENTERO, por la misma razón y con el mismo criterio — el
 * `errorExcerpt` del SSE también se corta a 200 caracteres, y los errores que de verdad hay que
 * leer son largos (el volcado de issues de Zod de un fallo de validación en N3). Lo consume el
 * visor modal de error del inspector. `null` si el step no falló.
 */
const StepResponseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  nodeKey: z.string(),
  status: z.string(),
  isCheckpoint: z.boolean(),
  outputRefs: z.unknown(),
  error: z.string().nullable(),
});

// NOTA: aquí NO hay un `briefActions`/`BriefResponseSchema` para `GET/PATCH /api/briefs/:id`. El
// endpoint standalone existe y está probado (Apéndice E), pero HOY no lo consume ningún cliente
// del navegador: CP1 edita el brief a través del checkpoint del step, no por esa ruta. Un cliente
// tipado sin consumidor sería código muerto que knip veta con razón; llegará con la pantalla de
// edición del brief fuera de un run (F2+), que es quien lo va a llamar.

// ── Librería de personas (T2.0) ──────────────────────────────────────────────
// El CRUD de `/personas` + el upload de imágenes de referencia. Todo contra la API REST del
// Apéndice E, con los contratos de `@ugc/core/persona` (los mismos que re-valida el handler).
export const personaActions = {
  /** Las personas COMPATIBLES con un `avatar_hint` (T2.0, §11). La REGLA de matching es pura y
   *  vive en core, pero se ejecuta en el SERVIDOR: CP2 pide las candidatas, no la librería entera
   *  para filtrarla en el navegador — sería reimplementar la regla en el cliente (dos verdades) y
   *  bajarse personas que no va a enseñar. */
  candidates: (avatarHint: string) =>
    api.get(
      `/api/personas/candidates?avatar_hint=${encodeURIComponent(avatarHint)}`,
      PersonaCandidateListSchema,
    ),
  create: (body: PersonaBody) => api.post('/api/personas', PersonaSchema, body),
  update: (id: string, patch: PersonaPatch) =>
    api.patch(`/api/personas/${id}`, PersonaSchema, patch),
  remove: (id: string) => apiFetch(`/api/personas/${id}`, OkSchema, { method: 'DELETE' }),
  /** Sube una imagen de referencia (multipart). El servidor VALIDA ≥2K leyendo el fichero: un
   *  rechazo llega como `ApiError('validation_error')` y la UI lo pinta en un `role="alert"`.
   *  Devuelve la persona ya actualizada (con la imagen en su lista) — sin un segundo GET. */
  addReferenceImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.postForm(
      `/api/personas/${id}/reference-images`,
      z.object({ persona: PersonaSchema }),
      form,
    );
  },
  removeReferenceImage: (id: string, assetId: string) =>
    apiFetch(`/api/personas/${id}/reference-images/${assetId}`, PersonaSchema, {
      method: 'DELETE',
    }),
};

// ── CP2 · matriz y coste del lote (T2.3) ─────────────────────────────────────
// EL COSTE NO SE CALCULA EN EL NAVEGADOR (decisión vinculante de T2.3): cada cambio del panel
// (tier, ángulos, idiomas, persona) pide al servidor la matriz y su coste, que salen de
// `composeMatrix` + `estimateBatchCost` sobre la `recipe` REAL de la BD. Es la MISMA función que
// usa la confirmación ⇒ lo que se estima es lo que se crea. La respuesta se valida contra el
// contrato de core: un total que no cumple el contrato es un error, no un número que pintar.
export const batchActions = {
  /** Se manda el `stepId` del checkpoint, NO el `briefId`: el servidor saca el brief del artefacto
   *  del step (la misma procedencia que la confirmación), en vez de fiarse del que diga el cliente. */
  estimate: (stepId: string, config: BatchConfig) =>
    api.post('/api/batches/estimate', BatchEstimateSchema, { stepId, config }),
  /** Los guiones VIGENTES de un lote (CP3, T2.6): lo que el editor de guiones lista y edita. El
   *  servidor reconstruye cada `AdScript` válido (fila + matriz) — ver `server/batch-scripts.ts`. */
  getScripts: (batchId: string) => api.get(`/api/batches/${batchId}/scripts`, BatchScriptsSchema),
};

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
    api.post(
      `/api/steps/${stepId}/approve`,
      // `ApproveResponseSchema` (no `OkSchema`): aprobar CP2 devuelve el `nextRunId` del run de N5,
      // y `OkSchema.loose()` lo dejaría fuera del TIPO. Los demás checkpoints lo ven `undefined`.
      ApproveResponseSchema,
      decision === undefined ? {} : { decision },
    ),
  edit: (stepId: string, outputRefs: unknown) =>
    api.post(`/api/steps/${stepId}/edit`, OkSchema, { outputRefs }),
  reject: (stepId: string) => api.post(`/api/steps/${stepId}/reject`, OkSchema),
  retry: (stepId: string, config?: unknown) =>
    api.post(`/api/steps/${stepId}/retry`, OkSchema, config === undefined ? undefined : { config }),
  skip: (stepId: string) => api.post(`/api/steps/${stepId}/skip`, OkSchema),
};
