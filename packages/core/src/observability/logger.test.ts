import { describe, expect, it } from 'vitest';
import { makeLogger } from './logger';

/** Captura las líneas JSON que emite el logger vía la costura `destination`. */
function captureLogger(level = 'info') {
  const lines: string[] = [];
  const logger = makeLogger({
    name: 'worker',
    level,
    destination: {
      write(msg: string) {
        lines.push(msg);
      },
    },
  });
  const last = (): Record<string, unknown> =>
    JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
  return { logger, lines, last };
}

describe('makeLogger', () => {
  it('emite JSON estructurado con el name del proceso y el mensaje', () => {
    const { logger, last } = captureLogger();
    logger.info({ foo: 'bar' }, 'hello');
    expect(last()).toMatchObject({ name: 'worker', msg: 'hello', foo: 'bar' });
  });

  it('un child propaga la correlación run_id/step_id/request_id en cada línea', () => {
    const { logger, last } = captureLogger();
    const child = logger.child({ run_id: 'r1', step_id: 's1', request_id: 'q1' });
    child.info({}, 'worker ready');
    expect(last()).toMatchObject({
      name: 'worker',
      run_id: 'r1',
      step_id: 's1',
      request_id: 'q1',
      msg: 'worker ready',
    });
  });

  it('respeta el nivel: debug no sale con level=info', () => {
    const { logger, lines } = captureLogger('info');
    logger.debug({}, 'invisible');
    expect(lines).toHaveLength(0);
  });

  it('redacta secretos declarados en REDACT_PATHS sin depender del call site', () => {
    const { logger, lines, last } = captureLogger();
    logger.info(
      { config: { apiKey: 'super-secret-key', token: 'tok-123' }, ANTHROPIC_API_KEY: 'sk-real' },
      'config cargada',
    );
    const line = last();
    expect(lines.at(-1)).not.toContain('super-secret-key');
    expect(lines.at(-1)).not.toContain('tok-123');
    expect(lines.at(-1)).not.toContain('sk-real');
    expect(line.config).toEqual({ apiKey: '[REDACTED]', token: '[REDACTED]' });
    expect(line.ANTHROPIC_API_KEY).toBe('[REDACTED]');
  });

  it('serializa errores SOLO bajo la clave err, con message, type y stack', () => {
    const { logger, last } = captureLogger();
    logger.error({ err: new Error('boom') }, 'step failed');
    const err = last().err as { message: string; type: string; stack?: string };
    expect(err.message).toBe('boom');
    expect(err.type).toBe('Error');
    expect(err.stack).toContain('boom');
  });

  it("LOG_LEVEL vacío no revienta: fallback a 'info' + warn (pino lanza con level='')", () => {
    const { logger, lines } = captureLogger('');
    const warn = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(warn.msg).toBe("LOG_LEVEL inválido: fallback a 'info'");
    expect(warn.requested_level).toBe('');
    logger.info({}, 'visible con info');
    logger.debug({}, 'invisible con info');
    expect(lines.some((l) => l.includes('visible con info'))).toBe(true);
    expect(lines.some((l) => l.includes('invisible con info'))).toBe(false);
  });

  it("nivel inválido ('verbose') → fallback a 'info' + warn con el nivel pedido", () => {
    const { lines } = captureLogger('verbose');
    const warn = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(warn.requested_level).toBe('verbose');
    expect(warn.msg).toBe("LOG_LEVEL inválido: fallback a 'info'");
  });

  it("'silent' es un nivel válido: no emite nada, tampoco warns", () => {
    const { logger, lines } = captureLogger('silent');
    logger.info({}, 'nada');
    expect(lines).toHaveLength(0);
  });

  it('pretty fuera de dev NO crea transport: fallback a JSON + warn (fix del worker bundleado)', () => {
    // NODE_ENV=test bajo vitest → pretty denegado por regla (observability.md §2:
    // pretty SOLO dev), sin depender de si pino-pretty es resoluble aquí.
    const lines: string[] = [];
    const logger = makeLogger({
      name: 'worker',
      level: 'info',
      pretty: true,
      destination: {
        write(msg: string) {
          lines.push(msg);
        },
      },
    });
    const warn = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(warn.msg).toBe('pino-pretty no disponible fuera de dev: fallback a JSON estructurado');
    logger.info({ health: { ok: true } }, 'worker ready');
    // La salida sigue siendo JSON estructurado parseable línea a línea:
    expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({ msg: 'worker ready' });
  });

  it('aplica los serializers de dominio run/step: proyección mínima, no el jsonb entero', () => {
    const { logger, last } = captureLogger();
    logger.info(
      {
        run: { id: 'run-1', status: 'running', matrix: { huge: 'payload' } },
        step: { id: 'step-1', node_key: 'ingest', status: 'queued', input_refs: ['a', 'b'] },
      },
      'transition applied',
    );
    expect(last().run).toEqual({ id: 'run-1', status: 'running' });
    expect(last().step).toEqual({ id: 'step-1', node_key: 'ingest', status: 'queued' });
  });
});
