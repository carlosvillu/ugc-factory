// Helper HTTP compartido por los ingesters de `ingest/` (fast-path T1.3, firecrawl
// T1.4): un `fetch` con timeout duro vía AbortSignal + el mapeo de la excepción de
// aborto a una razón clasificada. Extraído para no mantener dos copias del idiom en
// sync (el timeout es load-bearing: una request colgada bloquearía `ingest()` para
// siempre, o dejaría al verifier sin señal). Cada ingester elige SU propio `timeoutMs`
// (el fast-path 10s; el scrape con render de Firecrawl 60s), así que el timeout es un
// parámetro, no una constante compartida.

/**
 * Construye un `fetchWithTimeout` que aborta cada request a los `timeoutMs`. El `fetch`
 * base se resuelve EN CADA llamada (default perezoso `globalThis.fetch`), no al construir:
 * msw reemplaza el global DESPUÉS de construir el ingester en los tests; capturar la
 * referencia al construir se saltaría el interceptor y las peticiones se irían sin mockear.
 */
export function makeFetchWithTimeout(
  deps: { fetch?: typeof globalThis.fetch },
  timeoutMs: number,
): (url: string, init?: RequestInit) => Promise<Response> {
  const doFetch: typeof globalThis.fetch = (input, init) =>
    (deps.fetch ?? globalThis.fetch)(input, init);
  return (url, init) => doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/** Clasifica la excepción de un `fetchWithTimeout`: `AbortSignal.timeout` lanza un
 *  `TimeoutError`; cualquier otro fallo de red es `'network'`. */
export function classifyFetchError(err: unknown): 'timeout' | 'network' {
  return err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network';
}
