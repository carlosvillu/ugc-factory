import { noopJob, stepExecuteJob } from '@ugc/core/jobs';
import type { Logger } from '@ugc/core';
import { ensureQueue } from '@ugc/db';
import { PgBoss } from 'pg-boss';
import { type FailDecider, registerNoopConsumer } from './consumers/demo-noop';

export interface CreateBossDeps {
  connectionString: string;
  logger: Logger;
  /** Decisor de fallo del consumer `demo.noop`, ya resuelto por bootstrap. */
  noopShouldFail: FailDecider;
}

/**
 * Crea, arranca y cablea la instancia de pg-boss del worker (architecture.md §6,
 * jobs.md §3): `start()` arranca y auto-migra el schema `pgboss`, las colas se
 * crean EXPLÍCITAMENTE (el auto-create se removió en v12) con su DLQ, y los
 * consumers se registran. `schedule: false` no aplica aún (no hay crons hasta
 * T0.9). El caller es dueño del handle y llama a `boss.stop()` en el shutdown.
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
