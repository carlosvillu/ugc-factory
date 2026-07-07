// Factory pino compartido (observability.md §2). Única excepción documentada a
// "core sin I/O": T0.1 exige un logger compartido con redaction y serializers,
// y duplicarlo por app garantiza drift. SOLO este módulo importa pino; todo lo
// demás consume el puerto Logger.
import { createRequire } from 'node:module';
// pino es CJS con `export =`: el default import ES el namespace completo
// (stdSerializers incluido) — el aviso de import-x aquí es un falso positivo.
// eslint-disable-next-line import-x/no-named-as-default
import pino, { type DestinationStream, type LoggerOptions } from 'pino';
import type { Logger } from '../ports';
import { REDACT_PATHS } from './redact';
import { runSerializer, stepSerializer } from './serializers';

export type { Logger };

// Niveles core de pino (API estable) + 'silent'. makeLogger no admite custom levels.
const VALID_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

export interface MakeLoggerOptions {
  name: 'web' | 'worker';
  /**
   * El composition root pasa process.env.LOG_LEVEL ?? 'info'. Se valida AQUÍ
   * (única fuente): con un nivel vacío/inválido pino lanza al crear el logger
   * — en web eso sería un 500 permanente en el primer request — así que cae a
   * 'info' con un warn.
   */
  level: string;
  /** SOLO dev: pino-pretty es transport de desarrollo, jamás en prod. */
  pretty?: boolean;
  /** Costura de test: stream destino inyectable. En producción SIEMPRE stdout (default). */
  destination?: DestinationStream;
}

/**
 * El transport 'pino-pretty' se resuelve en runtime desde ESTE módulo. En el
 * bundle del worker (tsup inlinea @ugc/core; pino-pretty es devDep de core)
 * NO es resoluble y pino lanzaría al crear el logger: se comprueba antes.
 */
function canResolvePinoPretty(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export function makeLogger(opts: MakeLoggerOptions): Logger {
  const level = VALID_LEVELS.has(opts.level) ? opts.level : 'info';
  const prettyRequested = opts.pretty === true;
  // observability.md §2: pretty JAMÁS en prod → solo con NODE_ENV=development
  // Y transport resoluble. En cualquier otro caso, fallback a JSON + warn.
  const prettyAllowed =
    prettyRequested &&
    !opts.destination &&
    process.env.NODE_ENV === 'development' &&
    canResolvePinoPretty();

  const options: LoggerOptions = {
    name: opts.name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }, // observability.md §4
    // eslint-disable-next-line import-x/no-named-as-default-member -- namespace CJS, ver import
    serializers: { err: pino.stdSerializers.err, run: runSerializer, step: stepSerializer }, // §5
    transport: prettyAllowed ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  };
  const logger = opts.destination ? pino(options, opts.destination) : pino(options);

  if (level !== opts.level) {
    logger.warn({ requested_level: opts.level }, "LOG_LEVEL inválido: fallback a 'info'");
  }
  if (prettyRequested && !prettyAllowed) {
    logger.warn(
      { node_env: process.env.NODE_ENV ?? null },
      'pino-pretty no disponible fuera de dev: fallback a JSON estructurado',
    );
  }
  return logger;
}
