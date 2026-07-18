// EL FalClient (N6/§9.6, T4.1) — cliente HTTP sobre `@fal-ai/client` para el queue de
// fal.ai. Vive en `packages/core/generation/` (no en services): usa fetch y recibe su
// config por deps; la frontera prohibida de core es la BD/cola, no la red (architecture
// §1, PRD §9.6). El COSTE y la PERSISTENCIA (`generation`, `asset`, `cost_entry`) los pone
// `@ugc/services` (runGenerate) — aquí solo se habla con fal.
//
// TRES OPERACIONES, SEPARADAS A PROPÓSITO (la idempotencia de T4.3 lo exige):
//   1. `uploadInput(bytes)` → sube un input a fal storage, devuelve su URL.
//   2. `submit(endpoint, input)` → encola la request; devuelve request_id + status_url +
//      response_url TAL CUAL los devuelve fal. El servicio los PERSISTE antes de pollear.
//   3. `poll(handle)` → GET a la `status_url` DEVUELTA (nunca reconstruida) hasta COMPLETED,
//      luego GET a la `response_url` para el output. Polling directo con fetch, no vía los
//      métodos del SDK: `queue.status(endpoint,{requestId})` RECONSTRUYE la URL, y el bug
//      del OSS de referencia (submit a un modelo, poll a otro por asumir el formato de la
//      URL, §6.3.3) es justo lo que evitamos usando la URL guardada.
//
// ERRORES TIPADOS POR CAUSA (principio 9 de testing, patrón T1.7/T1.8): el fallo de
// PROVEEDOR (4xx/401/429/timeout — status HTTP capturado) y el fallo de VALIDACIÓN de la
// respuesta (payload no parseable o fuera de contrato) son RAMAS SEPARADAS. Nunca un
// `catch {}` que las colapse: reintentar un 429 tiene sentido; reintentar un output
// corrupto re-tira el dado. `FalProviderError` lleva el `status`; `FalResponseError` no.
import { createFalClient, type FalClient as SdkFalClient } from '@fal-ai/client';

/** Los ORÍGENES de la API de fal que el seam de intercepción (`baseUrlOverride`) reescribe. Son los
 *  hosts a los que el SDK hace submit/upload y a los que apuntan las `status_url`/`response_url`
 *  ABSOLUTAS que fal devuelve (y que el cliente sigue TAL CUAL). Fuera de estos orígenes (p.ej. la URL
 *  PÚBLICA del output en `fal.media`) el seam NO reescribe — un fake E2E sirve esas desde su propio host. */
const FAL_ORIGINS = ['https://queue.fal.run', 'https://rest.fal.run', 'https://fal.run'];

/**
 * Construye un `fetch` que REESCRIBE POR ORIGEN cualquier request a la API de fal (`FAL_ORIGINS`) al
 * `baseUrl` dado (E2E: un fake server). Es una reescritura de PROTOCOLO+HOST+PUERTO que PRESERVA
 * path+query — NUNCA un `baseUrl`-prepend. La distinción es CRÍTICA (landmine T4.6): fal devuelve
 * `status_url`/`response_url` ABSOLUTAS y auto-referenciales que el cliente SIGUE tal cual (poll +
 * download del output leído de response_url); un prepend reescribiría el submit pero NO el poll/download,
 * que fugarían a la fal REAL y quemarían dinero. La reescritura por-origen intercepta las TRES fases.
 * Fuera de `FAL_ORIGINS`, delega al `base` sin tocar (p.ej. descarga del output público en fal.media,
 * que el fake E2E sirve desde su propio host y no matchea un origen de fal).
 */
function makeOriginRewriteFetch(
  base: typeof globalThis.fetch,
  baseUrl: string,
): typeof globalThis.fetch {
  const target = new URL(baseUrl);
  return (input, init) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const origin = FAL_ORIGINS.find((o) => rawUrl.startsWith(o));
    if (origin === undefined) return base(input, init);
    const rewritten = new URL(rawUrl);
    rewritten.protocol = target.protocol;
    rewritten.host = target.host;
    return base(rewritten.href, init);
  };
}

/** Concurrencia por defecto del rate limiter (~8): la concurrencia del queue de fal es
 *  ~10; se deja margen para webhooks/polling en paralelo (PRD §6.3.4). */
export const DEFAULT_FAL_CONCURRENCY = 8;

/** Timeout duro por request (ms). Una request colgada dejaría el paso sin señal. */
export const DEFAULT_FAL_TIMEOUT_MS = 60_000;

/** Reintentos ante 429 con `Retry-After` (§6.3.4). 1 intento + 1 reintento tras esperar lo
 *  que el header pide: el rate limiter ya evita la mayoría de los 429; el reintento cubre el
 *  borde. Más reintentos serían enmascarar un problema de concurrencia mal calibrada. */
export const DEFAULT_FAL_MAX_RETRIES = 1;

/**
 * Fallo del PROVEEDOR: fal respondió con un status de error (4xx/5xx/401/429) o la request
 * no llegó (timeout/red). Lleva el `status` HTTP cuando lo hay (undefined en timeout/red).
 * Es la rama REINTENTABLE — el servicio la mapea a `generation.status='failed'` reintentable.
 */
export class FalProviderError extends Error {
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  constructor(message: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'FalProviderError';
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/**
 * Fallo de VALIDACIÓN: fal respondió (y se pagó), pero el payload no tiene la forma esperada
 * (falta `status`/`status_url`/`response_url`, output sin `images`…). NO es reintentable por
 * red: reintentar no cambia un contrato roto. Rama SEPARADA a propósito de `FalProviderError`.
 *
 * ⚠ MONEY POINT (T4.11, deuda T4.10a): NO uses `FalResponseError` para una VIOLACIÓN DE CONTRATO de
 * un output YA generado (output sin `video`/`audio`, invariante `assetId===null` roto). El consumer
 * de steps (`step-execute.ts`) trata un throw normal como REINTENTABLE (`failStep` → retry → re-submit
 * a fal), así que envolver un output determinísticamente malformado en `FalResponseError` haría que el
 * step lo RE-PAGUE 3 veces para fallar igual (el money-burn T1.10a). Una violación de contrato de una
 * generación completada es DETERMINISTA → los executors N7 la mapean a `PermanentStepError` (sin retry,
 * sin re-pago). `FalResponseError` queda para el uso original: fallos de validación en el camino de
 * dedup/reintento (la carrera perdedora usa su propia subclase `LoserRaceError`, ver abajo).
 */
export class FalResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FalResponseError';
  }
}

/**
 * Fallo de CARRERA PERDEDORA de la dedup de producción (§9.6, MONEY POINT T4.11/deuda T4.10a): dos
 * generaciones idénticas concurrentes compiten por el índice único parcial `content_hash`; la que
 * PIERDE el INSERT y todavía no ve la fila del ganador `completed` lanza ESTA señal para que el caller
 * reintente y deduplique cuando el ganador termine. Es una SEÑAL DE TIPO, no un string compartido:
 *
 *   · Es REINTENTABLE a propósito (subclase de `FalResponseError` para que cualquier caller que ya
 *     trate `FalResponseError` como "reintenta" siga funcionando; y `step-execute.ts` la deja subir
 *     como throw normal → `failStep` → retry). El reintento NO re-paga: en la siguiente vuelta el
 *     ganador ya está `completed` y el loser DEDUPLICA a su asset (0 submits, 0 cost_entry).
 *   · La distinción de TIPO frente a una violación de contrato es lo que impide el money-burn: una
 *     violación de contrato es `PermanentStepError` (no reintenta, no re-paga); una carrera perdedora
 *     es `LoserRaceError` (reintenta, deduplica). Antes AMBAS eran el mismo `FalResponseError` con
 *     string distinto — indistinguibles por tipo, así que un executor no podía cribar una de otra.
 *
 * ⚠ Los executors N7 NO deben envolver `LoserRaceError` en `PermanentStepError` (la volverían terminal
 * y el loser iría a `failed` en vez de deduplicar, rompiendo «nº de generations = hooks+body+CTA+shots»).
 * El presupuesto de retry del loser (`max_retries` del step) debe SOBREVIVIR a la latencia peor-caso del
 * ganador (Veo, minutos) — ver la config de retry de N7 en la definición del run.
 */
export class LoserRaceError extends FalResponseError {
  constructor(message: string) {
    super(message);
    this.name = 'LoserRaceError';
  }
}

/** Lo que `submit` devuelve: las tres URLs/ids de fal, GUARDADAS sin tocar. */
export interface FalSubmitResult {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  /** El status inicial ('IN_QUEUE' normalmente). Se persiste como evidencia. */
  status: string;
  /** El payload crudo del submit (para `fal_status_payload`). */
  raw: unknown;
}

/** El resultado terminal del polling: el status COMPLETED y el output leído de response_url. */
export interface FalPollResult {
  status: 'COMPLETED';
  /** El output del modelo (p. ej. `{ images: [{url,width,height,content_type}], ... }`). */
  output: unknown;
  /** El último payload de status (para `fal_status_payload`). */
  statusPayload: unknown;
}

/**
 * El resultado de UN SOLO chequeo de estado (`checkStatus`): la primitiva puntual que `poll` repite
 * en su loop y que la reconciliación de T4.3 usa UNA vez por tick (un sweeper no puede bloquear un
 * tick esperando a fal). Distingue los tres estados observables — `completed` (con output leído de
 * response_url), `processing` (sigue en cola/progreso) y `failed` (fal terminó en error) — sin
 * colapsarlos: un `processing` NO es un error, y un `failed` de fal se distingue de un 429/timeout
 * (que es `FalProviderError`, lanzado por `authedFetch`). Un contrato roto (JSON sin `status`) es
 * `FalResponseError` (lanzado, no un estado). Es la base de reuso que la primitiva `reconcile` exige.
 */
export type FalStatusCheck =
  | { state: 'completed'; output: unknown; statusPayload: unknown }
  | { state: 'processing'; statusPayload: unknown }
  | { state: 'failed'; falStatus: string; statusPayload: unknown };

export interface FalClientDeps {
  /** La API key de fal EN CLARO (el caller la lee de env/secretos). */
  credentials: string;
  /** `fetch` inyectable — msw en tests, global en producción. Lo usa TANTO el SDK (submit,
   *  upload) como el polling directo, para que un solo mock intercepte todo. */
  fetch?: typeof globalThis.fetch;
  /** SEAM DE INTERCEPCIÓN E2E (T4.11, deuda T4.6): la `baseUrl` de un fake server de fal. Cuando se
   *  pasa, el cliente REESCRIBE POR ORIGEN (protocolo+host, preservando path+query) toda request a
   *  `FAL_ORIGINS` hacia esa baseUrl — el submit del SDK Y el poll/download que siguen las
   *  `status_url`/`response_url` ABSOLUTAS de fal. Es una capacidad de PRIMERA CLASE del FalClient (no
   *  un `fetch` envuelto en la capa web), así que cubre por igual el path de WEB (preview de voz) y el
   *  de WORKER (executors N7). AUSENTE en producción → el fetch va a la fal REAL sin tocar. NO es un
   *  `baseUrl`-prepend (rompería el poll/download → fuga a fal real): ver `makeOriginRewriteFetch`. */
  baseUrlOverride?: string;
  /** Concurrencia máxima del rate limiter. Default `DEFAULT_FAL_CONCURRENCY`. */
  concurrency?: number;
  /** Timeout por request (ms). */
  timeoutMs?: number;
  /** Reintentos ante 429. Default `DEFAULT_FAL_MAX_RETRIES`. */
  maxRetries?: number;
  /** Espera inyectable (ms) — tests deterministas sin timers reales. Default `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Intervalo de polling entre GETs a status_url (ms). Default 1000. */
  pollIntervalMs?: number;
  /** Techo de intentos de polling (evita un loop infinito si fal nunca termina). Default 600. */
  maxPollAttempts?: number;
}

/** Un token-bucket / semáforo de concurrencia: `run(fn)` espera a que haya un hueco (<=N en
 *  vuelo), ejecuta `fn`, y al terminar libera el hueco para el siguiente en cola. Es lo que
 *  garantiza `max en vuelo <= concurrency` medido en el handler de los tests. */
class ConcurrencyLimiter {
  private inFlight = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.inFlight += 1;
    try {
      return await fn();
    } finally {
      this.inFlight -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Parsea `Retry-After` (segundos o fecha HTTP) a ms. Devuelve undefined si no es parseable —
 *  el caller cae a un backoff mínimo, nunca a "reintenta ya" (martillearía el 429). */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null || header === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function makeFalClient(deps: FalClientDeps) {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_FAL_TIMEOUT_MS;
  const maxRetries = deps.maxRetries ?? DEFAULT_FAL_MAX_RETRIES;
  const sleep = deps.sleep ?? defaultSleep;
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;
  const maxPollAttempts = deps.maxPollAttempts ?? 600;
  const limiter = new ConcurrencyLimiter(deps.concurrency ?? DEFAULT_FAL_CONCURRENCY);
  // EL FETCH EFECTIVO: el inyectado (msw/global) envuelto por el seam de intercepción por-origen si
  // `baseUrlOverride` está (E2E). Se computa UNA vez y se usa TANTO en el polling/download directo
  // (`fetchImpl`→`timedFetch`) COMO en el SDK (submit/upload) — un solo seam cubre las tres fases
  // (submit + poll siguiendo status_url absoluta + download siguiendo response_url absoluta).
  const baseFetch = deps.fetch ?? globalThis.fetch;
  const fetchImpl =
    deps.baseUrlOverride !== undefined && deps.baseUrlOverride !== ''
      ? makeOriginRewriteFetch(baseFetch, deps.baseUrlOverride)
      : baseFetch;

  // El SDK se construye AL VUELO con el `fetch` EFECTIVO (ya envuelto por el seam si aplica).
  // `retry: { maxRetries: 0 }`: NOSOTROS controlamos el 429/`Retry-After` (§6.3.4) — el retry interno
  // del SDK haría el test de 429 no determinista y reintentaría a su ritmo, no al del header.
  function sdk(): SdkFalClient {
    return createFalClient({
      credentials: deps.credentials,
      fetch: fetchImpl,
      retry: { maxRetries: 0 },
      suppressLocalCredentialsWarning: true,
    });
  }

  /** GET con timeout DURO (AbortController): una request colgada aborta a los `timeoutMs`. Un
   *  fallo de red/timeout es `FalProviderError` SIN status (rama de proveedor, no de output). Base
   *  compartida por `authedFetch` (rutas de fal, con `Authorization`) y `download` (output público,
   *  SIN `Authorization`) — la MISMA constante de timeout, no duplicada. */
  async function timedFetch(url: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await fetchImpl(url, { headers, signal: controller.signal });
    } catch (err) {
      throw new FalProviderError(
        `fal request falló (red/timeout): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET directo a una URL de fal CON auth, timeout y manejo tipado de 429 + reintento.
   *  Lo usan el polling (status_url/response_url) — las rutas que el SDK reconstruiría. */
  async function authedFetch(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await timedFetch(url, { Authorization: `Key ${deps.credentials}` });

      if (res.status === 429 && attempt < maxRetries) {
        // 429: respeta el `Retry-After` DEVUELTO (no un backoff inventado), reintenta 1 vez.
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after')) ?? pollIntervalMs;
        await sleep(retryAfterMs);
        continue;
      }
      if (!res.ok) {
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        throw new FalProviderError(`fal respondió ${String(res.status)} en ${url}`, {
          status: res.status,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        });
      }
      return res;
    }
  }

  /**
   * Sube un input (bytes) a fal storage y devuelve su URL pública. Pasa por el rate limiter
   * (cada upload es una request a fal). El SDK maneja el multipart/firma; nosotros solo
   * envolvemos el error en la taxonomía tipada.
   */
  async function uploadInput(
    bytes: Uint8Array,
    opts: { mime?: string; filename?: string } = {},
  ): Promise<string> {
    return limiter.run(async () => {
      // Copia a un ArrayBuffer propio: el Blob no debe compartir el buffer de un Uint8Array
      // que pueda ser una vista sobre un buffer mayor (Node lo hace con frecuencia).
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: opts.mime ?? 'application/octet-stream' });
      try {
        return await sdk().storage.upload(blob);
      } catch (err) {
        throw new FalProviderError(
          `fal storage upload falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  /**
   * Encola una request en el queue de fal (`queue.fal.run`) vía el SDK. Devuelve request_id,
   * status_url y response_url TAL CUAL fal los devuelve — el servicio los persiste antes de
   * pollear. `webhookUrl` es opcional/null en T4.1 (polling-only; el webhook es T4.2).
   *
   * Distingue las dos ramas de error: si el SDK lanza (status del proveedor), es
   * `FalProviderError`; si responde algo sin las URLs esperadas, es `FalResponseError`.
   */
  async function submit(
    endpoint: string,
    input: Record<string, unknown>,
    opts: { webhookUrl?: string } = {},
  ): Promise<FalSubmitResult> {
    return limiter.run(async () => {
      let queued;
      try {
        // `webhookUrl` (T4.2): cuando se pasa, fal NOTIFICA la completion a esa URL con una firma
        // ED25519 (verificada por `verifyFalWebhook`) EN VEZ de que nosotros pollemos. El submit
        // por webhook y el submit por polling (T4.1) son el MISMO submit — solo cambia si el caller
        // pollea la `status_url` devuelta o espera el webhook. `webhookUrl` es opcional: sin él, el
        // comportamiento de T4.1 (polling) es idéntico.
        queued = await sdk().queue.submit(endpoint, {
          input,
          ...(opts.webhookUrl !== undefined ? { webhookUrl: opts.webhookUrl } : {}),
        });
      } catch (err) {
        throw toProviderError(err);
      }
      const { request_id, status_url, response_url, status } = queued;
      if (
        typeof request_id !== 'string' ||
        typeof status_url !== 'string' ||
        typeof response_url !== 'string'
      ) {
        throw new FalResponseError(
          `el submit de fal no devolvió request_id/status_url/response_url válidos: ${JSON.stringify(queued)}`,
        );
      }
      return {
        requestId: request_id,
        statusUrl: status_url,
        responseUrl: response_url,
        status,
        raw: queued,
      };
    });
  }

  /**
   * UN SOLO chequeo de estado sobre la `status_url` DEVUELTA (nunca reconstruida): un GET, y si
   * COMPLETED un segundo GET a `response_url` para el output. Es el cuerpo del loop de `poll`
   * extraído como primitiva puntual (T4.3): la reconciliación del sweeper lo llama UNA vez por tick
   * (no puede bloquear un tick esperando a fal). Cada GET pasa por el rate limiter y `authedFetch`
   * (429/timeout tipados = `FalProviderError`). Un `FAILED`/`ERROR`/`CANCELLED` es el estado
   * `failed` (NO se lanza: el caller decide expirar la fila); un JSON sin `status` conocido es
   * `FalResponseError` (contrato roto, reintentar no cambia nada).
   */
  async function checkStatus(handle: {
    statusUrl: string;
    responseUrl: string;
  }): Promise<FalStatusCheck> {
    const res = await limiter.run(() => authedFetch(handle.statusUrl));
    const payload: unknown = await res.json();
    const status = readStatus(payload);
    if (status === 'COMPLETED') {
      const outRes = await limiter.run(() => authedFetch(handle.responseUrl));
      const output: unknown = await outRes.json();
      return { state: 'completed', output, statusPayload: payload };
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
      return { state: 'failed', falStatus: status, statusPayload: payload };
    }
    if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
      return { state: 'processing', statusPayload: payload };
    }
    throw new FalResponseError(
      `status de fal desconocido en ${handle.statusUrl}: ${JSON.stringify(payload)}`,
    );
  }

  /**
   * POLL hasta COMPLETED sobre la `status_url` DEVUELTA (nunca reconstruida), luego lee la
   * `response_url` para el output. Es un loop sobre `checkStatus` (la MISMA primitiva de reuso que
   * la reconciliación): completed→devuelve, failed→`FalProviderError` (reintentable), processing→
   * espera `pollIntervalMs` y reintenta. Un JSON sin `status` es `FalResponseError` (lo lanza
   * `checkStatus`). Preserva el comportamiento de T4.1 (un `FAILED` de fal sigue siendo un throw
   * para el caller de `poll`); la diferencia es que ahora la lógica de un GET vive en `checkStatus`.
   */
  async function poll(handle: { statusUrl: string; responseUrl: string }): Promise<FalPollResult> {
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      const check = await checkStatus(handle);
      if (check.state === 'completed') {
        return { status: 'COMPLETED', output: check.output, statusPayload: check.statusPayload };
      }
      if (check.state === 'failed') {
        throw new FalProviderError(`fal terminó en estado ${check.falStatus}`, {
          status: undefined,
        });
      }
      await sleep(pollIntervalMs);
    }
    throw new FalProviderError(
      `polling agotó ${String(maxPollAttempts)} intentos sin COMPLETED en ${handle.statusUrl}`,
    );
  }

  /**
   * Descarga el OUTPUT de fal (el PNG en fal.media) con el MISMO timeout duro que el resto de
   * requests: si el CDN cuelga la conexión, aborta a los `timeoutMs` en vez de bloquear
   * `runGenerate` indefinidamente DESPUÉS de haber pagado. La URL de output es firmada y PÚBLICA
   * (no lleva `Authorization: Key`), así que se descarga sin auth. Devuelve la `Response` (el caller
   * la streamea al StorageAdapter). Un fallo/timeout es `FalProviderError` (red → sin status; HTTP
   * de error → con status), coherente con `authedFetch`.
   */
  async function download(url: string): Promise<Response> {
    const res = await timedFetch(url, {});
    if (!res.ok) {
      throw new FalProviderError(`fal output respondió ${String(res.status)} en ${url}`, {
        status: res.status,
      });
    }
    return res;
  }

  return { uploadInput, submit, checkStatus, poll, download };
}

export type FalClient = ReturnType<typeof makeFalClient>;

/** Lee el campo `status` de un payload de status de fal, o null si no lo tiene (contrato roto). */
function readStatus(payload: unknown): string | null {
  if (payload !== null && typeof payload === 'object' && 'status' in payload) {
    const { status } = payload;
    return typeof status === 'string' ? status : null;
  }
  return null;
}

/** Convierte un error del SDK de fal en `FalProviderError` con el status HTTP si lo trae. El
 *  SDK lanza `ApiError { status, body }` en fallos HTTP; se captura el status para la rama
 *  reintentable y el `Retry-After` si es un 429. */
function toProviderError(err: unknown): FalProviderError {
  const message = err instanceof Error ? err.message : JSON.stringify(err);
  if (err !== null && typeof err === 'object' && 'status' in err) {
    const { status } = err;
    if (typeof status === 'number') {
      return new FalProviderError(`fal submit falló con ${String(status)}: ${message}`, { status });
    }
  }
  return new FalProviderError(`fal submit falló: ${message}`);
}
