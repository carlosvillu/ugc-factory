// Integración END-TO-END de la decisión de pausa en checkpoints (T0.8, §7.1.b)
// contra Postgres 16 + pg-boss reales: el consumer genérico decide `reach_checkpoint`
// vs `succeed` tras un executor exitoso, según is_checkpoint + autopilot + override.
// Codifica las cláusulas de la Verificación de T0.8 que solo el worker vivo puede
// probar (regla de trabajo 8): un checkpoint PAUSA el run; approve lo reanuda hasta
// completar; con autopilot=true NO hay pausa; el override "parar siempre" gana sobre
// autopilot.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeLogger } from '@ugc/core/observability';
import { approveStep, createRun, demoCheckpointRunDefinition } from '@ugc/core/orchestrator';
import type { TransitionDeps } from '@ugc/core/orchestrator';
import { createTestDatabase, makeProject } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { stepExecuteJob } from '@ugc/core/jobs';
import { PgBoss } from 'pg-boss';
import { createDbPool, ensureQueue, makeWithTransaction } from '@ugc/db';
import { project } from '@ugc/db/schema';
import { bootstrap } from '../../src/bootstrap';
import { waitFor } from '../helpers';

const silentLogger = makeLogger({ name: 'worker', level: 'silent' });

interface StepStateRow {
  id: string;
  nodeKey: string;
  status: string;
}

let tdb: TestDatabase;
let boss: PgBoss | undefined;

async function fetchSteps(runId: string): Promise<StepStateRow[]> {
  const { rows } = await tdb.pool.query<{ id: string; node_key: string; status: string }>(
    `SELECT id, node_key, status FROM step_run WHERE run_id = $1 ORDER BY node_key`,
    [runId],
  );
  return rows.map((r) => ({ id: r.id, nodeKey: r.node_key, status: r.status }));
}

async function seedProject(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  return p!.id;
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:checkpoint-e2e' });
  const seedBoss = new PgBoss(tdb.connectionString);
  seedBoss.on('error', () => {
    /* irrelevante */
  });
  await seedBoss.start();
  await stopBossAndWait(seedBoss);
});

afterAll(async () => {
  if (boss !== undefined) await stopBossAndWait(boss);
  await tdb.close();
});

afterEach(async () => {
  if (boss !== undefined) {
    await stopBossAndWait(boss);
    boss = undefined;
  }
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project, audit_log CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

async function startWorker(): Promise<void> {
  const result = await bootstrap({ logger: silentLogger, databaseUrl: tdb.connectionString });
  boss = result.boss;
  if (boss === undefined) throw new Error('pg-boss no arrancó pese a BD alcanzable');
}

/** withTransaction/TransitionDeps sobre la misma BD del test (crear runs + approve
 *  desde el test). Boss aparte SOLO para encolar; el worker consume. */
async function makeDeps(): Promise<{ deps: TransitionDeps; cleanup: () => Promise<void> }> {
  const enqueueBoss = new PgBoss(tdb.connectionString);
  enqueueBoss.on('error', () => {
    /* irrelevante */
  });
  await enqueueBoss.start();
  await ensureQueue(enqueueBoss, stepExecuteJob);
  const { db, pool } = createDbPool(tdb.connectionString);
  return {
    deps: { withTransaction: makeWithTransaction(db, enqueueBoss) },
    cleanup: async () => {
      await stopBossAndWait(enqueueBoss);
      await pool.end();
    },
  };
}

describe('checkpoint E2E: pausa, approve reanuda, autopilot, override', () => {
  it('sin autopilot: N1 (checkpoint) PAUSA en waiting_approval; approve reanuda y el run COMPLETA', async () => {
    await startWorker();
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      // N0 → N1(checkpoint) → N2, sin autopilot.
      const { runId } = await createRun(
        deps,
        demoCheckpointRunDefinition(projectId, { sleepMs: 5 }),
      );

      // El worker corre N0→succeeded, N1 ejecuta y PAUSA en waiting_approval; N2
      // espera. El run queda pausado (no avanza más sin intervención).
      await waitFor(
        async () => {
          const steps = await fetchSteps(runId);
          const n1 = steps.find((s) => s.nodeKey === 'demo.sleep.N1');
          return n1?.status === 'waiting_approval';
        },
        30_000,
        'N1 en waiting_approval',
        100,
      );

      // Confirmar la PAUSA: N0 succeeded, N1 waiting_approval, N2 aún awaiting_deps.
      const paused = await fetchSteps(runId);
      expect(paused.find((s) => s.nodeKey === 'demo.sleep.N0')!.status).toBe('succeeded');
      expect(paused.find((s) => s.nodeKey === 'demo.sleep.N2')!.status).toBe('awaiting_deps');

      // Margen: sin approve el run NO avanza (la pausa es real).
      await new Promise((r) => setTimeout(r, 800));
      expect((await fetchSteps(runId)).find((s) => s.nodeKey === 'demo.sleep.N1')!.status).toBe(
        'waiting_approval',
      );

      // APPROVE reanuda: N1 → succeeded, N2 arranca y completa.
      const n1Id = paused.find((s) => s.nodeKey === 'demo.sleep.N1')!.id;
      await approveStep(deps, n1Id);

      await waitFor(
        async () => (await fetchSteps(runId)).every((s) => s.status === 'succeeded'),
        30_000,
        'los 3 steps succeeded tras approve',
        100,
      );
      const done = await fetchSteps(runId);
      expect(done.every((s) => s.status === 'succeeded')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('autopilot=true: N1 (checkpoint) NO pausa; el run completa sin aprobación', async () => {
    await startWorker();
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(
        deps,
        demoCheckpointRunDefinition(projectId, { sleepMs: 5, autopilot: true }),
      );

      // Sin ninguna intervención, los 3 completan: autopilot suprime la pausa.
      await waitFor(
        async () => (await fetchSteps(runId)).every((s) => s.status === 'succeeded'),
        30_000,
        'los 3 steps succeeded con autopilot',
        100,
      );
      const steps = await fetchSteps(runId);
      expect(steps.every((s) => s.status === 'succeeded')).toBe(true);
      // Ninguno pasó por waiting_approval de forma persistente (todos terminales).
      expect(steps.some((s) => s.status === 'waiting_approval')).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('override alwaysPause GANA sobre autopilot=true: N1 pausa aunque el run esté en autopilot', async () => {
    await startWorker();
    const { deps, cleanup } = await makeDeps();
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(
        deps,
        demoCheckpointRunDefinition(projectId, {
          sleepMs: 5,
          autopilot: true,
          alwaysPauseN1: true,
        }),
      );

      // Pese a autopilot, el override "parar siempre" hace que N1 pause.
      await waitFor(
        async () => {
          const n1 = (await fetchSteps(runId)).find((s) => s.nodeKey === 'demo.sleep.N1');
          return n1?.status === 'waiting_approval';
        },
        30_000,
        'N1 en waiting_approval pese a autopilot (override)',
        100,
      );
      const steps = await fetchSteps(runId);
      expect(steps.find((s) => s.nodeKey === 'demo.sleep.N1')!.status).toBe('waiting_approval');
      expect(steps.find((s) => s.nodeKey === 'demo.sleep.N2')!.status).toBe('awaiting_deps');
    } finally {
      await cleanup();
    }
  });
});

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
