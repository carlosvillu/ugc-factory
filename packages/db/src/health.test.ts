import { describe, expect, it, vi } from 'vitest';
import {
  PING_CONNECT_TIMEOUT_MS,
  PING_STATEMENT_TIMEOUT_MS,
  pingDb,
  type PingRunner,
} from './health';

// Unit del ping de conexión (T0.2). El runner es inyectable: db:true se prueba
// con un doble que resuelve (sin Postgres levantado — eso es integración T0.3),
// y db:false por sus tres caminos de degradación (sin cadena, error de
// conexión, timeout). La mitad "trampa" de la Verificación es justo db:false
// rápido y sin lanzar.

describe('pingDb (T0.2)', () => {
  it('db:true cuando el runner resuelve (SELECT 1 OK)', async () => {
    const runner: PingRunner = vi.fn(async () => {
      /* conexión + SELECT 1 OK */
    });

    await expect(
      pingDb({ connectionString: 'postgres://ugc:ugc@db:5432/ugc', runner }),
    ).resolves.toBe(true);
    expect(runner).toHaveBeenCalledWith('postgres://ugc:ugc@db:5432/ugc');
  });

  it('db:false SIN lanzar cuando no hay DATABASE_URL (no abre socket)', async () => {
    const runner: PingRunner = vi.fn(async () => {
      /* nunca debería llegar aquí */
    });

    await expect(pingDb({ connectionString: undefined, runner })).resolves.toBe(false);
    // Sin cadena no se intenta conectar: cortocircuito antes del runner.
    expect(runner).not.toHaveBeenCalled();
  });

  it('db:false SIN propagar cuando el runner rechaza (conexión rechazada / query falla)', async () => {
    const runner: PingRunner = vi.fn(() =>
      Promise.reject(new Error('ECONNREFUSED 127.0.0.1:5432')),
    );

    // El contrato es que NUNCA lanza: es lo que permite a /api/health degradar
    // a {ok:true, db:false} sin un 500.
    await expect(
      pingDb({ connectionString: 'postgres://ugc:ugc@127.0.0.1:5432/ugc', runner }),
    ).resolves.toBe(false);
  });

  it('db:false cuando el runner rechaza por timeout (Postgres colgado)', async () => {
    const runner: PingRunner = vi.fn(() =>
      Promise.reject(Object.assign(new Error('connection timeout'), { code: 'ETIMEDOUT' })),
    );

    await expect(
      pingDb({ connectionString: 'postgres://ugc:ugc@db:5432/ugc', runner }),
    ).resolves.toBe(false);
  });

  it('el runner real ECONNREFUSED rápido contra un puerto muerto → db:false (sin Docker)', async () => {
    // Sin runner inyectado: ejercita el pgPingRunner real. Un puerto local sin
    // listener rechaza la conexión de inmediato (no espera al timeout), así que
    // el test es determinista y rápido — no depende de un Postgres levantado.
    await expect(
      pingDb({ connectionString: 'postgres://ugc:ugc@127.0.0.1:59999/ugc' }),
    ).resolves.toBe(false);
  });

  it('los timeouts del ping son cortos (degradación rápida, no el default del driver)', () => {
    // Fija el presupuesto de la Verificación: con Postgres caído la respuesta
    // no puede colgarse esperando el timeout por defecto de pg.
    expect(PING_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
    expect(PING_STATEMENT_TIMEOUT_MS).toBeLessThanOrEqual(2_000);
  });
});
