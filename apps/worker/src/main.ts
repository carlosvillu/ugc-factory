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

// bootstrap es async desde T0.2 (ping a Postgres). Top-level await en ESM: el
// worker anuncia su estado antes de entrar en el keep-alive. no-floating-promises
// (tooling §2) obliga a await aquí — un ping perdido dejaría el boot a medias.
// Desde T0.6 devuelve el handle de pg-boss (undefined si la BD no está).
const { boss } = await bootstrap({ logger });

// Daemon: el proceso queda residente hasta SIGINT/SIGTERM. Cuando pg-boss arranca
// sus workers ya mantienen vivo el event loop; el timer cubre el modo degradado
// (sin BD, sin boss) para que el proceso siga escuchando señales en vez de morir.
const keepAlive = setInterval(() => {
  /* noop: mantiene vivo el event loop */
}, 60_000);

// ≥ p99 del job más largo aceptable de perder; para T0.6 (solo demo.noop) es
// holgado. boss.stop({ graceful }) deja de hacer polling y espera a los handlers
// activos hasta el timeout (jobs.md §9).
const SHUTDOWN_TIMEOUT_MS = 120_000;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, 'worker shutting down');
  // Sin process.exit(): un exit inmediato compite con el flush de pino y pierde
  // la última línea. Se paran los recursos, se retira el timer, el event loop se
  // vacía y el proceso muere solo con exitCode 0.
  //
  // El handler de señal es fire-and-forget (`void shutdown(...)`) y `boss.stop()`
  // PUEDE rechazar (BD caída mid-shutdown, error de pool). Sin este try/finally un
  // rechazo saltaría el cierre limpio y dejaría un exit-code impredecible: el
  // `finally` garantiza el invariante de T0.1 (drenar el timer + exitCode 0
  // SIEMPRE), y el `catch` deja rastro del fallo de drain en vez de tragarlo.
  try {
    await boss?.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
  } catch (err) {
    logger.error({ err }, 'shutdown: boss.stop() falló; el proceso muere igual');
  } finally {
    clearInterval(keepAlive);
    process.exitCode = 0;
  }
}

// `once`: una segunda señal recupera el comportamiento por defecto del runtime
// (kill inmediato) — escape hatch deliberado si el drain se atascara.
// `void shutdown(...)`: el handler de señal no puede ser async (no-misused-promises).
process.once('SIGINT', (signal) => void shutdown(signal));
process.once('SIGTERM', (signal) => void shutdown(signal));
