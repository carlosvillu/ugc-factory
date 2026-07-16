// Caché en memoria del JWKS de fal (T4.2, api.md §5): las claves públicas ED25519 con las que se
// verifican las firmas de los webhooks se leen de `https://rest.fal.ai/.well-known/jwks.json` y se
// cachean ≤24 h — fal las rota rara vez, y re-fetchear en cada webhook (fal reintenta 10×/2 h) es
// tráfico inútil que además acopla la latencia del webhook a la de un tercero.
//
// `now` y `fetch` se INYECTAN (patrón de deps de T4.1): así el test asserta "1 fetch para N
// webhooks dentro de la ventana" y "re-fetch tras expirar" de forma determinista, sin timers reales
// (testing/api.md §2.6). El factory devuelve un `getJwks` con la forma EXACTA que consume
// `verifyFalWebhook` de core (`() => Promise<FalJwks>`).
import type { FalJwks } from '@ugc/core/generation';

/** URL oficial del JWKS de fal (api.md §5). Overridable por `deps.url` en tests server-level. */
const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';

/** TTL de la caché: 24 h en ms (el máximo que la doc de fal permite cachear). */
export const FAL_JWKS_TTL_MS = 24 * 60 * 60 * 1000;

export interface MakeFalJwksCacheDeps {
  /** `fetch` inyectable (msw en tests). Default el global. */
  fetch?: typeof globalThis.fetch;
  /** Reloj en ms (inyectable para fijar la ventana de caché en test). Default `Date.now`. */
  now?: () => number;
  /** URL del JWKS. Default `FAL_JWKS_URL`. */
  url?: string;
  /** TTL en ms. Default `FAL_JWKS_TTL_MS`. */
  ttlMs?: number;
}

/**
 * Crea un `getJwks` cacheado ≤24 h. La primera llamada (o la primera tras expirar) hace el fetch;
 * las siguientes dentro de la ventana devuelven la copia cacheada SIN tocar la red. Cachea la
 * PROMESA en vuelo para que N webhooks concurrentes en frío compartan UN solo fetch (no N).
 */
export function makeFalJwksCache(deps: MakeFalJwksCacheDeps = {}): {
  getJwks: () => Promise<FalJwks>;
} {
  const now = deps.now ?? Date.now;
  const url = deps.url ?? FAL_JWKS_URL;
  const ttlMs = deps.ttlMs ?? FAL_JWKS_TTL_MS;

  let cached: { value: Promise<FalJwks>; fetchedAt: number } | undefined;

  async function fetchJwks(): Promise<FalJwks> {
    // `globalThis.fetch` se resuelve EN CADA fetch, no al construir la caché: msw (y cualquier
    // patch del fetch en tests) parchea `globalThis.fetch` DESPUÉS de que este módulo se cargue, y
    // capturar la referencia en el constructor usaría el fetch SIN parchear → red real en tests.
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`fal JWKS: ${url} respondió ${String(res.status)}`);
    }
    const json: unknown = await res.json();
    if (json === null || typeof json !== 'object' || !Array.isArray((json as FalJwks).keys)) {
      throw new Error(`fal JWKS: ${url} no devolvió { keys: [...] }`);
    }
    return json as FalJwks;
  }

  return {
    getJwks(): Promise<FalJwks> {
      const fresh = cached !== undefined && now() - cached.fetchedAt < ttlMs;
      if (cached === undefined || !fresh) {
        const value = fetchJwks();
        cached = { value, fetchedAt: now() };
        // Si el fetch rechaza, invalida la caché para que el próximo intento reintente (no cachear
        // un rechazo permanente): al rechazar, si SEGUIMOS siendo la entrada actual, la borramos.
        const entry = cached;
        value.catch(() => {
          if (cached === entry) cached = undefined;
        });
      }
      return cached.value;
    },
  };
}
