// AISLAMIENTO CROSS-NODE POR VARIANTE (T4.11 pass 2b-ii, §9.6 — EL MÁXIMO RIESGO DE DINERO DE F4):
// la variante A NUNCA consume el audio del hook de la variante B. Se ejecuta el DAG de generación de DOS
// variantes con el consumer GENÉRICO REAL + `createRun`/`transition` reales + pg-boss real (fal FAKE:
// executors stub, CERO red, CERO gasto). Cada N7b stub emite un `N7bOutput` con un `assetId` DISTINTO por
// variante; cada N7c stub deriva su audio del hook con el resolver REAL (`deriveHookAudioAssetId`) sobre
// SUS `ctx.deps` (resueltos por el consumer desde `step.dependsOn`, aislados por variante por construcción)
// y registra qué derivó. La aserción: el N7c de A deriva el audio de A, el de B el de B — jamás cruzado.
//
// POR QUÉ ESTE TEST Y NO EL UNIT: el unit de `cross-node-deps` prueba el resolver con `ctx.deps` a mano.
// ESTE prueba que el CONSUMER cablea `dependsOn` POR VARIANTE y resuelve los deps por-step — el mecanismo
// que hace que A jamás VEA el asset de B. Control negativo (ver el `it` dedicado): un resolver que
// tomara "el primer tts_audio del RUN" (ignorando deps) cruzaría A↔B — el test lo caza.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRun, generationRunDefinition, GENERATION_NODE_KEYS } from '@ugc/core/orchestrator';
import type { StepExecutor, VariantGenerationPlan } from '@ugc/core/orchestrator';
import { deriveHookAudioAssetId, findN7bDep } from '@ugc/core/generation';
import type { N7bOutput } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';

import { seedProject, startWorkerWith, stopBossAndWait, waitFor } from '../helpers';

const K = GENERATION_NODE_KEYS;

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:n7c-cross-node-isolation' });
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

/** Un plan con N6→N7b→N7c (lo mínimo del cross-node de audio). N7a/N7d/N7e se omiten (no tocan el audio). */
function voiceAvatarVariant(variantId: string): VariantGenerationPlan {
  return {
    variantId,
    n6Config: { variantId },
    n7bConfig: { k: 'b' },
    n7cConfig: { k: 'c' },
  };
}

/** El assetId del audio del hook que cada variante DEBE producir/consumir (distinto por variante). */
const HOOK_AUDIO: Record<string, string> = {
  vA: 'audio_hook_vA',
  vB: 'audio_hook_vB',
};

/** Stub de N7b: emite un `N7bOutput` con el `assetId` de hook de SU variante (sceneIndex 0 = hook). */
function n7bStub(): StepExecutor {
  return ({ collectOutput, variantId }) => {
    const assetId = HOOK_AUDIO[variantId ?? ''] ?? `audio_${variantId ?? 'x'}`;
    const output: N7bOutput = {
      scriptId: `script_${variantId ?? 'x'}`,
      language: 'es',
      clips: [
        {
          sceneIndex: 0,
          generationId: `g_${variantId ?? 'x'}`,
          assetId,
          durationSeconds: 4,
          wordCount: 8,
          ttsCostCents: 1,
          asrCostCents: 1,
        },
      ],
    };
    collectOutput?.(output);
    return Promise.resolve();
  };
}

describe('N7c cross-node · aislamiento por variante (T4.11 §9.6, money-path)', () => {
  it('el N7c de A deriva el audio de A y el de B el de B — NUNCA cruzado', async () => {
    // Qué audio derivó el N7c de cada variante (con el resolver REAL sobre sus ctx.deps).
    const derivedByVariant: Record<string, string | undefined> = {};
    // Qué assetIds VIO cada N7c en sus deps (para probar que A jamás ve el asset de B).
    const depsSeenByVariant: Record<string, string[]> = {};

    const n7cStub: StepExecutor = ({ collectOutput, variantId, deps }) => {
      const resolvedDeps = deps ?? [];
      // El resolver REAL de producción (§9.6): encuentra la dep N7b de ESTA variante y deriva el audio del
      // hook (sceneIndex 0) de su output — el mismo encadenamiento que el executor N7c real.
      const n7b = findN7bDep(resolvedDeps);
      const audio = n7b !== undefined ? deriveHookAudioAssetId(n7b, 0) : undefined;
      derivedByVariant[variantId ?? ''] = audio;
      // Todos los assetId de audio visibles en los deps de ESTE N7c.
      depsSeenByVariant[variantId ?? ''] = resolvedDeps.flatMap((d) => {
        const refs = d.outputRefs as { clips?: { assetId: string }[] } | null;
        return refs?.clips?.map((c) => c.assetId) ?? [];
      });
      collectOutput?.({ audio });
      return Promise.resolve();
    };

    const executors: Record<string, StepExecutor> = {
      [K.n6]: ({ collectOutput }) => {
        collectOutput?.({ node: 'N6' });
        return Promise.resolve();
      },
      [K.n7b]: n7bStub(),
      [K.n7c]: n7cStub,
    };

    const { deps, cleanup } = await startWorkerWith(tdb, executors);
    harnessCleanup = cleanup;

    const projectId = await seedProject(tdb);
    const def = generationRunDefinition(projectId, [
      voiceAvatarVariant('vA'),
      voiceAvatarVariant('vB'),
    ]);
    const { runId } = await createRun(deps, def);

    await waitFor(
      async () => {
        const { rows } = await tdb.pool.query<{ n: string }>(
          "SELECT count(*)::int AS n FROM step_run WHERE run_id = $1 AND status = 'succeeded'",
          [runId],
        );
        return Number(rows[0]?.n ?? 0) === 6; // 2 variantes × (N6+N7b+N7c)
      },
      30_000,
      'los 6 steps del DAG de 2 variantes succeeded',
      50,
    );

    // EL INVARIANTE DE DINERO: cada N7c derivó el audio de SU variante, no del vecino.
    expect(derivedByVariant.vA).toBe(HOOK_AUDIO.vA);
    expect(derivedByVariant.vB).toBe(HOOK_AUDIO.vB);
    // Y el mecanismo REAL que lo garantiza: el N7c de A jamás VIO el asset de B en sus deps (y viceversa).
    expect(depsSeenByVariant.vA).toEqual([HOOK_AUDIO.vA]);
    expect(depsSeenByVariant.vA).not.toContain(HOOK_AUDIO.vB);
    expect(depsSeenByVariant.vB).toEqual([HOOK_AUDIO.vB]);
    expect(depsSeenByVariant.vB).not.toContain(HOOK_AUDIO.vA);
  }, 60_000);

  it('CONTROL NEGATIVO: un resolver "primer tts_audio del RUN" (ignora deps) SÍ cruzaría A↔B', async () => {
    // Prueba que el aislamiento NO es tautológico: un resolver mal cableado que tomara el primer audio
    // del RUN (no de la dep de la variante) devolvería el MISMO assetId para A y para B — cruzándolos.
    // Aquí se SIMULA ese resolver roto leyendo directo de la BD el primer asset de audio del run, y se
    // comprueba que produce un valor ÚNICO (el mismo para las dos variantes) ≠ del correcto por-variante.
    const brokenDerivedByVariant: Record<string, string | undefined> = {};

    const n7cBrokenStub: StepExecutor = async ({ collectOutput, variantId }) => {
      // Resolver ROTO: "el primer tts_audio del RUN" — ignora ctx.deps. Lee el primer N7b succeeded del
      // run (cualquiera de las variantes) y toma su primer clip. Con 2 variantes, ambas obtienen el MISMO.
      const { rows } = await tdb.pool.query<{ output_refs: N7bOutput }>(
        "SELECT output_refs FROM step_run WHERE node_key = 'N7b' AND status = 'succeeded' ORDER BY id LIMIT 1",
      );
      brokenDerivedByVariant[variantId ?? ''] = rows[0]?.output_refs.clips[0]?.assetId;
      collectOutput?.({ node: 'N7c' });
      return Promise.resolve();
    };

    const executors: Record<string, StepExecutor> = {
      [K.n6]: ({ collectOutput }) => {
        collectOutput?.({ node: 'N6' });
        return Promise.resolve();
      },
      [K.n7b]: n7bStub(),
      [K.n7c]: n7cBrokenStub,
    };

    const { deps, cleanup } = await startWorkerWith(tdb, executors);
    harnessCleanup = cleanup;

    const projectId = await seedProject(tdb);
    const def = generationRunDefinition(projectId, [
      voiceAvatarVariant('vA'),
      voiceAvatarVariant('vB'),
    ]);
    const { runId } = await createRun(deps, def);

    await waitFor(
      async () => {
        const { rows } = await tdb.pool.query<{ n: string }>(
          "SELECT count(*)::int AS n FROM step_run WHERE run_id = $1 AND status = 'succeeded'",
          [runId],
        );
        return Number(rows[0]?.n ?? 0) === 6;
      },
      30_000,
      'los 6 steps succeeded',
      50,
    );

    // EL RESOLVER ROTO cruza: A y B obtienen el MISMO assetId (el primero del run) — al menos una de las
    // dos consumió el audio de la OTRA variante. Esto es EXACTAMENTE lo que el resolver correcto evita.
    const a = brokenDerivedByVariant.vA;
    const b = brokenDerivedByVariant.vB;
    expect(a).toBe(b); // cruzado: el mismo audio para ambas
    // Y ese valor cruzado es el de UNA sola variante — la otra recibió el audio equivocado (gasto de vídeo
    // en el asset de otra variante, el bug de dinero de §9.6).
    const crossed = a !== HOOK_AUDIO.vA || b !== HOOK_AUDIO.vB;
    expect(crossed).toBe(true);
  }, 60_000);
});
