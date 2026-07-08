import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HealthStatusSchema } from '@ugc/core/contracts';
import { GET } from './route';

// LOG_LEVEL=silent lo fija test.env en vitest.config.ts: el logger de web es
// lazy y se memoiza en la primera request — el env debe estar puesto ANTES de
// que cualquier test lo dispare, sin depender del orden de hooks.
//
// El ping a Postgres (@ugc/db) se controla vía DATABASE_URL. Sin cadena, el
// ping devuelve `false` sin lanzar ni abrir socket: db:false determinista y
// hermético (sin Docker). El camino db:true real (Postgres levantado) es la
// Verificación manual de T0.2 y la integración de T0.3; el mapeo de éxito del
// ping se fija en el unit de @ugc/db (health.test.ts). Aquí probamos el
// cableado y la degradación observable del route.

describe('GET /api/health', () => {
  const original = process.env.DATABASE_URL;
  beforeEach(() => {
    delete process.env.DATABASE_URL; // sin BD → db:false determinista
  });
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it('devuelve 200 con {ok:true, db:false} (degradación sin BD) conforme al schema', async () => {
    const res = await GET(new Request('http://localhost:3000/api/health'));

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(HealthStatusSchema.parse(body)).toEqual({ ok: true, db: false });
  });

  it('degrada sin lanzar ni tumbar la app cuando DATABASE_URL apunta a un puerto muerto', async () => {
    // Endpoint local sin listener → ECONNREFUSED rápido: la mitad "trampa" de
    // la Verificación (db:false sin 500 ni cuelgue).
    process.env.DATABASE_URL = 'postgres://ugc:ugc@127.0.0.1:59999/ugc';

    const res = await GET(new Request('http://localhost:3000/api/health'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, db: false });
  });

  it('respeta el x-request-id entrante sin romper la respuesta (correlación)', async () => {
    const res = await GET(
      new Request('http://localhost:3000/api/health', {
        headers: { 'x-request-id': 'req-fixture-1' },
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, db: false });
  });
});
