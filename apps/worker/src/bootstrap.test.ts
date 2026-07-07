import { describe, expect, it } from 'vitest';
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

describe('bootstrap del worker', () => {
  it("loggea 'worker ready' a nivel info con el health del contrato compartido", () => {
    const { logger, lines } = makeFakeLogger();

    const health = bootstrap({ logger });

    expect(health).toEqual({ ok: true });
    const ready = lines.find((l) => l.msg === 'worker ready');
    expect(ready).toBeDefined();
    expect(ready?.level).toBe('info');
    expect(ready?.obj).toEqual({ health: { ok: true } });
  });
});
