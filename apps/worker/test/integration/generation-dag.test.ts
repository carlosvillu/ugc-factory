// EJECUCIÓN END-TO-END STEPLESS del DAG de generación (T4.11 pass 2b-i): `generationRunDefinition`
// conducido por el consumer GENÉRICO real + `createRun`/`transition` reales contra Postgres + pg-boss
// reales. Los executors son STUBS (fal FAKE: CERO red, CERO gasto) que registran su ejecución — lo que
// se prueba es el MECANISMO del sub-DAG cableado, no la generación real (eso es el smoke live de 2b-ii).
//
// LO QUE FIJA:
//   · EXPANSIÓN POR VARIANTE: N variantes → N sub-DAGs N6→N7a-e ejecutados, cada step con SU variantId.
//     Que AMBAS variantes ejecuten su N7c (mismo node_key `N7c`, distinto variantId) demuestra que el
//     `singletonKey` NO colisiona entre variantes (el bug que el `variant_id` en el singletonKey evita).
//   · FLUJO DE DATOS (dependsOn = orden real): N6 antes que todo N7; N7c DESPUÉS de N7b (consume su
//     audio); N7d DESPUÉS de N7a (consume sus keyframes). Se comprueba con el ORDEN de ejecución
//     registrado, no solo con el grafo estático.
//   · TERMINACIÓN: todos los steps de todas las variantes llegan a `succeeded` (el run agota el DAG).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRun, generationRunDefinition, GENERATION_NODE_KEYS } from '@ugc/core/orchestrator';
import type { StepExecutor, VariantGenerationPlan } from '@ugc/core/orchestrator';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';

import { seedProject, startWorkerWith, stopBossAndWait, waitFor } from '../helpers';

const K = GENERATION_NODE_KEYS;

let tdb: TestDatabase;

/** Registro de ejecución: qué (node_key, variantId) corrió y en qué ORDEN global. */
interface ExecRecord {
  nodeKey: string;
  variantId: string | null;
  order: number;
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:generation-dag' });
  // `max:2` (pool acotado): BD compartida entre ficheros paralelos (ver `startWorkerWith`), no saturar
  // `max_connections` del servidor Postgres común.
  const seedBoss = new PgBoss({ connectionString: tdb.connectionString, max: 2 });
  seedBoss.on('error', () => undefined);
  await seedBoss.start();
  await stopBossAndWait(seedBoss);
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project CASCADE');
  await tdb.pool.query('DELETE FROM pgboss.job WHERE name = $1', [stepExecuteJob.name]);
});

let harnessCleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  if (harnessCleanup !== undefined) {
    await harnessCleanup();
    harnessCleanup = undefined;
  }
});

/** Un plan de variante con los 5 N7 (config opaca: los stubs no la miran). */
function fullVariant(variantId: string): VariantGenerationPlan {
  return {
    variantId,
    n6Config: { variantId },
    n7aConfig: { k: 'a' },
    n7bConfig: { k: 'b' },
    n7cConfig: { k: 'c' },
    n7dConfig: { k: 'd' },
    n7eConfig: { k: 'e' },
  };
}

describe('ejecución end-to-end stepless del DAG de generación (T4.11)', () => {
  it('expande por variante y respeta el flujo de datos N7c←N7b, N7d←N7a hasta succeeded', async () => {
    const records: ExecRecord[] = [];
    let order = 0;
    // Un stub por sub-step: registra su ejecución (node_key + variantId del contexto) y retorna con éxito.
    const stub = (nodeKey: string): StepExecutor => {
      return ({ collectOutput, variantId }) => {
        order += 1;
        records.push({ nodeKey, variantId: variantId ?? null, order });
        collectOutput?.({ nodeKey, variantId });
        return Promise.resolve();
      };
    };
    const executors: Record<string, StepExecutor> = {
      [K.n6]: stub(K.n6),
      [K.n7a]: stub(K.n7a),
      [K.n7b]: stub(K.n7b),
      [K.n7c]: stub(K.n7c),
      [K.n7d]: stub(K.n7d),
      [K.n7e]: stub(K.n7e),
    };

    const { deps, cleanup } = await startWorkerWith(tdb, executors);
    harnessCleanup = cleanup;

    const projectId = await seedProject(tdb);
    const def = generationRunDefinition(projectId, [fullVariant('vA'), fullVariant('vB')]);
    const { runId } = await createRun(deps, def);

    // Espera a que TODOS los steps (2 variantes × 6 nodos) lleguen a succeeded.
    await waitFor(
      async () => {
        const { rows } = await tdb.pool.query<{ n: string }>(
          "SELECT count(*)::int AS n FROM step_run WHERE run_id = $1 AND status = 'succeeded'",
          [runId],
        );
        return Number(rows[0]?.n ?? 0) === 12;
      },
      30_000,
      'los 12 steps del DAG de generación succeeded',
      50,
    );

    // EXPANSIÓN: cada variante ejecutó sus 6 nodos.
    for (const v of ['vA', 'vB']) {
      const ofV = records.filter((r) => r.variantId === v);
      expect(ofV.map((r) => r.nodeKey).sort()).toEqual(['N6', 'N7a', 'N7b', 'N7c', 'N7d', 'N7e']);
    }

    // SINGLETON NO COLISIONA ENTRE VARIANTES: ambas ejecutaron su N7c (mismo node_key, distinto variantId).
    expect(
      records
        .filter((r) => r.nodeKey === K.n7c)
        .map((r) => r.variantId)
        .sort(),
    ).toEqual(['vA', 'vB']);

    // FLUJO DE DATOS por variante: N6 antes que todo N7; N7c tras N7b; N7d tras N7a.
    for (const v of ['vA', 'vB']) {
      const orderOf = (nodeKey: string): number =>
        records.find((r) => r.variantId === v && r.nodeKey === nodeKey)!.order;
      const n6 = orderOf(K.n6);
      expect(n6).toBeLessThan(orderOf(K.n7a));
      expect(n6).toBeLessThan(orderOf(K.n7b));
      expect(orderOf(K.n7b)).toBeLessThan(orderOf(K.n7c)); // N7c consume el audio de N7b
      expect(orderOf(K.n7a)).toBeLessThan(orderOf(K.n7d)); // N7d consume los keyframes de N7a
    }
  }, 60_000);
});
