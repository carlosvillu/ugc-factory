// LA PAUSA DE CP4 (T5.5c) contra el consumer GENÉRICO real + Postgres 16 + pg-boss reales (regla de
// trabajo 8: la cláusula determinista de la Verificación —«un run que llega a N9 pausa en
// waiting_approval»— se codifica como test permanente). Lo ÚNICO simulado son los executors (stubs que
// emiten el artefacto como los reales): así lo que se prueba es el MECANISMO de pausa del checkpoint, sin
// red ni dinero.
//
// LO QUE MUERDE. El run de generación corre en AUTOPILOT (`generationRunDefinition` → autopilot:true, el
// gasto se autorizó en CP2). Un checkpoint normal NO pausaría bajo autopilot (`shouldPause`). N9 pausa
// SOLO porque `generation-dag.ts` lo marca con `checkpointConfig.alwaysPause=true`, que GANA sobre
// autopilot. El CONTROL NEGATIVO lo demuestra: el MISMO run pero con N9 SIN `alwaysPause` navega a
// `succeeded` — si alguien quita el flag del DAG, el primer test se pone rojo (deja de pausar).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRun, generationRunDefinition } from '@ugc/core/orchestrator';
import type {
  RunDefinitionInput,
  StepExecutor,
  VariantGenerationPlan,
} from '@ugc/core/orchestrator';
import type { N8Output, N9Output, QaReport } from '@ugc/core/contracts';
import { N9OutputSchema } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';
import { makeN9Executor } from '../../src/executors/qa-verdict';
import { seedProject, startWorkerWith, stopBossAndWait, waitFor } from '../helpers';

let tdb: TestDatabase;

interface StepRowLite {
  nodeKey: string;
  variantId: string | null;
  status: string;
  outputRefs: unknown;
}

async function fetchSteps(runId: string): Promise<StepRowLite[]> {
  const { rows } = await tdb.pool.query<{
    node_key: string;
    variant_id: string | null;
    status: string;
    output_refs: unknown;
  }>(`SELECT node_key, variant_id, status, output_refs FROM step_run WHERE run_id = $1`, [runId]);
  return rows.map((r) => ({
    nodeKey: r.node_key,
    variantId: r.variant_id,
    status: r.status,
    outputRefs: r.output_refs,
  }));
}

/** Un `qa_report` limpio (todos los checks en pass). N8 lo mide; N9 lo LEE (no re-mide). */
function passingQaReport(): QaReport {
  return {
    checks: {
      resolution: 'pass',
      fps: 'pass',
      codec: 'pass',
      duration: 'pass',
      loudness: 'pass',
      av_duration_diff: 'pass',
      captions_safe_zone: 'pass',
      filesize: 'pass',
    },
    metrics: {},
    passed: true,
    score: 100,
  };
}

const VARIANT_ID = 'variant-cp4';

/** El stub de N8: emite un `N8Output` con el `qa_report` YA medido (lo que el N8 real persiste). N9 lo lee
 *  de su dep. El variantId viaja por el `ExecutorContext` (el consumer lo pasa desde step_run.variant_id). */
const n8Stub: StepExecutor = ({ collectOutput, variantId }) => {
  collectOutput?.({
    variantId: variantId ?? VARIANT_ID,
    masterAssetId: 'master-1',
    thumbnailAssetId: 'thumb-1',
    qaReport: passingQaReport(),
  } satisfies N8Output);
  return Promise.resolve();
};

/** Un sub-DAG mínimo N8→N9 para UNA variante, vía el builder REAL `generationRunDefinition`. Solo se
 *  pueblan `n8Config`/`n9Config` (los N7 se omiten: N8 es un stub que no los consume aquí). El builder
 *  emite N8 (autopilot) y N9 (checkpoint alwaysPause ← [N8]). */
function n8n9RunDefinition(): RunDefinitionInput {
  const plan: VariantGenerationPlan = {
    variantId: VARIANT_ID,
    n6Config: { variantId: VARIANT_ID },
    n8Config: { variantId: VARIANT_ID },
    n9Config: { variantId: VARIANT_ID },
  };
  return generationRunDefinition('p', [plan]);
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:n9-checkpoint' });
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
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

describe('N9 · CP4 (T5.5c): el run de generación PAUSA en N9 pese al autopilot', () => {
  it('un run que llega a N9 pausa en `waiting_approval` con su N9Output (no navega a succeeded)', async () => {
    // El stub N6 completa (raíz preexistente en el sub-DAG que el builder crea); solo N8 y N9 tienen
    // lógica relevante. N6 es un no-op que solo debe suceder para que N8 pueda encolarse.
    const noop: StepExecutor = () => Promise.resolve();
    const { deps, cleanup } = await startWorkerWith(tdb, {
      N6: noop,
      N8: n8Stub,
      N9: makeN9Executor(),
    });
    try {
      const projectId = await seedProject(tdb);
      const def = { ...n8n9RunDefinition(), projectId };
      const { runId } = await createRun(deps, def);

      // N9 pausa (waiting_approval). Es lo que la Verificación pide: el run se DETIENE en el checkpoint.
      await waitFor(
        async () =>
          (await fetchSteps(runId)).some(
            (s) => s.nodeKey === 'N9' && s.status === 'waiting_approval',
          ),
        30_000,
        'N9 pausa en waiting_approval',
      );

      const steps = await fetchSteps(runId);
      const n8 = steps.find((s) => s.nodeKey === 'N8');
      const n9 = steps.find((s) => s.nodeKey === 'N9');
      // N8 completó (autopilot, sin pausa); N9 pausó en el checkpoint.
      expect(n8?.status).toBe('succeeded');
      expect(n9?.status).toBe('waiting_approval');
      expect(n9?.variantId).toBe(VARIANT_ID);
      // El artefacto de N9 se conservó AL pausar (T1.10b: reach_checkpoint escribe output_refs): el panel
      // de CP4 lo abrirá con el veredicto, no vacío.
      const output: N9Output = N9OutputSchema.parse(n9?.outputRefs);
      expect(output.variantId).toBe(VARIANT_ID);
      expect(output.passed).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('CONTROL NEGATIVO: el MISMO run con N9 SIN `alwaysPause` navega a `succeeded` (no pausa)', async () => {
    // La prueba de que la pausa la CAUSA `alwaysPause`, no otra cosa: si a N9 se le quita el flag, bajo
    // autopilot el consumer cierra el step con `succeed` (shouldPause=false) — exactamente lo que le
    // pasaría al primer test si alguien borrara `checkpointConfig` de `generation-dag.ts`.
    const noop: StepExecutor = () => Promise.resolve();
    const { deps, cleanup } = await startWorkerWith(tdb, {
      N6: noop,
      N8: n8Stub,
      N9: makeN9Executor(),
    });
    try {
      const projectId = await seedProject(tdb);
      const def = n8n9RunDefinition();
      // Se despoja a N9 de su condición de checkpoint (el contrafáctico): mismo grafo, misma ejecución,
      // sin el override de pausa.
      const nodes = def.nodes.map((n) =>
        n.nodeKey === 'N9' ? { ...n, isCheckpoint: false, checkpointConfig: null } : n,
      );
      const { runId } = await createRun(deps, { ...def, nodes, projectId });

      await waitFor(
        async () =>
          (await fetchSteps(runId)).some((s) => s.nodeKey === 'N9' && s.status === 'succeeded'),
        30_000,
        'N9 completa sin pausar (control negativo)',
      );

      const n9 = (await fetchSteps(runId)).find((s) => s.nodeKey === 'N9');
      // Sin alwaysPause + autopilot ⇒ succeeded, NUNCA waiting_approval. Este es el mordisco: demuestra
      // que el flag es lo que pausa.
      expect(n9?.status).toBe('succeeded');
      expect(n9?.status).not.toBe('waiting_approval');
    } finally {
      await cleanup();
    }
  });
});
