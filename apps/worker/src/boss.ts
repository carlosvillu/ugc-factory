import { noopJob } from '@ugc/core/jobs';
import type { Logger } from '@ugc/core';
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
    await createNoopQueue(boss);
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

/**
 * Crea la cola `demo.noop` y su DLQ de forma idempotente (guard `getQueue`,
 * patrón de los docs oficiales, jobs.md §3): la DLQ debe existir ANTES de
 * referenciarla. Las opciones de retry salen del registro de core.
 */
async function createNoopQueue(boss: PgBoss): Promise<void> {
  const dlq = `${noopJob.name}.dlq`;
  if ((await boss.getQueue(dlq)) === null) await boss.createQueue(dlq);
  if ((await boss.getQueue(noopJob.name)) === null) {
    await boss.createQueue(noopJob.name, { ...noopJob.options, deadLetter: dlq });
  }
}
