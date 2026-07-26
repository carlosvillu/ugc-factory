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

describe('FalClient.checkStatus — UN chequeo puntual (base de reuso de la reconciliación T4.3)', () => {
  it('COMPLETED: UN GET al status_url + UN GET al response_url; devuelve el output y el statusPayload', async () => {
    const hits: string[] = [];
    server.use(
      http.get(STATUS_URL, ({ request }) => {
        hits.push(request.url);
        return HttpResponse.json({ status: 'COMPLETED', request_id: CANARY });
      }),
      http.get(RESPONSE_URL, ({ request }) => {
        hits.push(request.url);
        return HttpResponse.json({ images: [{ url: 'https://fal.media/x.png' }] });
      }),
    );
    const check = await client().checkStatus({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL });
    expect(check.state).toBe('completed');
    if (check.state !== 'completed') throw new Error('narrowing');
    expect(check.output).toEqual({ images: [{ url: 'https://fal.media/x.png' }] });
    expect(check.statusPayload).toEqual({ status: 'COMPLETED', request_id: CANARY });
    // La URL canaria exacta: no reconstruida. Y NO hay loop — un solo status GET + un output GET.
    expect(hits).toEqual([STATUS_URL, RESPONSE_URL]);
  });

  it('IN_QUEUE/IN_PROGRESS → `processing` SIN un 2º GET de output (no bloquea, no descarga)', async () => {
    for (const s of ['IN_QUEUE', 'IN_PROGRESS'] as const) {
      const hits: string[] = [];
      server.use(
        http.get(STATUS_URL, ({ request }) => {
          hits.push(request.url);
          return HttpResponse.json({ status: s });
        }),
      );
      const check = await client().checkStatus({
        statusUrl: STATUS_URL,
        responseUrl: RESPONSE_URL,
      });
      expect(check.state).toBe('processing');
      // Un solo GET al status: `processing` NO toca response_url (si lo tocara, msw reventaría).
      expect(hits).toEqual([STATUS_URL]);
    }
  });

  it('FAILED/ERROR/CANCELLED → estado `failed` con el falStatus (NO lanza: el caller decide expirar)', async () => {
    for (const s of ['FAILED', 'ERROR', 'CANCELLED'] as const) {
      server.use(http.get(STATUS_URL, () => HttpResponse.json({ status: s })));
      const check = await client().checkStatus({
        statusUrl: STATUS_URL,
        responseUrl: RESPONSE_URL,
      });
      expect(check.state).toBe('failed');
      if (check.state !== 'failed') throw new Error('narrowing');
      expect(check.falStatus).toBe(s);
    }
  });

  it('un status desconocido es FalResponseError (contrato roto, NO un estado)', async () => {
    server.use(http.get(STATUS_URL, () => HttpResponse.json({ status: 'WAT' })));
    await expect(
      client().checkStatus({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL }),
    ).rejects.toBeInstanceOf(FalResponseError);
  });

  it('un 429/timeout del status GET es FalProviderError (NO validación) — rama transitoria', async () => {
    server.use(http.get(STATUS_URL, () => new HttpResponse(null, { status: 503 })));
    await expect(
      client({ maxRetries: 0 }).checkStatus({ statusUrl: STATUS_URL, responseUrl: RESPONSE_URL }),
    ).rejects.toBeInstanceOf(FalProviderError);
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

// T5.17 — el `detail` (body del ApiError de fal) sobrevive en `FalProviderError`. Estos tests recorren el
// SDK REAL (`@fal-ai/client` → `ApiError { status, body }` → `toProviderError`): msw sirve la respuesta de
// error con el content-type y el body EXACTOS que fal emite, para que el fixture no sea verde-decorativo.
// CLAVE (control negativo): el `message` del ApiError es `body.message || statusText` (response.js del SDK)
// → un body SIN `.message` produce `message = statusText` («Forbidden»); el detalle SOLO puede llegar por el
// campo `detail`. Si el fixture metiera «Exhausted balance» en el message, revertir el fix seguiría verde.
describe('FalClient.submit — el `detail` del error de fal se captura (T5.17, diagnóstico de causa)', () => {
  /** Registra en msw una respuesta de error JSON al submit (el scaffold repetido de estos casos). El body
   *  va por-test; `statusText` sin `.message` en el body → el SDK pone `message = statusText`, así que el
   *  detalle SOLO puede llegar por `body`. */
  function respondWith(status: number, statusText: string, body: unknown): void {
    server.use(
      http.post(
        SUBMIT_URL,
        () =>
          new HttpResponse(JSON.stringify(body), {
            status,
            statusText,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
  }

  it('403 «saldo agotado»: body objeto {"detail":...} → FalProviderError.detail lo contiene (no solo el status)', async () => {
    // body SIN `.message` → el SDK pone message='Forbidden'; el detalle SOLO viaja por `body.detail`. Es
    // EXACTAMENTE la forma del bug real (403 «User is locked»).
    respondWith(403, 'Forbidden', { detail: 'User is locked. Reason: Exhausted balance.' });
    const err = await client()
      .submit(ENDPOINT, { prompt: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBe(403);
    // El detalle está presente y nombra la causa concreta — la pista que discrimina saldo vs credencial.
    expect((err as FalProviderError).detail).toContain('Exhausted balance');
    // Y NO llegó de contrabando por el message: el message es el statusText del SDK, sin la causa.
    expect((err as FalProviderError).message).not.toContain('Exhausted balance');
  });

  it('422 validación: body {detail: [...]} (ARRAY de objetos) → detail serializa el array entero, no [object Object]', async () => {
    respondWith(422, 'Unprocessable Entity', {
      detail: [{ loc: ['body', 'voice_id'], msg: 'invalid voice id', type: 'value_error' }],
    });
    const err = await client()
      .submit(ENDPOINT, { prompt: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBe(422);
    // El array de validación se serializa entero (JSON.stringify del body), legible por el operador —
    // NO se pluckea `body.detail` (daría `[object Object]` en un array de objetos).
    const detail = (err as FalProviderError).detail;
    expect(detail).toContain('invalid voice id');
    expect(detail).not.toContain('[object Object]');
  });

  it('422 con URL firmada reflejada del input → la query-string se REDACTA (step_run.error llega al browser)', async () => {
    // El body de 422 de fal refleja el input, que incluye signed URLs (audio_url/image_url con query
    // firmada). Como `step_run.error` viaja al navegador, el `sig` NO debe persistirse: se redacta la query.
    respondWith(422, 'Unprocessable Entity', {
      detail: [
        {
          loc: ['body', 'audio_url'],
          msg: 'invalid audio at https://fal.media/files/x.mp3?sig=SECRET123&exp=999',
          type: 'value_error',
        },
      ],
    });
    const err = await client()
      .submit(ENDPOINT, { prompt: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    const detail = (err as FalProviderError).detail;
    // La causa sigue legible (el path del fichero), pero la firma NO está — se cambió por `?<redacted>`.
    expect(detail).toContain('fal.media/files/x.mp3');
    expect(detail).not.toContain('SECRET123');
    expect(detail).toContain('?<redacted>');
  });

  it('respuesta de error NO-JSON (content-type text/plain): el SDK no pasa body → detail es undefined, NO "undefined"', async () => {
    // 400 (no 5xx) para NO tocar el reintento del SDK: sin content-type JSON, `defaultResponseHandler`
    // lanza `ApiError` SIN body (response.js) → `toProviderError` no encuentra `body` → detail undefined.
    server.use(
      http.post(
        SUBMIT_URL,
        () =>
          new HttpResponse('Bad Request', {
            status: 400,
            statusText: 'Bad Request',
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    );
    const err = await client({ maxRetries: 0 })
      .submit(ENDPOINT, { prompt: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    expect((err as FalProviderError).status).toBe(400);
    // Sin body JSON el SDK no adjunta `body` al ApiError → detail ausente. Nunca la cadena literal.
    expect((err as FalProviderError).detail).toBeUndefined();
  });

  it('body enorme: el detail se recorta a un tamaño acotado (guarda de tamaño del jsonp de step_run.error)', async () => {
    const huge = 'x'.repeat(5000);
    respondWith(403, 'Forbidden', { detail: huge });
    const err = await client()
      .submit(ENDPOINT, { prompt: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FalProviderError);
    // Recortado: mucho menor que el body original de ~5 KB (tope ~2 KB + el «…»).
    expect(((err as FalProviderError).detail ?? '').length).toBeLessThan(2100);
    expect((err as FalProviderError).detail).toContain('…');
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

// SEAM DE INTERCEPCIÓN E2E (`baseUrlOverride`, T4.11 deuda T4.6). Era un `fetch` envuelto en la capa web
// (`makeFalPreviewFetch` de voice-preview.ts); ahora es capacidad de PRIMERA CLASE del FalClient, así que
// cubre por igual el path de web (preview) y el de worker (executors N7). Se inyecta un `fetch` BASE
// espía (no msw) para OBSERVAR la URL que el cliente le pasa DESPUÉS de reescribir por origen — el
// contrato que el landmine de las URLs absolutas de fal exige.
describe('FalClient — baseUrlOverride reescribe POR ORIGEN (no baseUrl-prepend)', () => {
  const FAKE = 'http://127.0.0.1:9931';

  /** Un `fetch` base espía que registra las URLs que recibe y devuelve un 200 vacío. */
  function spyFetch(): { fetch: typeof globalThis.fetch; urls: string[] } {
    const urls: string[] = [];
    const fetch = ((input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof globalThis.fetch;
    return { fetch, urls };
  }

  it('reescribe protocolo+host de una URL de la API de fal al override, PRESERVANDO path+query', async () => {
    const { fetch, urls } = spyFetch();
    // `download` va por `timedFetch`→`fetchImpl` (el path del poll/download que sigue las URLs
    // ABSOLUTAS de fal). Un `baseUrl`-prepend NO reescribiría esto → fuga a la fal real.
    await makeFalClient({
      credentials: 'fal-test-key-not-a-secret',
      fetch,
      baseUrlOverride: FAKE,
    }).download('https://queue.fal.run/fal-ai/kokoro/requests/abc/status?x=1');
    expect(urls[0]).toBe('http://127.0.0.1:9931/fal-ai/kokoro/requests/abc/status?x=1');
  });

  it('deja pasar SIN tocar una URL que NO es un origen de la API de fal (CDN de output fal.media)', async () => {
    const { fetch, urls } = spyFetch();
    await makeFalClient({
      credentials: 'fal-test-key-not-a-secret',
      fetch,
      baseUrlOverride: FAKE,
    }).download('https://fal.media/files/output.wav');
    expect(urls[0]).toBe('https://fal.media/files/output.wav');
  });

  it('sin baseUrlOverride el fetch inyectado se usa TAL CUAL (producción → fal real)', async () => {
    const { fetch, urls } = spyFetch();
    await makeFalClient({ credentials: 'fal-test-key-not-a-secret', fetch }).download(
      'https://queue.fal.run/fal-ai/kokoro/requests/abc/status',
    );
    expect(urls[0]).toBe('https://queue.fal.run/fal-ai/kokoro/requests/abc/status');
  });
});
