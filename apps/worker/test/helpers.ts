// Helpers de test compartidos entre suites del worker (unit `src/**` e
// integración `test/integration/**`). No van a @ugc/test-utils: son específicos
// del worker, no harness cross-paquete.
import { makeLogger } from '@ugc/core/observability';
import type { StepExecutor, TransitionDeps } from '@ugc/core/orchestrator';
import { stepExecuteJob } from '@ugc/core/jobs';
import { makeProject, makeTestLogger } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { createDbPool, ensureQueue, makeWithTransaction } from '@ugc/db';
import { project } from '@ugc/db/schema';
import { PgBoss } from 'pg-boss';
import { registerStepConsumer } from '../src/consumers/step-execute';

/**
 * Polling con timeout explícito — nada de sleeps fijos (skill testing, principio
 * 7). Acepta un predicate sync o async (`await` cubre ambos). Resuelve cuando el
 * predicate es verdadero; rechaza al superar `timeoutMs`.
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
  pollIntervalMs = 50,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout (${String(timeoutMs)}ms) esperando: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Para el boss y ESPERA a que suelte sus conexiones.
 *
 * ES EL HELPER CON MÁS TRAMPA DEL REPO, y por eso vive aquí y no copiado en cada suite (lo estaba,
 * en 5, y en DOS variantes distintas): `boss.stop()` RESUELVE ANTES de que las conexiones se hayan
 * cerrado de verdad. Si el test sigue y dropea la BD (el `close()` de Testcontainers), esas
 * conexiones vivas reciben un 57P01 y la suite falla como un flake OPACO de Testcontainers, sin
 * ninguna pista de que la causa es un boss mal parado. Hay que esperar al evento `stopped`.
 *
 * Se unifica en la variante SEGURA de las dos que había: `graceful` (deja terminar los handlers en
 * vuelo — si no, un job a medias puede dejar la BD en un estado que el assert del test no espera)
 * y con una CARRERA de seguridad: si el `stopped` no llega (un handler colgado), no bloqueamos la
 * suite para siempre; se sigue y el `close()` de Testcontainers hará su trabajo.
 */
export async function stopBossAndWait(boss: PgBoss): Promise<void> {
  const stopped = new Promise<void>((resolve) => {
    boss.once('stopped', () => {
      resolve();
    });
  });
  const safety = new Promise<void>((resolve) => setTimeout(resolve, 15_000));
  await boss.stop({ graceful: true, timeout: 10_000 });
  await Promise.race([stopped, safety]);
}

/** Un proyecto real en la BD (FK obligatoria de `pipeline_run`). Devuelve su id. */
export async function seedProject(tdb: TestDatabase): Promise<string> {
  const [row] = await tdb.db.insert(project).values(makeProject()).returning();
  if (!row) throw new Error('seedProject: el INSERT no devolvió fila');
  return row.id;
}

export interface WorkerHarness {
  /** Las deps del orquestador cableadas contra ESTE boss (para `createRun`, `transition`…). */
  deps: TransitionDeps;
  cleanup: () => Promise<void>;
}

/**
 * Un worker REAL —pg-boss real + el consumer GENÉRICO real (`registerStepConsumer`) + el
 * `transition()` real contra Postgres— con los executors que se le pasen. Lo ÚNICO simulado son
 * los executors: así lo que prueban las suites es el MECANISMO (el consumer, la máquina de
 * estados), sin red ni dinero.
 */
export async function startWorkerWith(
  tdb: TestDatabase,
  executors: Record<string, StepExecutor>,
): Promise<WorkerHarness> {
  const boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* irrelevante para estos asserts: el ruido del boss no es lo que se prueba */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);
  const { db, pool } = createDbPool(tdb.connectionString);
  const deps: TransitionDeps = { withTransaction: makeWithTransaction(db, boss, makeTestLogger()) };
  await registerStepConsumer({
    boss,
    db,
    transitionDeps: deps,
    executors,
    logger: makeLogger({ name: 'worker', level: 'silent' }),
  });
  return {
    deps,
    cleanup: async () => {
      await stopBossAndWait(boss);
      await pool.end();
    },
  };
}
