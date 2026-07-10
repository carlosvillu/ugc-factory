// Harness compartido de los tests de integración del orquestador (§9.0). Ambas
// suites (orchestrator.test.ts y orchestrator-concurrency.test.ts) arrancan el
// mismo pg-boss real + Testcontainers, limpian las mismas tablas y siembran
// project/run/step con la misma forma. Este harness es el único sitio con ese
// cableado.
//
// Vive LOCAL a los tests de db (no en @ugc/test-utils): ese paquete no depende de
// pg-boss y no debe — las factories PURAS (makeProject/makePipelineRun/
// makeStepRun) sí viven allí; el boss-harness, no.
import { PgBoss } from 'pg-boss';
import { createTestDatabase, makePipelineRun, makeProject, makeStepRun } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { stepExecuteJob } from '@ugc/core/jobs';
import { ensureQueue } from '../../src/index';
import { project } from '../../src/schema/project';
import { pipelineRun, stepRun } from '../../src/schema/pipeline';
import type { NewStepRun } from '../../src/schema/pipeline';

/** Un step a sembrar: overrides sobre la factory. `status` es el enum real
 *  (NewStepRun['status']), no string — sin casts en el cuerpo del seed. */
export interface SeedStep {
  id?: string;
  nodeKey?: string;
  status?: NewStepRun['status'];
  dependsOn?: string[];
  // T0.8: banderas de checkpoint + artefactos, para sembrar escenarios de
  // approve/edit/skip/cancel sin pasar por el worker.
  isCheckpoint?: boolean;
  checkpointConfig?: unknown;
  outputRefs?: unknown;
  // T0.9: config del executor (p. ej. `timeout_ms`, `fail_rate`), contadores de
  // retry y `timeout_at` explícito para sembrar escenarios de sweeper/retry sin
  // pasar por el worker.
  config?: unknown;
  retryCount?: number;
  maxRetries?: number;
  timeoutAt?: Date | null;
}

/**
 * Entorno de una suite de orquestador: posee el TestDatabase + el pg-boss real y
 * expone los helpers ligados a ellos. Los tests cablean sus hooks
 * (beforeAll→start, afterAll→stop, beforeEach→reset) delegando aquí.
 */
export class OrchestratorEnv {
  private tdbInstance: TestDatabase | undefined;
  private bossInstance: PgBoss | undefined;

  constructor(private readonly label: string) {}

  /** El TestDatabase ya arrancado. Falla ruidoso si se usa antes de `start()`. */
  get tdb(): TestDatabase {
    if (this.tdbInstance === undefined) throw new Error('OrchestratorEnv: tdb no arrancado');
    return this.tdbInstance;
  }

  /** El pg-boss ya arrancado. Falla ruidoso si se usa antes de `start()`. */
  activeBoss(): PgBoss {
    if (this.bossInstance === undefined) throw new Error('OrchestratorEnv: pg-boss no arrancado');
    return this.bossInstance;
  }

  /** beforeAll: clona la BD, arranca pg-boss y crea la cola `step.execute` con
   *  las MISMAS options que producción (createBoss usa `ensureQueue` igual) —
   *  policy `short`, la que activa el índice único de `singleton_key`. */
  async start(): Promise<void> {
    this.tdbInstance = await createTestDatabase({ label: this.label });
    const boss = new PgBoss(this.tdb.connectionString);
    boss.on('error', () => {
      /* errores operativos del poller: irrelevantes para estos asserts */
    });
    await boss.start();
    await ensureQueue(boss, stepExecuteJob);
    this.bossInstance = boss;
  }

  /** afterAll: para pg-boss (esperando el cierre físico de su pool) ANTES de
   *  cerrar la BD, o el DROP FORCE mataría conexiones vivas (57P01). */
  async stop(): Promise<void> {
    if (this.bossInstance !== undefined) await stopBossAndWait(this.bossInstance);
    if (this.tdbInstance !== undefined) await this.tdbInstance.close();
  }

  /** beforeEach: tablas limpias + sin jobs residuales de `step.execute`. */
  async reset(): Promise<void> {
    await this.tdb.pool.query('TRUNCATE step_run, pipeline_run, project, audit_log CASCADE');
    await this.tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
  }

  /** Cuenta jobs encolados de `step.execute` (opcionalmente por singletonKey). */
  async countJobs(singletonKey?: string): Promise<number> {
    const { rows } = singletonKey
      ? await this.tdb.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND singleton_key = $2`,
          [stepExecuteJob.name, singletonKey],
        )
      : await this.tdb.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1`,
          [stepExecuteJob.name],
        );
    return rows[0]!.n;
  }

  /** Inserta project + run + steps; devuelve el runId y los ids en orden. Donde
   *  solo se necesita runId, se descarta stepIds. `runOverrides` permite fijar
   *  `autopilot` (T0.8). Los campos de checkpoint del SeedStep se pasan a la fila. */
  async seed(
    steps: SeedStep[],
    runOverrides: { autopilot?: boolean } = {},
  ): Promise<{ runId: string; stepIds: string[] }> {
    const [p] = await this.tdb.db.insert(project).values(makeProject()).returning();
    const [run] = await this.tdb.db
      .insert(pipelineRun)
      .values(makePipelineRun({ projectId: p!.id, ...runOverrides }))
      .returning();
    const rows = steps.map((s) => makeStepRun({ runId: run!.id, ...s }));
    const inserted = await this.tdb.db.insert(stepRun).values(rows).returning();
    return { runId: run!.id, stepIds: inserted.map((r) => r.id) };
  }
}

/** Para pg-boss y espera a su cierre FÍSICO (evento `stopped`; `stop()` resuelve
 *  antes, en el drain). Timeout de seguridad para no colgar el teardown. */
async function stopBossAndWait(instance: PgBoss): Promise<void> {
  const stopped = new Promise<void>((resolve) => {
    instance.once('stopped', () => {
      resolve();
    });
  });
  const safety = new Promise<void>((resolve) => setTimeout(resolve, 15_000));
  await instance.stop({ graceful: true, timeout: 10_000 });
  await Promise.race([stopped, safety]);
}
