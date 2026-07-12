// DOS propiedades que T1.10b estrenó y que solo el worker VIVO contra Postgres real puede
// probar (regla de trabajo 8: las cláusulas deterministas de la Verificación se codifican como
// test permanente). Ambas eran BUGS REALES hasta esta tarea:
//
//  1. UN CHECKPOINT QUE PRODUCE ARTEFACTO CONSERVA SU `output_refs` AL PAUSAR.
//     `transition()` escribía `output_refs` solo en `succeed`/`skip_inapplicable` — NO en
//     `reach_checkpoint`. En F0 no se notaba: los checkpoints eran nodos de DEMO que no
//     producían nada. En cuanto N3 (que sintetiza un ProductBrief de ~$0,20) pasó a ser el
//     checkpoint de CP1, el step pausaba en `waiting_approval` con `output_refs = NULL` — y CP1
//     abría un editor VACÍO sobre un brief que sí se sintetizó Y SE PAGÓ. Este test lo fija.
//
//  2. EL COSTE REAL DEL STEP LLEGA A `step_run.cost_actual`.
//     Los servicios escriben su `cost_entry` (record-first, T1.4) pero NADIE escribía
//     `step_run.cost_actual`, que es la columna que suma el KPI "coste real" del canvas
//     (run-shell.tsx). El canvas mostraba $0,00 con dinero REALMENTE gastado, mientras /spend
//     (que agrega `cost_entry`) sí lo veía. El fix: el consumer RECOMPUTA la columna desde el
//     ledger (`rollupStepCost`) al cerrar el step — incluido el cierre por checkpoint, que es el
//     caso de N3 (gasta Y pausa).
//
// Contra Postgres 16 real + pg-boss real + el consumer GENÉRICO real. Lo único simulado son los
// executors (stubs que llaman a `collectOutput`/`recordCost` como los reales): así lo que se
// prueba es el MECANISMO, sin red ni dinero.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRun } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { createDbPool, recordCost } from '@ugc/db';
import { PgBoss } from 'pg-boss';
import { seedProject, startWorkerWith, stopBossAndWait, waitFor } from '../helpers';

let tdb: TestDatabase;

interface StepRowLite {
  nodeKey: string;
  status: string;
  outputRefs: unknown;
  costActual: number | null;
}

async function fetchSteps(runId: string): Promise<StepRowLite[]> {
  const { rows } = await tdb.pool.query<{
    node_key: string;
    status: string;
    output_refs: unknown;
    cost_actual: number | null;
  }>(`SELECT node_key, status, output_refs, cost_actual FROM step_run WHERE run_id = $1`, [runId]);
  return rows.map((r) => ({
    nodeKey: r.node_key,
    status: r.status,
    outputRefs: r.output_refs,
    costActual: r.cost_actual,
  }));
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:checkpoint-artifact' });
  const seedBoss = new PgBoss(tdb.connectionString);
  seedBoss.on('error', () => {
    /* irrelevante */
  });
  await seedBoss.start();
  await stopBossAndWait(seedBoss);
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE cost_entry, step_run, pipeline_run, project CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

describe('checkpoint con ARTEFACTO (T1.10b): pausar no borra lo que el nodo produjo', () => {
  it('un checkpoint que llama a collectOutput() pausa en waiting_approval CON su output_refs', async () => {
    const artefacto = { briefId: '01ABC', brief: { product: { name: 'Sérum' } }, warnings: [] };

    // El executor hace su trabajo (produce el artefacto) y retorna. Es EXACTAMENTE lo que hace
    // N3: sintetiza el brief, lo entrega por `collectOutput` y se va — es el CONSUMER quien
    // decide que el cierre es `reach_checkpoint` (porque el step es checkpoint y no hay
    // autopilot), no el executor.
    const checkpointExecutor: StepExecutor = ({ collectOutput }) => {
      collectOutput?.(artefacto);
      return Promise.resolve();
    };

    const { deps, cleanup } = await startWorkerWith(tdb, { CP: checkpointExecutor });
    try {
      const projectId = await seedProject(tdb);
      const { runId } = await createRun(deps, {
        projectId,
        autopilot: false, // sin autopilot ⇒ el checkpoint PAUSA
        nodes: [{ key: 'CP', nodeKey: 'CP', dependsOn: [], config: {}, isCheckpoint: true }],
      });

      await waitFor(
        async () => (await fetchSteps(runId)).some((s) => s.status === 'waiting_approval'),
        20_000,
        'el checkpoint pausa en waiting_approval',
      );

      const [step] = await fetchSteps(runId);
      expect(step?.status).toBe('waiting_approval');
      // LO QUE IMPORTA. Antes de T1.10b esto era `null`: `transition()` no escribía
      // `output_refs` en el evento `reach_checkpoint`, así que el artefacto —ya producido y ya
      // pagado— se perdía en el momento de pausar, y el editor de CP1 se abría VACÍO.
      expect(step?.outputRefs).toEqual(artefacto);
    } finally {
      await cleanup();
    }
  });
});

describe('rollup del coste real (T1.10b): cost_entry → step_run.cost_actual', () => {
  it('un step que gasta deja su coste en cost_actual (el KPI del canvas deja de mostrar $0,00)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);

    // El executor gasta: escribe su `cost_entry` con `step_run_id` — igual que hacen los
    // servicios reales (record-first: la fila del gasto se escribe DENTRO del servicio, ANTES
    // de retornar). Dos cargos, como en un nodo que llama dos veces a un proveedor.
    const spender: StepExecutor = async ({ stepId }) => {
      await recordCost(db, { provider: 'anthropic', amountCents: 12, stepRunId: stepId });
      await recordCost(db, { provider: 'anthropic', amountCents: 8, stepRunId: stepId });
    };

    const { deps, cleanup } = await startWorkerWith(tdb, { SPEND: spender });
    try {
      const projectId = await seedProject(tdb);
      const { runId } = await createRun(deps, {
        projectId,
        autopilot: true,
        nodes: [{ key: 'SPEND', nodeKey: 'SPEND', dependsOn: [], config: {} }],
      });

      await waitFor(
        async () => (await fetchSteps(runId)).some((s) => s.status === 'succeeded'),
        20_000,
        'el step completa',
      );

      const [step] = await fetchSteps(runId);
      // 12 + 8 = 20 céntimos. Antes de T1.10b `cost_actual` quedaba NULL (nadie la escribía) y
      // el canvas sumaba 0 mientras /spend sí veía los 20 céntimos: dos verdades del mismo
      // dinero. El rollup RECOMPUTA la columna desde el ledger, así que no puede derivar.
      expect(step?.costActual).toBe(20);
    } finally {
      await cleanup();
      await pool.end();
    }
  });

  it('un step CHECKPOINT que gasta también hace rollup: N3 paga Y pausa', async () => {
    // El caso REAL de N3: sintetiza (paga ~$0,20 de Sonnet 5) y PAUSA en CP1. Si el rollup solo
    // corriera en el path `succeed`, el step más caro del pipeline mostraría coste 0 justo
    // mientras el usuario lo tiene delante en el editor.
    const { db, pool } = createDbPool(tdb.connectionString);
    const spender: StepExecutor = async ({ stepId, collectOutput }) => {
      await recordCost(db, { provider: 'anthropic', amountCents: 19, stepRunId: stepId });
      collectOutput?.({ briefId: '01XYZ', brief: {}, warnings: [] });
    };

    const { deps, cleanup } = await startWorkerWith(tdb, { N3: spender });
    try {
      const projectId = await seedProject(tdb);
      const { runId } = await createRun(deps, {
        projectId,
        autopilot: false,
        nodes: [{ key: 'N3', nodeKey: 'N3', dependsOn: [], config: {}, isCheckpoint: true }],
      });

      await waitFor(
        async () => (await fetchSteps(runId)).some((s) => s.status === 'waiting_approval'),
        20_000,
        'N3 pausa en el checkpoint',
      );

      const [step] = await fetchSteps(runId);
      expect(step?.status).toBe('waiting_approval');
      expect(step?.costActual).toBe(19); // el coste ya está en la columna EN LA PAUSA
    } finally {
      await cleanup();
      await pool.end();
    }
  });
});
