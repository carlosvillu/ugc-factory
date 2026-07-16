// Integración handler-level de `POST /api/webhooks/fal` (T4.2, api.md §2.6) contra Postgres real:
// el route handler exportado invocado en proceso con `new Request()`, la BD y el boss inyectados
// vía los accessors lazy, y el JWKS servido por msw con una clave ED25519 generada en el test.
//
// PRINCIPIO 9 DE TESTING: el webhook "válido" se firma con el MISMO builder que el verificador de
// producción (`signFalWebhook` → `buildFalWebhookMessage`), así que esto es SELF-CONSISTENCY, NO
// conformance con fal real (eso lo prueba el verifier con un webhook real vía cloudflared). El valor
// permanente está en los INVARIANTES: forjado → 401 + CERO filas nuevas; válido → 200 + persiste +
// encola UN job; replay → no duplica; timestamp fuera de ±5 min → 401 sin tocar la BD.
//
// El webhook NO lleva `withAuth`: su auth es la firma. Por eso no se pasa cookie de sesión — si el
// handler estuviera tras withAuth, fal recibiría 401 y estos tests (y el verifier) fallarían.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { outputDownloadJob } from '@ugc/core/jobs';
import { createGeneration, ensureQueue, getGeneration } from '@ugc/db';
import {
  createTestDatabase,
  makeFalKeypair,
  makeGeneration,
  nowFalTimestamp,
  server,
  signFalWebhook,
  type TestDatabase,
} from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';
import { setDbForTests } from '@/server/db';
import { setBossForTests } from '@/server/boss';
import { POST as falWebhook } from '@/app/api/webhooks/fal/route';

const JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';

// UNA sola clave para toda la suite: el JWKS de módulo del route handler se cachea ≤24 h en el mismo
// proceso, así que servir SIEMPRE la misma clave es correcto (y prueba de paso la caché). La clave
// FORJADA es criptográficamente válida pero NO está en el JWKS → debe ser rechazada.
const { privateKey, jwk } = makeFalKeypair();
const forged = makeFalKeypair();

let tdb: TestDatabase;
let boss: PgBoss;
/** Cuántas veces se pidió el JWKS (para afirmar la caché: 1 fetch para N webhooks). */
let jwksFetches = 0;

function post(body: string, headers: Record<string, string>): Promise<Response> {
  return falWebhook(
    new Request('http://test.local/api/webhooks/fal', { method: 'POST', body, headers }),
  );
}

/** Cuenta los jobs `output.download` en pg-boss (encolados = descarga pendiente). */
async function countDownloadJobs(): Promise<number> {
  const { rows } = await tdb.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1`,
    [outputDownloadJob.name],
  );
  return rows[0]!.n;
}

async function countGenerations(): Promise<number> {
  const { rows } = await tdb.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM generation`);
  return rows[0]!.n;
}

/** Siembra una generación `submitted` con un fal_request_id único (el estado en que un webhook la
 *  encuentra). Devuelve la fila insertada. */
async function seedGeneration(falRequestId: string) {
  return createGeneration(
    tdb.db,
    makeGeneration({ modelProfileId: newUlid(), falRequestId, status: 'submitted' }),
  );
}

/** Body de webhook de fal en ÉXITO (mismo shape que fal manda: status OK + payload con images). */
function okBody(requestId: string): string {
  return JSON.stringify({
    request_id: requestId,
    gateway_request_id: requestId,
    status: 'OK',
    payload: {
      images: [{ url: 'https://fal.media/files/out.png', content_type: 'image/png' }],
      seed: 7,
    },
  });
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  server.use(
    http.get(JWKS_URL, () => {
      jwksFetches += 1;
      return HttpResponse.json({ keys: [jwk] });
    }),
  );
  tdb = await createTestDatabase({ label: 'web:webhook-fal' });
  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* errores operativos del poller: irrelevantes para estos asserts */
  });
  await boss.start();
  // La cola se crea por el MISMO camino que producción (`ensureQueue(outputDownloadJob)` — lo que
  // hace `getBoss()` en web): un test que la creara a mano de otra forma sería más cómodo que la
  // realidad (principio 9). Sin la cola, `boss.send('output.download')` LANZA en pg-boss v12.
  await ensureQueue(boss, outputDownloadJob);
  setDbForTests(tdb.db);
  setBossForTests(boss);
});

afterAll(async () => {
  setDbForTests(undefined);
  setBossForTests(undefined);
  server.close();
  const stopped = new Promise<void>((resolve) => {
    boss.once('stopped', () => {
      resolve();
    });
  });
  const safety = new Promise<void>((resolve) => setTimeout(resolve, 15_000));
  await boss.stop({ graceful: true, timeout: 10_000 });
  await Promise.race([stopped, safety]);
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE generation CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [outputDownloadJob.name]);
});
afterEach(() => {
  server.resetHandlers();
  // Re-registra el handler del JWKS que resetHandlers acaba de quitar (lo pusimos en beforeAll).
  server.use(
    http.get(JWKS_URL, () => {
      jwksFetches += 1;
      return HttpResponse.json({ keys: [jwk] });
    }),
  );
});

describe('POST /api/webhooks/fal (T4.2)', () => {
  it('firma válida: 200, persiste el evento (in_progress) y encola UN job de descarga', async () => {
    const gen = await seedGeneration('req-ok-1');
    const body = okBody('req-ok-1');
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-ok-1',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body,
    });

    const res = await post(body, headers);
    expect(res.status).toBe(200);

    // La generación avanzó a in_progress y persistió el body crudo del webhook.
    const updated = await getGeneration(tdb.db, gen.id);
    expect(updated?.status).toBe('in_progress');
    expect((updated?.falStatusPayload as { status?: string } | null)?.status).toBe('OK');

    // La descarga del output se ENCOLÓ como job del worker (§9.6), NUNCA se hizo en el handler.
    expect(await countDownloadJobs()).toBe(1);
  });

  it('firma forjada (clave que NO está en el JWKS): 401 y la BD queda INTACTA', async () => {
    const gen = await seedGeneration('req-forged');
    const body = okBody('req-forged');
    const before = { gens: await countGenerations(), jobs: await countDownloadJobs() };

    // Firmada por la clave del atacante (válida en sí, pero ausente del JWKS del test).
    const headers = signFalWebhook(forged.privateKey, {
      requestId: 'req-forged',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body,
    });
    const res = await post(body, headers);

    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_signature');
    // CERO efectos: ni filas nuevas, ni jobs, ni cambio de estado de la generación.
    expect(await countGenerations()).toBe(before.gens);
    expect(await countDownloadJobs()).toBe(before.jobs);
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
  });

  it('body MANIPULADO tras firmar (1 byte): 401 sin tocar la BD', async () => {
    const gen = await seedGeneration('req-tamper');
    const signedBody = okBody('req-tamper');
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-tamper',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body: signedBody,
    });
    // Se envía un body con un byte distinto del que se firmó → sha256 distinto → firma no casa.
    const tamperedBody = signedBody.replace('"seed":7', '"seed":8');
    expect(tamperedBody).not.toBe(signedBody);

    const res = await post(tamperedBody, headers);
    expect(res.status).toBe(401);
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
    expect(await countDownloadJobs()).toBe(0);
  });

  it('timestamp fuera de ±5 min: 401 sin tocar la BD (rechazo determinista)', async () => {
    const gen = await seedGeneration('req-old');
    const body = okBody('req-old');
    // Firma VÁLIDA sobre un timestamp de hace 6 min: fal reintenta 10×/2 h, el rechazo debe ser
    // determinista (no depender del estado), así que el mismo webhook siempre da 401.
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-old',
      userId: 'user-1',
      timestamp: nowFalTimestamp() - 360,
      body,
    });

    const res = await post(body, headers);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_signature');
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
    expect(await countDownloadJobs()).toBe(0);
  });

  it('header de firma ausente: 401 sin tocar la BD', async () => {
    const gen = await seedGeneration('req-nosig');
    const body = okBody('req-nosig');
    const res = await post(body, {
      'x-fal-webhook-request-id': 'req-nosig',
      'x-fal-webhook-user-id': 'user-1',
      'x-fal-webhook-timestamp': String(nowFalTimestamp()),
      // sin x-fal-webhook-signature
    });
    expect(res.status).toBe(401);
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
    expect(await countDownloadJobs()).toBe(0);
  });

  it('replay del mismo webhook (mismo request_id): idempotente, no duplica el job', async () => {
    await seedGeneration('req-replay');
    const body = okBody('req-replay');
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-replay',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body,
    });

    // Primer webhook: encola 1.
    expect((await post(body, headers)).status).toBe(200);
    expect(await countDownloadJobs()).toBe(1);

    // Reenvío idéntico (fal reintenta hasta 10×): la generación ya no está `submitted` (pasó a
    // in_progress con su descarga encolada), así que el handler NO re-encola una segunda descarga
    // espuria — devuelve `already_in_progress`. La barrera dura contra el doble-COBRO es además el
    // consumer + UNIQUE fal_request_id (probada en el test del worker); aquí se blinda que el handler
    // no encola dos veces sobre una generación ya en curso.
    const replay = await post(body, headers);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { outcome: string }).outcome).toBe('already_in_progress');
    expect(await countDownloadJobs()).toBe(1);
  });

  it('replay sobre una generación YA completed: 200 no-op, sin nuevo job', async () => {
    const gen = await seedGeneration('req-done');
    // La generación ya se liquidó (el output ya se descargó, el coste registrado).
    await tdb.pool.query(`UPDATE generation SET status = 'completed' WHERE id = $1`, [gen.id]);
    const body = okBody('req-done');
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-done',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body,
    });

    const res = await post(body, headers);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('already_completed');
    // NO se re-encola ni se re-cobra.
    expect(await countDownloadJobs()).toBe(0);
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('completed');
  });

  it('webhook con status ERROR: 200, generación failed, SIN encolar descarga', async () => {
    const gen = await seedGeneration('req-err');
    const body = JSON.stringify({
      request_id: 'req-err',
      status: 'ERROR',
      error: 'Invalid status code: 422',
      payload: { detail: [{ loc: ['body', 'prompt'], msg: 'field required' }] },
    });
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-err',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body,
    });

    const res = await post(body, headers);
    expect(res.status).toBe(200);
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('failed');
    expect(await countDownloadJobs()).toBe(0);
  });

  it('webhook para un request_id DESCONOCIDO: 200 (para que fal deje de reintentar), sin filas nuevas', async () => {
    const body = okBody('req-unknown');
    const before = await countGenerations();
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-unknown',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body,
    });
    const res = await post(body, headers);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('unknown_request');
    // No creamos filas a partir de un webhook (la intención se persiste ANTES del submit).
    expect(await countGenerations()).toBe(before);
    expect(await countDownloadJobs()).toBe(0);
  });

  it('firma VÁLIDA pero body no-JSON: 200 (NO 4xx) para que fal deje de reintentar 10×/2h', async () => {
    // BUG 2: un 4xx tras firma válida hace que fal martillee 10×/2h con un payload que nunca
    // aceptaremos. Un body roto que NO parsea → 200 + warn, no 400.
    const gen = await seedGeneration('req-badjson');
    const brokenBody = '{ no es json';
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-badjson',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body: brokenBody,
    });
    const res = await post(brokenBody, headers);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('unparseable_payload');
    // Sin efectos: la generación no cambia, no se encola nada.
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
    expect(await countDownloadJobs()).toBe(0);
  });

  it('firma VÁLIDA pero payload fuera de contrato: 200 (NO 4xx), sin efectos', async () => {
    const gen = await seedGeneration('req-badpayload');
    // JSON válido pero NO cumple el schema (sin request_id/status).
    const body = JSON.stringify({ foo: 'bar', status: 'MAYBE' });
    const headers = signFalWebhook(privateKey, {
      requestId: 'req-badpayload',
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body,
    });
    const res = await post(body, headers);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('invalid_payload');
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
    expect(await countDownloadJobs()).toBe(0);
  });

  it('BODY REAL de fal (con `error: null`): la firma verifica Y el payload parsea → encola descarga', async () => {
    // REGRESIÓN DE BUG 1 end-to-end: el body REAL que fal POSTeó trae `"error": null`, que con
    // `error: z.string().optional()` hacía fallar el safeParse → 400 → generación colgada. Aquí se
    // firma ESE body real (con la clave de test) y se afirma que atraviesa TODO: firma OK, payload
    // parsea, se encola la descarga. El request_id del body real se siembra como la generación.
    const REAL_BODY =
      '{"error": null, "gateway_request_id": "019f6af7-3088-7f03-b97d-84fec4a3ce12", "payload": {"has_nsfw_concepts": [false], "images": [{"content_type": "image/png", "file_name": "x.png", "file_size": null, "height": 1024, "url": "https://v3b.fal.media/files/b/0aa27b79/x.png", "width": 1024}], "prompt": "p", "seed": 427063521, "timings": {"inference": 1.37}}, "request_id": "019f6af7-3088-7f03-b97d-84fec4a3ce12", "status": "OK"}';
    const realRequestId = '019f6af7-3088-7f03-b97d-84fec4a3ce12';
    const gen = await seedGeneration(realRequestId);
    const headers = signFalWebhook(privateKey, {
      requestId: realRequestId,
      userId: 'user-1',
      timestamp: nowFalTimestamp(),
      body: REAL_BODY,
    });
    const res = await post(REAL_BODY, headers);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('enqueued_download');
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('in_progress');
    expect(await countDownloadJobs()).toBe(1);
  });

  it('la caché del JWKS: N webhooks verificados = 1 solo fetch del JWKS', async () => {
    // El JWKS se cachea a nivel de módulo ≤24 h: varios webhooks en la misma ventana comparten UN
    // fetch. Como la caché es de MÓDULO y persiste entre tests, el contador ya puede ser >0 aquí; la
    // afirmación es que procesar más webhooks NO dispara fetches adicionales.
    const fetchesBefore = jwksFetches;
    for (const rid of ['req-c1', 'req-c2', 'req-c3']) {
      await seedGeneration(rid);
      const body = okBody(rid);
      const headers = signFalWebhook(privateKey, {
        requestId: rid,
        userId: 'user-1',
        timestamp: nowFalTimestamp(),
        body,
      });
      expect((await post(body, headers)).status).toBe(200);
    }
    // Ningún fetch nuevo del JWKS: la caché sirvió los tres.
    expect(jwksFetches).toBe(fetchesBefore);
  });
});
