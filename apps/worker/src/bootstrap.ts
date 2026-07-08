import type { Logger } from '@ugc/core';
import type { HealthStatus } from '@ugc/core/contracts';
import { pingDb } from '@ugc/db';
import type { PgBoss } from 'pg-boss';
import { noopJob } from '@ugc/core/jobs';
import { createBoss } from './boss';
import { type FailDecider, neverFail, randomFailRate } from './consumers/demo-noop';
import { makeJobQueue } from './job-queue';

export interface BootstrapDeps {
  logger: Logger;
  /** Cadena de conexión; default `process.env.DATABASE_URL`. Explícita en tests. */
  databaseUrl?: string;
  /** Decisor de fallo del consumer `demo.noop` (Verificación/tests). */
  noopShouldFail?: FailDecider;
}

export interface BootstrapResult {
  health: HealthStatus;
  /** Handle de pg-boss si arrancó (BD alcanzable); `undefined` en degradación. */
  boss?: PgBoss;
}

/**
 * Arranque del worker (architecture.md §6): cablea EAGER — fallar en el boot es
 * una feature de un daemon, no un bug. En T0.2 hace el ping de conexión a
 * Postgres al arrancar; en T0.6 arranca pg-boss (start + colas + consumers) SOLO
 * si la BD está alcanzable, y devuelve el handle para que el shutdown lo pare.
 *
 * Degradación deliberada (continuidad de la decisión de T0.2, no una nueva):
 * si el ping da `db:false` (BD caída o sin cadena) NO se arranca pg-boss y el
 * worker anuncia el estado y espera — un daemon que muere en cada reinicio de la
 * BD es peor. La distinción es reachability, no "env presente": una BD
 * ALCANZABLE-pero-rota al arrancar pg-boss SÍ tumba el boot (no se traga el
 * error de `boss.start()`), que es exactamente lo que architecture.md §6 pide.
 */
export async function bootstrap({
  logger,
  databaseUrl = process.env.DATABASE_URL,
  noopShouldFail,
}: BootstrapDeps): Promise<BootstrapResult> {
  // Ping compartido con web vía @ugc/db (timeouts cortos, cualquier error →
  // false, nunca lanza).
  const db = await pingDb({ connectionString: databaseUrl });

  // El `satisfies` es el canario de compilación contra el contrato de core (T0.1).
  const health = { ok: true, db } satisfies HealthStatus;

  // Decisor de fallo del consumer `demo.noop`, resuelto AQUÍ (único sitio) por
  // precedencia: inyección explícita (tests, determinista) > env de la
  // Verificación (`DEMO_NOOP_FAIL_RATE=0.3` → 30% per-intento aleatorio) >
  // `neverFail` (default: no fallar salvo config). Ya resuelto ⇒ el resto de la
  // cadena lo recibe como prop requerida (sin defaults enterrados).
  const shouldFail = noopShouldFail ?? failRateFromEnv() ?? neverFail;

  let boss: PgBoss | undefined;
  if (db && databaseUrl !== undefined) {
    // BD alcanzable: pg-boss DEBE arrancar o el boot falla ruidosamente.
    boss = await createBoss({
      connectionString: databaseUrl,
      logger,
      noopShouldFail: shouldFail,
    });
    logger.info({ queue: 'demo.noop' }, 'pg-boss arrancado: colas y consumers listos');

    // Semilla de la Verificación: `DEMO_NOOP_SEED=10` encola N jobs `demo.noop`
    // vía el puerto JobQueue real (makeJobQueue → boss.send) al arrancar, de modo
    // que la Verificación es un único `pnpm dev` sin script aparte.
    await seedNoopFromEnv(boss, logger);
  } else {
    logger.warn({ db }, 'BD no alcanzable: worker degradado sin pg-boss');
  }

  logger.info({ health }, 'worker ready');
  return { health, boss };
}

/** Lee `DEMO_NOOP_FAIL_RATE` (0..1) → decisor aleatorio, o `undefined`. */
function failRateFromEnv(): FailDecider | undefined {
  const raw = process.env.DEMO_NOOP_FAIL_RATE;
  if (raw === undefined) return undefined;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  return randomFailRate(rate);
}

/** Encola `DEMO_NOOP_SEED` jobs `demo.noop` vía el puerto JobQueue real. */
async function seedNoopFromEnv(boss: PgBoss, logger: Logger): Promise<void> {
  const raw = process.env.DEMO_NOOP_SEED;
  if (raw === undefined) return;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return;
  const jobs = makeJobQueue(boss);
  for (let i = 0; i < n; i++) await jobs.enqueue({ job: noopJob, payload: {} });
  logger.info({ queue: noopJob.name, seeded: n }, 'demo.noop: jobs de demo encolados');
}
