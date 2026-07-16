import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { server } from '@ugc/test-utils';

import { FalProviderError, FalResponseError, makeFalClient } from './fal-client';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const ENDPOINT = 'fal-ai/flux-2';
const SUBMIT_URL = `https://queue.fal.run/${ENDPOINT}`;
// status_url/response_url llevan un segmento CANARIO que NO se puede derivar del endpoint:
// si el cliente RECONSTRUYERA la URL (como hace `queue.status` del SDK), pegaría a otra ruta
// y msw (`onUnhandledRequest: 'error'`) reventaría. Es la red que exige external-apis.md §4.3.
const CANARY = 'CANARY-x9z7';
const STATUS_URL = `https://queue.fal.run/${ENDPOINT}/requests/${CANARY}/status`;
const RESPONSE_URL = `https://queue.fal.run/${ENDPOINT}/requests/${CANARY}`;

const SUBMIT_BODY = {
  request_id: CANARY,
  status_url: STATUS_URL,
  response_url: RESPONSE_URL,
  cancel_url: `${RESPONSE_URL}/cancel`,
  status: 'IN_QUEUE',
  queue_position: 0,
};

/** Espera no-op: los tests no esperan de verdad (determinismo, principio 7). */
const noSleep = (): Promise<void> => Promise.resolve();

/** Cliente con `sleep` inyectado (no espera de verdad) y sin fetch inyectado (msw intercepta
 *  el fetch global). Concurrencia/timeouts por defecto salvo override. */
function client(
  overrides: Parameters<typeof makeFalClient>[0] extends infer T ? Partial<T> : never = {},
) {
  return makeFalClient({
    credentials: 'fal-test-key-not-a-secret',
    sleep: noSleep,
    pollIntervalMs: 0,
    ...overrides,
  });
}

describe('FalClient.submit — persiste las URLs DEVUELTAS por fal', () => {
  it('devuelve request_id/status_url/response_url tal cual los da el submit', async () => {
    server.use(http.post(SUBMIT_URL, () => HttpResponse.json(SUBMIT_BODY)));
    const res = await client().submit(ENDPOINT, { prompt: 'x' });
    expect(res.requestId).toBe(CANARY);
    expect(res.statusUrl).toBe(STATUS_URL);
    expect(res.responseUrl).toBe(RESPONSE_URL);
    expect(res.status).toBe('IN_QUEUE');
  });

  it('un submit sin las URLs esperadas es FalResponseError (validación, NO proveedor)', async () => {
    server.use(http.post(SUBMIT_URL, () => HttpResponse.json({ request_id: CANARY })));
    await expect(client().submit(ENDPOINT, { prompt: 'x' })).rejects.toBeInstanceOf(
      FalResponseError,
    );
  });
});

describe('FalClient.poll — usa la status_url DEVUELTA, nunca una reconstruida (§4.3)', () => {
  it('pollea EXACTAMENTE la status_url canaria y descarga el output de response_url', async () => {
    const polled: string[] = [];
    server.use(
      // El handler de status SOLO existe en la URL canaria. Un cliente que reconstruyera la
      // URL desde el endpoint pegaría a otra ruta → onUnhandledRequest:'error' revienta.
      http.get(STATUS_URL, ({ request }) => {
        polled.push(request.url);
        return HttpResponse.json({ status: 'COMPLETED', request_id: CANARY });
      }),
      http.get(RESPONSE_URL, () =>
        HttpResponse.json({
          images: [{ url: 'https://fal.media/out.png', width: 1024, height: 1024 }],
        }),
      ),
    );

    const res = await client().poll({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL });
    expect(res.status).toBe('COMPLETED');
    expect(polled).toEqual([STATUS_URL]);
    expect(res.output).toMatchObject({ images: [{ url: 'https://fal.media/out.png' }] });
  });

  it('transita IN_QUEUE → IN_PROGRESS → COMPLETED por polling', async () => {
    const sequence = ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'];
    let i = 0;
    server.use(
      http.get(STATUS_URL, () => HttpResponse.json({ status: sequence[i++] ?? 'COMPLETED' })),
      http.get(RESPONSE_URL, () =>
        HttpResponse.json({ images: [{ url: 'https://fal.media/o.png' }] }),
      ),
    );
    const res = await client().poll({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL });
    expect(res.status).toBe('COMPLETED');
    expect(i).toBe(3); // se polleó las 3 veces (no cortó antes ni de más)
  });

  it('un estado FAILED de fal es FalProviderError (reintentable), no FalResponseError', async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.json({ status: 'FAILED' })));
    await expect(
      client().poll({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL }),
    ).rejects.toBeInstanceOf(FalProviderError);
  });

  it('un status sin campo `status` es FalResponseError (contrato roto, NO reintentable)', async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.json({ nope: true })));
    await expect(
      client().poll({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL }),
    ).rejects.toBeInstanceOf(FalResponseError);
  });
});

describe('FalClient — errores tipados por CAUSA (principio 9)', () => {
  it('un 4xx del submit es FalProviderError con el status HTTP capturado', async () => {
    server.use(http.post(SUBMIT_URL, () => new HttpResponse(null, { status: 422 })));
    const err = await client()
      .submit(ENDPOINT, { prompt: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBe(422);
  });

  it('un 401 del polling es FalProviderError status 401 (NO validación)', async () => {
    server.use(http.get(STATUS_URL, () => new HttpResponse(null, { status: 401 })));
    const err = await client()
      .poll({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBe(401);
  });

  it('un timeout/red es FalProviderError SIN status (rama de proveedor, no de output)', async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.error()));
    const err = await client({ maxRetries: 0 })
      .poll({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBeUndefined();
  });
});

describe('FalClient — 429 + Retry-After (§4.4)', () => {
  it('espera lo que dice Retry-After y reintenta UNA vez', async () => {
    let calls = 0;
    server.use(
      http.get(STATUS_URL, () => {
        calls += 1;
        if (calls === 1) {
          return new HttpResponse(null, { status: 429, headers: { 'retry-after': '2' } });
        }
        return HttpResponse.json({ status: 'COMPLETED' });
      }),
      http.get(RESPONSE_URL, () =>
        HttpResponse.json({ images: [{ url: 'https://fal.media/o.png' }] }),
      ),
    );
    const waited: number[] = [];
    const c = client({
      maxRetries: 1,
      sleep: (ms) => {
        waited.push(ms);
        return Promise.resolve();
      },
    });
    const res = await c.poll({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL });
    expect(res.status).toBe('COMPLETED');
    expect(calls).toBe(2);
    // Esperó al menos lo que el header pide (2s = 2000ms), no un backoff inventado.
    expect(waited).toContain(2000);
  });

  it('si el 429 persiste tras los reintentos, es FalProviderError status 429', async () => {
    server.use(
      http.get(
        STATUS_URL,
        () => new HttpResponse(null, { status: 429, headers: { 'retry-after': '1' } }),
      ),
    );
    const err = await client({ maxRetries: 1, sleep: noSleep })
      .poll({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBe(429);
  });
});

describe('FalClient — rate limiter (~8 concurrentes, §6.3.4)', () => {
  it('nunca hay más de `concurrency` requests en vuelo', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    // Cada submit tarda un poco (delay controlado): el handler cuenta en vuelo.
    server.use(
      http.post(SUBMIT_URL, async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return HttpResponse.json(SUBMIT_BODY);
      }),
    );
    const c = client({ concurrency: 8 });
    // 20 submits en paralelo: sin limiter, los 20 estarían en vuelo a la vez.
    await Promise.all(Array.from({ length: 20 }, () => c.submit(ENDPOINT, { prompt: 'x' })));
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(maxInFlight).toBeGreaterThan(1); // control: SÍ hubo concurrencia real
  });
});

describe('FalClient.download — descarga del output con timeout duro', () => {
  const OUTPUT_URL = 'https://fal.media/files/out.png';

  it('descarga un output OK y devuelve la Response para streamear', async () => {
    server.use(
      http.get(OUTPUT_URL, () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    const res = await client().download(OUTPUT_URL);
    expect(res.ok).toBe(true);
    expect(res.body).not.toBeNull();
  });

  it('NO manda header Authorization (la URL de output es firmada y pública)', async () => {
    let sawAuth: string | null = 'unset';
    server.use(
      http.get(OUTPUT_URL, ({ request }) => {
        sawAuth = request.headers.get('authorization');
        return HttpResponse.arrayBuffer(new Uint8Array([1]).buffer);
      }),
    );
    await client().download(OUTPUT_URL);
    expect(sawAuth).toBeNull(); // sin `Key <credentials>` — a diferencia del polling
  });

  it('un 403 del CDN es FalProviderError con status', async () => {
    server.use(http.get(OUTPUT_URL, () => new HttpResponse(null, { status: 403 })));
    const err = await client()
      .download(OUTPUT_URL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBe(403);
  });

  // ROBUSTEZ (fix de code-review): un CDN que cuelga la conexión aborta al timeout en vez de
  // bloquear para siempre DESPUÉS de haber pagado. Con `timeoutMs` pequeño, un handler que nunca
  // resuelve dispara el AbortController → FalProviderError SIN status. Control negativo: sin el
  // AbortController este test quedaría colgado hasta el timeout de vitest.
  it('un output que nunca responde aborta al timeout → FalProviderError sin status', async () => {
    const never = new Promise<Response>(() => {
      /* nunca resuelve: simula un CDN que cuelga la conexión */
    });
    server.use(http.get(OUTPUT_URL, () => never));
    const err = await client({ timeoutMs: 40 })
      .download(OUTPUT_URL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBeUndefined();
  });
});
