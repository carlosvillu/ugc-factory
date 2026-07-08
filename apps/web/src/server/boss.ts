// Accessor lazy de la instancia PgBoss de web (jobs.md §3): web ENCOLA desde
// `transition()`/`createRun()` dentro de una request, pero NO consume (`work()`) ni
// programa crons — eso es solo del worker. Por eso el boss de web se construye con
// `supervise: false` y `schedule: false` (sin poller ni cron worker) y solo se
// usa para `send` transaccional vía el JobQueue tx-scoped.
//
// Lazy + override, mismo contrato que `getDb()` (testing/api.md §2.1): importar un
// route handler no arranca pg-boss; el primer `getBoss()` lo arranca desde
// `DATABASE_URL`, y los tests inyectan su propio boss con `setBossForTests()`.
import { ensureQueue } from '@ugc/db';
import { stepExecuteJob } from '@ugc/core/jobs';
import { PgBoss } from 'pg-boss';

let override: PgBoss | undefined;
let started: Promise<PgBoss> | undefined;

/** Solo para tests: inyecta (o limpia con `undefined`) el boss del test. */
export function setBossForTests(boss: PgBoss | undefined): void {
  override = boss;
}

/**
 * Devuelve el boss de web, arrancándolo la primera vez. Cachea la PROMESA (no la
 * instancia) para que dos requests concurrentes en el arranque en frío compartan
 * un único `start()` en vez de abrir dos pools. Crea la cola `step.execute` (sin
 * ella `boss.send` lanza en pg-boss v12).
 */
export async function getBoss(): Promise<PgBoss> {
  if (override) return override;
  started ??= (async () => {
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL ?? '',
      // web no supervisa colas ni programa crons: solo encola.
      supervise: false,
      schedule: false,
    });
    await boss.start();
    await ensureQueue(boss, stepExecuteJob);
    return boss;
  })();
  return started;
}
