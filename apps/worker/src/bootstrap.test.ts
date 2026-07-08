import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '@ugc/core';
import { bootstrap } from './bootstrap';

interface LoggedLine {
  level: keyof Omit<Logger, 'child'>;
  obj: object;
  msg?: string;
}

function makeFakeLogger(): { logger: Logger; lines: LoggedLine[] } {
  const lines: LoggedLine[] = [];
  const record =
    (level: LoggedLine['level']) =>
    (obj: object, msg?: string): void => {
      lines.push({ level, obj, msg });
    };
  const logger: Logger = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  };
  return { logger, lines };
}

// El ping a Postgres (@ugc/db) se controla vía DATABASE_URL. Sin cadena, el
// ping devuelve `false` sin lanzar ni abrir socket: db:false determinista y
// hermético (sin Docker), que es lo que anuncia el worker cuando la BD no está.
// El camino db:true real es la Verificación manual de T0.2 / integración T0.3;
// el mapeo de éxito del ping se fija en el unit de @ugc/db (health.test.ts).
describe('bootstrap del worker', () => {
  const original = process.env.DATABASE_URL;
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("loggea 'worker ready' a nivel info con el health del contrato compartido (db:false sin BD)", async () => {
    const { logger, lines } = makeFakeLogger();

    const { health, boss } = await bootstrap({ logger });

    expect(health).toEqual({ ok: true, db: false });
    // Sin BD alcanzable: pg-boss NO arranca (degradación de T0.2 preservada).
    expect(boss).toBeUndefined();
    const ready = lines.find((l) => l.msg === 'worker ready');
    expect(ready).toBeDefined();
    expect(ready?.level).toBe('info');
    expect(ready?.obj).toEqual({ health: { ok: true, db: false } });
  });

  it('no lanza ni cuelga el boot cuando DATABASE_URL apunta a un puerto muerto (degradación)', async () => {
    process.env.DATABASE_URL = 'postgres://ugc:ugc@127.0.0.1:59999/ugc';
    const { logger } = makeFakeLogger();

    const { health, boss } = await bootstrap({ logger });

    expect(health).toEqual({ ok: true, db: false });
    // Puerto muerto → ping false → pg-boss no arranca (no cuelga el boot).
    expect(boss).toBeUndefined();
  });
});
