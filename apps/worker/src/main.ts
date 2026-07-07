import { makeLogger } from '@ugc/core/observability';
import { bootstrap } from './bootstrap';

// Composition root del worker: el factory se invoca UNA vez por proceso
// (observability.md §2); nada en module scope de los módulos de core.
const logger = makeLogger({
  name: 'worker',
  level: process.env.LOG_LEVEL ?? 'info',
  // JSON SIEMPRE por defecto (la Verificación de T0.1 lee JSON del stdout).
  // pino-pretty es opt-in explícito para humanos (LOG_PRETTY=1) y makeLogger
  // solo lo honra en NODE_ENV=development con el transport resoluble.
  pretty: process.env.LOG_PRETTY === '1',
});

bootstrap({ logger });

// Daemon: el proceso queda residente hasta SIGINT/SIGTERM. pg-boss (T0.6)
// sustituirá este keep-alive por sus workers reales.
const keepAlive = setInterval(() => {
  /* noop: mantiene vivo el event loop */
}, 60_000);

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'worker shutting down');
  // Sin process.exit(): un exit inmediato compite con el flush de pino y pierde
  // la última línea de forma intermitente. Se retira el único timer, el event
  // loop se vacía y el proceso muere solo con exitCode 0 — plantilla del
  // graceful shutdown real de T0.6 (boss.stop() → pool.end() → drain).
  clearInterval(keepAlive);
  process.exitCode = 0;
}

// `once`: una segunda señal recupera el comportamiento por defecto del runtime
// (kill inmediato) — escape hatch deliberado si el drain se atascara.
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
