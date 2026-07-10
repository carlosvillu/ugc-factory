import { noopJob, stepExecuteJob } from '@ugc/core/jobs';
import type { Logger } from '@ugc/core';
import type { TransitionDeps } from '@ugc/core/orchestrator';
import { createDbPool, ensureQueue, makeWithTransaction } from '@ugc/db';
import { PgBoss } from 'pg-boss';
import { type FailDecider, registerNoopConsumer } from './consumers/demo-noop';
import { registerStepConsumer } from './consumers/step-execute';
import { type DemoFailDecider, randomDemoFail } from './executors/demo';
import { makeExecutorRegistry } from './executors';
import { startSweeper } from './sweeper';

export interface CreateBossDeps {
  connectionString: string;
  logger: Logger;
  /** Decisor de fallo del consumer `demo.noop`, ya resuelto por bootstrap. */
  noopShouldFail: FailDecider;
  /** Decisor de fallo de los executors de demo de `step.execute` (T0.7b). Default:
   *  aleatorio per-intento — la Verificación manual lo controla vía `fail_rate`. */
  demoShouldFail?: DemoFailDecider;
}

/**
 * Crea, arranca y cablea la instancia de pg-boss del worker (architecture.md §6,
 * jobs.md §3): `start()` arranca y auto-migra el schema `pgboss`, las colas se
 * crean EXPLÍCITAMENTE (el auto-create se removió en v12) con su DLQ, y los
 * consumers se registran. El barrido de timeouts de T0.9 NO usa el cron de
 * pg-boss (precisión de minuto, insuficiente para el gate de <40 s): es un
 * `setInterval` (startSweeper) que se retira cuando el boss se detiene. El caller
 * es dueño del handle y llama a `boss.stop()` en el shutdown.
 *
 * pg-boss posee su propio pool desde el connectionString en T0.6. El pool de
 * Drizzle del worker (y el encolado transaccional que lo comparte) llegan en
 * T0.7a — no se anticipan.
 */
export async function createBoss(deps: CreateBossDeps): Promise<PgBoss> {
  const boss = new PgBoss(deps.connectionString);
  // pg-boss emite errores operativos (fallos de conexión del poller) por 'error':
  // sin listener, un throw async tumbaría el proceso. Se loggea vía el puerto.
  boss.on('error', (err: unknown) => {
    deps.logger.error({ err }, 'pg-boss error');
  });

  await boss.start();
  // A partir de aquí el boss ya tiene su pool abierto: si el cableado
  // (createQueue/work) rechaza, hay que pararlo o se filtra un boss huérfano con
  // conexiones abiertas. Best-effort stop, sin tragar el error original.
  try {
    await ensureQueue(boss, noopJob);
    // Cola `step.execute` del orquestador (T0.7a): `transition()` encola aquí
    // cuando un step queda listo. Se crea ahora aunque su `work()` consumer sea
    // T0.7b — una cola sin consumer solo acumula jobs, y SIN la cola creada
    // `boss.send('step.execute')` LANZA en pg-boss v12. Su policy `short` es la
    // que activa el índice único de `singleton_key`.
    await ensureQueue(boss, stepExecuteJob);
    await registerNoopConsumer({
      boss,
      logger: deps.logger,
      shouldFail: deps.noopShouldFail,
    });
    // Consumer genérico de `step.execute` (T0.7b): el worker POSEE su propio pool
    // de Drizzle (createDbPool) y comparte el boss con el encolado transaccional
    // (makeWithTransaction). Los executors de demo se resuelven por node_key.
    const { db, pool } = createDbPool(deps.connectionString);
    // El pool es del worker: se cierra cuando pg-boss cierra físicamente (evento
    // `stopped`), o sus conexiones quedan vivas tras el shutdown (y un DROP FORCE
    // de la BD de test las mata con 57P01 sin listener). `once`: un solo cierre.
    boss.once('stopped', () => {
      void pool.end();
    });
    const transitionDeps: TransitionDeps = {
      withTransaction: makeWithTransaction(db, boss),
    };
    const executors = makeExecutorRegistry({
      demoShouldFail: deps.demoShouldFail ?? randomDemoFail,
    });
    await registerStepConsumer({
      boss,
      db,
      transitionDeps,
      executors,
      logger: deps.logger,
    });
    // Sweeper de timeouts (T0.9, jobs.md §8): setInterval que expira los steps
    // colgados (`running` con `timeout_at < now()`). Se retira cuando el boss se
    // detiene, junto al pool — así el shutdown limpia el timer (como el keepAlive
    // de main.ts) y el sweep NO corre en modo degradado (createBoss solo se
    // invoca con la BD alcanzable, mismo gate que pg-boss).
    const sweeper = startSweeper({ db, transitionDeps, logger: deps.logger });
    boss.once('stopped', () => {
      sweeper.stop();
    });
  } catch (err) {
    try {
      await boss.stop({ graceful: false });
    } catch (stopErr) {
      deps.logger.error({ err: stopErr }, 'pg-boss: stop tras fallo de cableado también falló');
    }
    throw err;
  }

  return boss;
}
