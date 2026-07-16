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
 */
export class FalResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FalResponseError';
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

export interface FalClientDeps {
  /** La API key de fal EN CLARO (el caller la lee de env/secretos). */
  credentials: string;
  /** `fetch` inyectable — msw en tests, global en producción. Lo usa TANTO el SDK (submit,
   *  upload) como el polling directo, para que un solo mock intercepte todo. */
  fetch?: typeof globalThis.fetch;
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
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  // El SDK se construye AL VUELO con el `fetch` inyectado. `retry: { maxRetries: 0 }`:
  // NOSOTROS controlamos el 429/`Retry-After` (§6.3.4) — el retry interno del SDK haría el
  // test de 429 no determinista y reintentaría a su ritmo, no al del header.
  function sdk(): SdkFalClient {
    return createFalClient({
      credentials: deps.credentials,
      ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
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
  ): Promise<FalSubmitResult> {
    return limiter.run(async () => {
      let queued;
      try {
        queued = await sdk().queue.submit(endpoint, { input });
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
   * POLL hasta COMPLETED sobre la `status_url` DEVUELTA (nunca reconstruida), luego lee la
   * `response_url` para el output. Cada GET pasa por el rate limiter y por `authedFetch`
   * (429/timeout tipados). Un `FAILED`/estado desconocido es `FalProviderError` (algo salió
   * mal en fal, reintentable); un JSON sin `status` es `FalResponseError`.
   */
  async function poll(handle: { statusUrl: string; responseUrl: string }): Promise<FalPollResult> {
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      const res = await limiter.run(() => authedFetch(handle.statusUrl));
      const payload: unknown = await res.json();
      const status = readStatus(payload);
      if (status === 'COMPLETED') {
        const outRes = await limiter.run(() => authedFetch(handle.responseUrl));
        const output: unknown = await outRes.json();
        return { status: 'COMPLETED', output, statusPayload: payload };
      }
      if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
        throw new FalProviderError(`fal terminó en estado ${status}`, { status: undefined });
      }
      if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS') {
        throw new FalResponseError(
          `status de fal desconocido en ${handle.statusUrl}: ${JSON.stringify(payload)}`,
        );
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

  return { uploadInput, submit, poll, download };
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
