// Unit de la caché del JWKS de fal (T4.2, api.md §5): la clave es "1 fetch para N webhooks dentro de
// la ventana ≤24 h, re-fetch tras expirar". Se prueba con `now` y `fetch` inyectados (deterministas,
// sin timers reales). CONTROL NEGATIVO en el test de caché: avanzar el reloj PASADO el TTL debe
// forzar un segundo fetch — si no lo hiciera, la caché nunca expiraría (fuga de rotación de claves).
import { describe, expect, it, vi } from 'vitest';
import { makeFalJwksCache, FAL_JWKS_TTL_MS } from './fal-jwks';

const JWKS = { keys: [{ kty: 'OKP', crv: 'Ed25519', x: 'AAAA' }] };

function fakeFetch(): { fetch: typeof globalThis.fetch; calls: () => number } {
  let calls = 0;
  const fetch = vi.fn(() => {
    calls += 1;
    return Promise.resolve(new Response(JSON.stringify(JWKS), { status: 200 }));
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls: () => calls };
}

describe('makeFalJwksCache', () => {
  it('cachea: N llamadas dentro de la ventana ≤24 h = 1 solo fetch', async () => {
    const { fetch, calls } = fakeFetch();
    const cache = makeFalJwksCache({ fetch, now: () => 1000 });

    const a = await cache.getJwks();
    const b = await cache.getJwks();
    const c = await cache.getJwks();

    expect(a).toEqual(JWKS);
    expect(b).toEqual(JWKS);
    expect(c).toEqual(JWKS);
    expect(calls()).toBe(1); // la señal de la Verificación: NO re-fetchea dentro de la ventana
  });

  it('re-fetchea tras expirar el TTL (control negativo del test de caché)', async () => {
    let now = 1000;
    const { fetch, calls } = fakeFetch();
    const cache = makeFalJwksCache({ fetch, now: () => now });

    await cache.getJwks();
    expect(calls()).toBe(1);

    // Justo antes de expirar: sigue cacheado.
    now = 1000 + FAL_JWKS_TTL_MS - 1;
    await cache.getJwks();
    expect(calls()).toBe(1);

    // Pasado el TTL: re-fetch. Si la caché no expirara, esto seguiría en 1 → clave rotada nunca vista.
    now = 1000 + FAL_JWKS_TTL_MS + 1;
    await cache.getJwks();
    expect(calls()).toBe(2);
  });

  it('llamadas concurrentes en frío comparten UN solo fetch (cachea la promesa)', async () => {
    const { fetch, calls } = fakeFetch();
    const cache = makeFalJwksCache({ fetch, now: () => 1000 });

    const [a, b] = await Promise.all([cache.getJwks(), cache.getJwks()]);
    expect(a).toEqual(JWKS);
    expect(b).toEqual(JWKS);
    expect(calls()).toBe(1);
  });

  it('un fetch fallido NO se cachea: el siguiente intento reintenta', async () => {
    let ok = false;
    const fetch = vi.fn(() =>
      Promise.resolve(
        ok
          ? new Response(JSON.stringify(JWKS), { status: 200 })
          : new Response('nope', { status: 503 }),
      ),
    ) as unknown as typeof globalThis.fetch;
    const cache = makeFalJwksCache({ fetch, now: () => 1000 });

    await expect(cache.getJwks()).rejects.toThrow();
    ok = true;
    // El rechazo no quedó cacheado: el segundo intento hace un fetch nuevo y ahora resuelve.
    await expect(cache.getJwks()).resolves.toEqual(JWKS);
  });
});
