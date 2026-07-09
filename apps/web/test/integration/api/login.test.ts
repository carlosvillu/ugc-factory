// Integración handler-level de la auth (T0.4, api.md §2.5 / §3.2). El route de
// login exportado invocado en proceso con `new Request()` contra Postgres real; el
// hash sembrado en `app_setting` vía el repo de db. Cubre: password correcto → 200
// + cookie httpOnly, incorrecto → 401, rate limit → 429, y que `POST /api/runs`
// sin cookie → 401 (withAuth).
//
// Decisión deliberada (reportada): el rate limit del login se prueba AQUÍ, a nivel
// handler, no a nivel server. El contador es in-memory en el mismo proceso, así que
// llamar al handler N veces lo ejercita con total fidelidad; el paso por el
// middleware/navegador real lo cubre el CUA de T0.4. No existe aún harness de nivel
// 2 (next build + spawn); montarlo solo para esto sería desproporcionado.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedPasswordHashIfAbsent } from '@ugc/db';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { setDbForTests } from '@/server/db';
import {
  hashPassword,
  setMasterKeyForTests,
  SESSION_COOKIE,
  requireSession,
} from '@/server/session';
import { resetRateLimitForTests } from '@/server/rate-limit';
import { POST as login } from '@/app/api/login/route';
import { POST as runs } from '@/app/api/runs/route';

const PASSWORD = 'sup3r-secret-bootstrap-pw';
const TEST_MASTER_KEY = 'login-suite-master-key';

let tdb: TestDatabase;

function postLogin(password: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return login(
    new Request('http://test.local/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ password }),
    }),
    { params: Promise.resolve({}) },
  );
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:login' });
  setDbForTests(tdb.db);
});

afterAll(async () => {
  setDbForTests(undefined);
  setMasterKeyForTests(undefined);
  await tdb.close();
});

beforeEach(async () => {
  resetRateLimitForTests();
  await tdb.pool.query('DELETE FROM app_setting');
  // Cada test parte de un hash sembrado (idempotente) del password conocido.
  await seedPasswordHashIfAbsent(tdb.db, hashPassword(PASSWORD));
  // max=2: el 3.er intento fallido es el primer 429 (fencepost de la Verificación).
  // Distintas IPs por test evitan contaminación del limiter entre casos.
  process.env.LOGIN_MAX_ATTEMPTS = '2';
});
afterEach(() => {
  resetRateLimitForTests();
  delete process.env.LOGIN_MAX_ATTEMPTS;
});

describe('POST /api/login', () => {
  it('password correcto → 200 y una cookie de sesión httpOnly válida', async () => {
    const res = await postLogin(PASSWORD, { 'x-forwarded-for': 'ip-ok' });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/httponly/i);
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));

    // La cookie emitida abre requireSession (firma HMAC válida).
    const value = setCookie!.split(';')[0]!.split('=').slice(1).join('=');
    const req = new Request('http://test.local/', {
      headers: { cookie: `${SESSION_COOKIE}=${value}` },
    });
    expect(requireSession(req)).toBe(true);
  });

  it('password incorrecto → 401 unauthorized, sin cookie', async () => {
    const res = await postLogin('wrong', { 'x-forwarded-for': 'ip-bad' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('unauthorized');
    expect(typeof body.message).toBe('string');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('body inválido (sin password) → 400 validation_error', async () => {
    const res = await postLogin(undefined, { 'x-forwarded-for': 'ip-val' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('validation_error');
  });

  it('password incorrecto 3 veces (misma IP) → el 3.er es 429 rate_limited', async () => {
    // Literal a la Verificación de T0.4 con max=2: los 2 primeros fallos son 401,
    // el 3.er intento es el primer 429 visible.
    const ip = 'ip-brute';
    const r1 = await postLogin('wrong', { 'x-forwarded-for': ip });
    const r2 = await postLogin('wrong', { 'x-forwarded-for': ip });
    const r3 = await postLogin('wrong', { 'x-forwarded-for': ip });
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(429);
    expect(((await r3.json()) as { code: string }).code).toBe('rate_limited');
  });

  it('CUA real: N fallos y LUEGO password correcto en la MISMA IP/ventana → entra', async () => {
    // El camino exacto del navegador (misma IP 'local', misma ventana). Con
    // reset-on-success el acierto NO queda bloqueado por los fallos previos.
    // max=3 aquí para poder demostrar 2 fallos (401) + acierto SIN tocar el 429.
    process.env.LOGIN_MAX_ATTEMPTS = '3';
    const ip = 'ip-real-flow';
    expect((await postLogin('wrong', { 'x-forwarded-for': ip })).status).toBe(401);
    expect((await postLogin('wrong', { 'x-forwarded-for': ip })).status).toBe(401);
    const ok = await postLogin(PASSWORD, { 'x-forwarded-for': ip });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/httponly/i);

    // Y tras el acierto, el contador quedó limpio: un fallo posterior vuelve a 401
    // (no 429 heredado de los fallos previos).
    expect((await postLogin('wrong', { 'x-forwarded-for': ip })).status).toBe(401);
  });

  it('sin hash sembrado → 401 (credencial no configurada), no 500', async () => {
    await tdb.pool.query('DELETE FROM app_setting');
    const res = await postLogin(PASSWORD, { 'x-forwarded-for': 'ip-nohash' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unauthorized');
  });
});

describe('withAuth sobre POST /api/runs', () => {
  it('sin cookie de sesión → 401 unauthorized (JSON, no redirect)', async () => {
    const res = await runs(
      new Request('http://test.local/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'x', nodes: [] }),
      }),
      { params: Promise.resolve({}) }, // withAuth corta antes de usarlo; requerido por la firma withRoute
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unauthorized');
  });
});
