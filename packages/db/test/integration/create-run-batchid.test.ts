// Round-trip de T5c.3 contra Postgres real (Testcontainers): `createRun` propaga el `batchId` de la
// definición del run hasta la columna `pipeline_run.batch_id`. Es la Verificación observable de la tarea
// codificada como test PERMANENTE del gate (regla de trabajo 8):
//   - un run de LOTE/GENERACIÓN (def con `batchId`) → `pipeline_run.batch_id` poblado con ese ULID;
//   - un run de ANÁLISIS (def SIN `batchId`) → columna NULL (control negativo: mantiene su semántica);
//   - los runs HERMANOS del mismo lote (N5 + generación) comparten `batch_id` consultable con un SELECT
//     — que es exactamente lo que el grafo único (T5c.6) necesita reconstruir.
//
// Va contra la BD real porque el hecho que prueba es de MAPEO (core `batchId` → columna snake_case
// `batch_id`, spread condicional en el adaptador Drizzle): un stub no falla donde Drizzle fallaría.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createRun, batchRunDefinition, generationRunDefinition } from '@ugc/core/orchestrator';
import type { VariantGenerationPlan } from '@ugc/core/orchestrator';
import { makeProject, makeTestLogger } from '@ugc/test-utils';
import { makeWithTransaction } from '../../src/index';
import { pipelineRun } from '../../src/schema/pipeline';
import { project } from '../../src/schema/project';
import { OrchestratorEnv } from './orchestrator-harness';

const env = new OrchestratorEnv('db:create-run-batchid');
const tdb = () => env.tdb;
const deps = () => ({
  withTransaction: makeWithTransaction(tdb().db, env.activeBoss(), makeTestLogger()),
});

/** Plan de variante MÍNIMO: solo N6 (root). Suficiente para un DAG de generación válido que `createRun`
 *  acepte — el objetivo de esta suite es el `batch_id` a NIVEL DE RUN, no el sub-DAG (ya cubierto en
 *  generation-dag.test.ts). */
function minimalVariantPlan(variantId: string): VariantGenerationPlan {
  return { variantId, n6Config: { variantId } };
}

/** Un proyecto persistido (FK de `pipeline_run.project_id`). Devuelve su id. */
async function seedProject(): Promise<string> {
  const [p] = await tdb().db.insert(project).values(makeProject()).returning();
  return p!.id;
}

/** Lee `batch_id` de un run por SELECT directo — el mismo camino que la Verificación de la tarea. */
async function batchIdOf(runId: string): Promise<string | null> {
  const [row] = await tdb()
    .db.select({ batchId: pipelineRun.batchId })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  return row!.batchId;
}

beforeAll(() => env.start());
afterAll(() => env.stop());
beforeEach(() => env.reset());

describe('createRun → pipeline_run.batch_id (T5c.3)', () => {
  it('run de LOTE (batchRunDefinition): batch_id queda poblado con el ULID del lote', async () => {
    const projectId = await seedProject();
    const { runId } = await createRun(deps(), batchRunDefinition(projectId, 'bat_lote_01'));
    expect(await batchIdOf(runId)).toBe('bat_lote_01');
  });

  it('run de GENERACIÓN (generationRunDefinition + opts.batchId): batch_id poblado', async () => {
    const projectId = await seedProject();
    const { runId } = await createRun(
      deps(),
      generationRunDefinition(projectId, [minimalVariantPlan('v1')], { batchId: 'bat_lote_01' }),
    );
    expect(await batchIdOf(runId)).toBe('bat_lote_01');
  });

  it('CONTROL: run de ANÁLISIS (def SIN batchId) → batch_id NULL (semántica actual intacta)', async () => {
    const projectId = await seedProject();
    // La def del run de análisis se construye ANTES de que exista el lote → sin `batchId`. Aquí se
    // reproduce su forma en el límite de db: una def de un solo root, sin la clave `batchId`.
    const { runId } = await createRun(deps(), {
      projectId,
      autopilot: false,
      nodes: [{ key: 'N1', nodeKey: 'N1', dependsOn: [], config: null }],
    });
    expect(await batchIdOf(runId)).toBeNull();
  });

  it('los runs HERMANOS del MISMO lote comparten batch_id (N5 + generación) — grafo único T5c.6', async () => {
    const projectId = await seedProject();
    const batchId = 'bat_hermanos_01';

    // Run de N5 (lote) y run de generación del MISMO lote: dos runs distintos, mismo batch_id.
    const n5 = await createRun(deps(), batchRunDefinition(projectId, batchId));
    const gen = await createRun(
      deps(),
      generationRunDefinition(projectId, [minimalVariantPlan('v1')], { batchId }),
    );
    expect(n5.runId).not.toBe(gen.runId); // son runs SEPARADOS…

    // …y sin embargo el SELECT los correlaciona por batch_id: exactamente 2 runs con ese lote.
    const { rows } = await tdb().pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pipeline_run WHERE batch_id = $1`,
      [batchId],
    );
    expect(rows[0]!.n).toBe(2);
    expect(await batchIdOf(n5.runId)).toBe(batchId);
    expect(await batchIdOf(gen.runId)).toBe(batchId);
  });
});
