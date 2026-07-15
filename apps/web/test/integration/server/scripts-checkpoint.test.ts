// LA VERIFICACIÓN DE T2.6 en su parte DETERMINISTA (regla de trabajo 8: vive en `pnpm gate`). Prueba
// los DOS efectos de dominio nuevos contra Postgres real, al nivel del SEAM (server/), que es donde
// vive la lógica que ninguna otra capa cubre:
//
//   1. CP2 → N5 · ATOMICIDAD (`createBatchForStep` con `withTransaction`): aprobar CP2 crea el
//      `ad_batch` + sus `ad_variant` Y arranca el run de N5 (un `pipeline_run` NUEVO con su step N5
//      encolado) en UNA sola tx. Si `createRun` falla, el lote TAMPOCO persiste (rollback).
//
//   2. CP3 · BLOQUEO SERVER-SIDE (`approveScriptsForStep`): los veredictos por-variante — v2 SOLO en
//      edición real, `scripted` SOLO si no queda flag bloqueante. Un POST directo con `approved:true`
//      sobre un guion con flag bloqueante NO transiciona la variante (el guard vive en el servidor,
//      no en el botón). Se re-lintea SERVER-SIDE: no se confía en flags del cliente.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';
import { newUlid } from '@ugc/core/contracts';
import type { AdScript, GuardrailFlag, N4Output, N5Output } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { planBatch } from '@ugc/core/strategy';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import {
  createBatchWithVariants,
  createScriptsForBatch,
  ensureQueue,
  listBatchVariants,
  listPlanningInputs,
  seedLibrary,
  withDomainTransaction,
  type Db,
} from '@ugc/db';
import { persona, productBrief, project, urlAnalysis } from '@ugc/db/schema';
import {
  createTestDatabase,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeTestLogger,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { createBatchForStep } from '@/server/batch-checkpoint';
import { approveScriptsForStep } from '@/server/script-checkpoint';

let tdb: TestDatabase;
let boss: PgBoss;

const BRIEF = makeBrief();

const LUCIA = {
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female' as const,
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural',
  setting: 'baño luminoso',
  personality: 'cercana',
};

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'web:scripts-checkpoint' });
  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* irrelevante */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
  await tdb.db.insert(persona).values(LUCIA);
});

afterAll(async () => {
  await boss.stop({ graceful: true, timeout: 10_000 });
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query(
    'TRUNCATE ad_script, ad_variant, ad_batch, step_run, pipeline_run, product_brief, url_analysis, project CASCADE',
  );
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

/** Siembra proyecto + análisis + brief. Devuelve ids. */
async function seedBrief(): Promise<{ projectId: string; briefId: string }> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();
  return { projectId: p!.id, briefId: brief!.id };
}

/** El artefacto N4 que un step de CP2 lleva en su `output_refs` (lo lee `createBatchForStep`). */
async function n4Output(briefId: string): Promise<N4Output> {
  const { libraryHooks, personas, recipe } = await listPlanningInputs(tdb.db, 'test');
  const config = {
    angleIndices: [0, 1],
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'test' as const,
    languages: ['es'],
    personaMode: 'rotate' as const,
  };
  const { plan } = planBatch({ brief: BRIEF, config, libraryHooks, personas, recipe: recipe! });
  return { briefId, brief: BRIEF, config, plan };
}

const MATRIX_DECISION = {
  kind: 'matrix' as const,
  config: {
    angleIndices: [0, 1],
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'test' as const,
    languages: ['es'],
    personaMode: 'rotate' as const,
  },
};

describe('CP2 → N5 · atomicidad (T2.6): aprobar CP2 crea el lote Y arranca el run de N5 en UNA tx', () => {
  it('crea el ad_batch + sus variantes Y un pipeline_run NUEVO con el step N5 encolado', async () => {
    const { briefId } = await seedBrief();
    const output = await n4Output(briefId);

    const result = await withDomainTransaction(
      tdb.db,
      boss,
      makeTestLogger(),
      ({ db, withTransaction }) => createBatchForStep(db, withTransaction, output, MATRIX_DECISION),
    );

    expect(result).toBeDefined();
    const nextRunId = result!.nextRunId;
    expect(nextRunId).toBeTruthy();

    // El lote y sus variantes existen.
    const { rows: batches } = await tdb.pool.query('SELECT id FROM ad_batch');
    expect(batches).toHaveLength(1);
    const variants = await listBatchVariants(tdb.db, result!.batch.batch.id);
    expect(variants.length).toBeGreaterThan(0);

    // Un pipeline_run NUEVO (el de N5), con un step N5 encolado.
    const { rows: runs } = await tdb.pool.query<{ id: string }>(
      'SELECT id FROM pipeline_run WHERE id = $1',
      [nextRunId],
    );
    expect(runs).toHaveLength(1);
    const { rows: steps } = await tdb.pool.query<{ node_key: string; status: string }>(
      'SELECT node_key, status FROM step_run WHERE run_id = $1',
      [nextRunId],
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.node_key).toBe('N5');
    // El root se encola al crear el run (pending→queued en la misma tx).
    expect(steps[0]?.status).toBe('queued');
    // Y su job existe en pg-boss (encolado transaccional).
    const { rows: jobs } = await tdb.pool.query<{ count: string }>(
      `SELECT count(*) FROM pgboss.job WHERE name = $1`,
      [stepExecuteJob.name],
    );
    expect(Number(jobs[0]?.count)).toBe(1);
  });

  it('si algo FALLA tras crear el lote+run, NADA persiste (rollback de la tx entera)', async () => {
    // El invariante de atomicidad, forzado: `createBatchForStep` crea el lote Y arranca el run de N5,
    // ambos en la tx del scope; luego se lanza DENTRO de esa misma tx. La tx externa debe deshacer
    // TODO —lote, variantes y run— sin dejar un lote colgado sin nadie que lo guionice, ni un run de
    // N5 apuntando a un lote que el rollback borró. (Que las DOS mitades compartan la tx es
    // exactamente lo que hace posible este rollback conjunto — el punto de la tarea.)
    const { briefId } = await seedBrief();
    const output = await n4Output(briefId);

    await expect(
      withDomainTransaction(tdb.db, boss, makeTestLogger(), async ({ db, withTransaction }) => {
        const result = await createBatchForStep(db, withTransaction, output, MATRIX_DECISION);
        // Dentro de la MISMA tx que acaba de crear lote+run: forzamos el fallo. Simula cualquier
        // error posterior en el callback de aprobación (persistir la decisión, la transición…).
        expect(result?.nextRunId).toBeTruthy();
        throw new Error('fallo forzado tras crear lote+run');
      }),
    ).rejects.toThrow(/fallo forzado/);

    // LO QUE IMPORTA: NO quedó ni un lote (ni variantes, ni run). Todo o nada.
    const { rows: batches } = await tdb.pool.query<{ count: string }>(
      'SELECT count(*) FROM ad_batch',
    );
    expect(Number(batches[0]?.count)).toBe(0);
    const { rows: variants } = await tdb.pool.query<{ count: string }>(
      'SELECT count(*) FROM ad_variant',
    );
    expect(Number(variants[0]?.count)).toBe(0);
    const { rows: runs } = await tdb.pool.query<{ count: string }>(
      'SELECT count(*) FROM pipeline_run',
    );
    expect(Number(runs[0]?.count)).toBe(0);
  });
});

// ── CP3 · el efecto de dominio y su BLOQUEO SERVER-SIDE ────────────────────────────────────────────
function makeScriptContract(overrides: Partial<AdScript> = {}): AdScript {
  const hook = overrides.hook ?? 'Mira esto ya.';
  return {
    filenameCode: 'x-es-30s',
    hook,
    cta: 'Enlace abajo.',
    scenes: [
      {
        t: 0,
        seconds: 2,
        segment: 'hook',
        narration: hook,
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 2,
        seconds: 5,
        segment: 'body',
        narration: 'Cuerpo.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 7,
        seconds: 2,
        segment: 'cta',
        narration: 'Enlace abajo.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
    ],
    subtitles: [{ start: 0, end: 2, text: hook }],
    fullText: `${hook} Cuerpo. Enlace abajo.`,
    wordCount: 6,
    estSeconds: 9,
    tone: 'directo',
    language: 'es',
    sharedBodyKey: 'body-key',
    ...overrides,
  };
}

/** Siembra un lote con `n` variantes + sus guiones v1 (con los flags dados). Devuelve el N5Output que
 *  un step de N5 llevaría y los ids de variante. */
async function seedScriptedBatch(
  db: Db,
  n: number,
  flagsPerVariant: GuardrailFlag[][],
): Promise<{ output: N5Output; variantIds: string[]; batchId: string }> {
  const { briefId, projectId } = await seedBrief();
  const { libraryHooks, personas, recipe } = await listPlanningInputs(db, 'test');
  const config = {
    angleIndices: Array.from({ length: n }, (_, i) => i),
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'test' as const,
    languages: ['es'],
    personaMode: 'rotate' as const,
  };
  const args = { brief: BRIEF, config, libraryHooks, personas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(db, {
    projectId,
    briefId,
    tier: 'test',
    objective: 'hook_test',
    languages: ['es'],
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
  const variants = await listBatchVariants(db, created.batch.id);
  const stepId = newUlid();
  const createdScripts = await createScriptsForBatch(db, {
    stepRunId: stepId,
    scripts: variants.map((v, i) => ({
      variantId: v.id,
      content: makeScriptContract(),
      guardrailFlags: flagsPerVariant[i] ?? [],
    })),
  });
  const output: N5Output = {
    batchId: created.batch.id,
    scriptRefs: createdScripts.map((s, i) => ({
      variantId: s.variantId,
      scriptId: s.id,
      filenameCode: variants[i]!.filenameCode,
      blocked: (flagsPerVariant[i] ?? []).some((f) => f.blocking),
    })),
    status: 'scripted',
    warnings: [],
  };
  return { output, variantIds: variants.map((v) => v.id), batchId: created.batch.id };
}

const BLOCKING_FLAG: GuardrailFlag = {
  rule: 'banned_claim',
  blocking: true,
  excerpt: 'cura el acné',
  explanation: 'afirmación de salud no permitida',
  suggestion: 'reformula sin prometer resultados médicos',
};

async function variantStatus(variantId: string): Promise<string> {
  const { rows } = await tdb.pool.query<{ status: string }>(
    'SELECT status FROM ad_variant WHERE id = $1',
    [variantId],
  );
  return rows[0]!.status;
}

async function scriptVersions(
  variantId: string,
): Promise<{ version: number; edited_by_user: boolean }[]> {
  const { rows } = await tdb.pool.query<{ version: number; edited_by_user: boolean }>(
    'SELECT version, edited_by_user FROM ad_script WHERE variant_id = $1 ORDER BY version',
    [variantId],
  );
  return rows;
}

describe('CP3 · approveScriptsForStep (T2.6): veredictos, v2 solo si edita, bloqueo server-side', () => {
  it('edita UNA variante y aprueba TODAS: exactamente una v2 edited_by_user, todas scripted', async () => {
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 2, [[], []]);

    await approveScriptsForStep(tdb.db, output, {
      kind: 'scripts',
      verdicts: [
        {
          variantId: variantIds[0]!,
          approved: true,
          editedScript: makeScriptContract({ hook: 'Editado de verdad.' }),
        },
        { variantId: variantIds[1]!, approved: true },
      ],
    });

    expect(await variantStatus(variantIds[0]!)).toBe('scripted');
    expect(await variantStatus(variantIds[1]!)).toBe('scripted');
    // La editada tiene v1 + v2 (edited_by_user en la v2); la no editada, solo v1.
    expect(await scriptVersions(variantIds[0]!)).toEqual([
      { version: 1, edited_by_user: false },
      { version: 2, edited_by_user: true },
    ]);
    expect(await scriptVersions(variantIds[1]!)).toEqual([{ version: 1, edited_by_user: false }]);
  });

  it('mandar `editedScript` IDÉNTICO al vigente NO crea v2 (aprobar no es editar)', async () => {
    // El cliente puede redonda-viajar los 6 guiones; solo los REALMENTE tocados crean v2. El
    // servidor compara contra la fila vigente, no se fía de la mera presencia del campo.
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[]]);

    await approveScriptsForStep(tdb.db, output, {
      kind: 'scripts',
      verdicts: [{ variantId: variantIds[0]!, approved: true, editedScript: makeScriptContract() }],
    });

    expect(await variantStatus(variantIds[0]!)).toBe('scripted');
    expect(await scriptVersions(variantIds[0]!)).toEqual([{ version: 1, edited_by_user: false }]);
  });

  it('BLOQUEO SERVER-SIDE: `approved:true` sobre un guion con flag bloqueante NO lo pasa a scripted', async () => {
    // Un POST DIRECTO (saltándose la UI) que dice `approved:true` sobre una variante cuya v1 tiene un
    // flag bloqueante. El servidor NO se fía: relee los flags guardados y RECHAZA la transición.
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[BLOCKING_FLAG]]);

    await approveScriptsForStep(tdb.db, output, {
      kind: 'scripts',
      verdicts: [{ variantId: variantIds[0]!, approved: true }],
    });

    // La variante NO llega a `scripted`: el flag bloqueante manda sobre el `approved` del cliente.
    expect(await variantStatus(variantIds[0]!)).not.toBe('scripted');
  });

  it('BLOQUEO SERVER-SIDE por RE-LINT: un `editedScript` que INTRODUCE un claim prohibido no se aprueba', async () => {
    // El anti-patrón «arnés más cómodo que la realidad»: el cliente manda un guion editado con
    // `approved:true` cuyo texto contiene un claim prohibido del brief. El servidor lo RE-LINTEA
    // (no se fía de que el cliente lo declare limpio) y rechaza la transición. El brief de makeBrief
    // trae banned=['cura el acné']; el guion lo dice.
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[]]);
    const dirty = makeScriptContract({
      hook: 'Este sérum cura el acné.',
      fullText: 'Este sérum cura el acné. Cuerpo. Enlace abajo.',
      scenes: [
        {
          t: 0,
          seconds: 2,
          segment: 'hook',
          narration: 'Este sérum cura el acné.',
          visual: 'v',
          camera: 'c',
          emotion: 'e',
        },
        {
          t: 2,
          seconds: 5,
          segment: 'body',
          narration: 'Cuerpo.',
          visual: 'v',
          camera: 'c',
          emotion: 'e',
        },
        {
          t: 7,
          seconds: 2,
          segment: 'cta',
          narration: 'Enlace abajo.',
          visual: 'v',
          camera: 'c',
          emotion: 'e',
        },
      ],
    });

    await approveScriptsForStep(tdb.db, output, {
      kind: 'scripts',
      verdicts: [{ variantId: variantIds[0]!, approved: true, editedScript: dirty }],
    });

    // La v2 se crea (el usuario editó), PERO la variante NO pasa a scripted: el re-lint server-side
    // cazó el claim. Y la v2 guarda el flag bloqueante.
    expect(await variantStatus(variantIds[0]!)).not.toBe('scripted');
    const { rows } = await tdb.pool.query<{ guardrail_flags: GuardrailFlag[] }>(
      'SELECT guardrail_flags FROM ad_script WHERE variant_id = $1 AND version = 2',
      [variantIds[0]],
    );
    expect(rows[0]?.guardrail_flags.some((f) => f.blocking)).toBe(true);
  });

  it('control POSITIVO: editar un guion RESOLVIENDO el flag lo deja pasar a scripted', async () => {
    // El contraste que demuestra que el bloqueo no es «nunca aprueba»: una variante con flag
    // bloqueante en la v1, editada a un texto LIMPIO, SÍ llega a scripted.
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[BLOCKING_FLAG]]);

    await approveScriptsForStep(tdb.db, output, {
      kind: 'scripts',
      verdicts: [
        {
          variantId: variantIds[0]!,
          approved: true,
          editedScript: makeScriptContract({ hook: 'Hidrata la piel.' }),
        },
      ],
    });

    expect(await variantStatus(variantIds[0]!)).toBe('scripted');
  });

  it('no-op si la decisión no es `scripts` (un artefacto N5 sin decisión de guiones)', async () => {
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[]]);
    await approveScriptsForStep(tdb.db, output, undefined);
    // Sin decisión, nada transiciona.
    expect(await variantStatus(variantIds[0]!)).toBe('planned');
  });
});
