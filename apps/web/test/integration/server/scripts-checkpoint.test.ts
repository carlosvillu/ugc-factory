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
  createAsset,
  createBatchWithVariants,
  createScriptsForBatch,
  ensureQueue,
  listBatchVariants,
  listPlanningInputs,
  seedGallery,
  seedLibrary,
  withDomainTransaction,
  type Db,
} from '@ugc/db';
import { persona, productBrief, project, urlAnalysis } from '@ugc/db/schema';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
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

// Persona enriquecida para el path de GENERACIÓN de CP3 (T4.11): con imagen de referencia (el
// `imageAssetId` de N7c) y un `voiceMap` con proveedor PREMIUM (elevenlabs, §13.1) — así
// `buildVariantGenerationPlan` resuelve el avatar (referenceImageIds[0]) y el triple de voz
// (elevenlabs ↔ eleven-v3) sin lanzar en las ramas que no son el foco del test. Inocuo para los
// tests de tier-test (que no construyen ningún plan: sus variantes no llegan a `scripted`).
const LUCIA_BASE = {
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female' as const,
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural',
  setting: 'baño luminoso',
  personality: 'cercana',
  voiceMap: { es: { provider: 'elevenlabs' as const, voiceId: 'rachel_v3' } },
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
  // La galería (model_profiles): `buildVariantGenerationPlan` resuelve los endpoints premium contra
  // `model_profile` (money-gate) — sin el seed, todo endpoint sería "no resoluble" y lanzaría.
  const gseed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!gseed.ok || !gseed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, gseed.seed);
  // La imagen de referencia de la Persona (kind reference_image): su assetId es el `imageAssetId` de N7c.
  const refImage = await createAsset(tdb.db, {
    kind: 'reference_image',
    storageKey: `refs/lucia-${newUlid()}.png`,
    mime: 'image/png',
    bytes: 1024,
    checksum: 'deadbeef',
  });
  await tdb.db.insert(persona).values({ ...LUCIA_BASE, referenceImageIds: [refImage.id] });
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

    // Un pipeline_run NUEVO (el de N5), con un step N5 encolado. T5c.3: su `batch_id` a nivel de run
    // apunta al lote recién creado (correlación consultable, prerequisito del grafo único T5c.6).
    const { rows: runs } = await tdb.pool.query<{ id: string; batch_id: string | null }>(
      'SELECT id, batch_id FROM pipeline_run WHERE id = $1',
      [nextRunId],
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.batch_id).toBe(result!.batch.batch.id);
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
  tier: 'test' | 'premium' = 'test',
): Promise<{ output: N5Output; variantIds: string[]; batchId: string }> {
  const { briefId, projectId } = await seedBrief();
  const { libraryHooks, personas, recipe } = await listPlanningInputs(db, tier);
  const config = {
    angleIndices: Array.from({ length: n }, (_, i) => i),
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier,
    languages: ['es'],
    personaMode: 'rotate' as const,
  };
  const args = { brief: BRIEF, config, libraryHooks, personas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(db, {
    projectId,
    briefId,
    tier,
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

/** Invoca `approveScriptsForStep` EXACTAMENTE como el efecto de dominio en producción: dentro de un
 *  `withDomainTransaction` (el `db` que recibe ES la tx, y comparte `withTransaction`). Así el arranque
 *  del run de generación (T4.11) —`applyScriptVerdicts` por `db` + `createRun` por `withTransaction`— va
 *  en UNA sola tx, que es lo que hace atómica la aprobación. Devuelve el resultado (con `nextRunId`). */
async function approveInTx(
  output: N5Output,
  decision: Parameters<typeof approveScriptsForStep>[3],
): Promise<{ nextRunId?: string; generationSkipped?: { reason: 'tier_not_ready'; tier: string } }> {
  return withDomainTransaction(tdb.db, boss, makeTestLogger(), ({ db, withTransaction }) =>
    approveScriptsForStep(db, withTransaction, output, decision),
  );
}

/** El nº de `pipeline_run` de generación existentes (para asertar "no arrancó ningún run"). El run de
 *  N5 de CP2 no lo crea este harness — cualquier `pipeline_run` aquí es el de generación de CP3. */
async function pipelineRunCount(): Promise<number> {
  const { rows } = await tdb.pool.query<{ count: string }>('SELECT count(*) FROM pipeline_run');
  return Number(rows[0]?.count);
}

/** El conjunto de `node_key` DISTINTOS del run de generación (T5.8b): con él se afirma que el flujo NORMAL
 *  emite la cola de composición N8 (máster+C2PA) → N9 (CP4), no solo N6→N7. Antes de T5.8b el run se
 *  cortaba en N7 y este set NO contenía N8/N9 — el control negativo de la tarea. */
async function generationRunNodeKeys(runId: string): Promise<Set<string>> {
  const { rows } = await tdb.pool.query<{ node_key: string }>(
    'SELECT DISTINCT node_key FROM step_run WHERE run_id = $1',
    [runId],
  );
  return new Set(rows.map((r) => r.node_key));
}

describe('CP3 · approveScriptsForStep (T2.6): veredictos, v2 solo si edita, bloqueo server-side', () => {
  // T4.11: los tests cuyas variantes LLEGAN a `scripted` arrancan el run de generación N6→N7 en la
  // misma tx, y `buildVariantGenerationPlan` exige un recipe con endpoints REALES → van en `premium`
  // (el broll de tier-test es aún ETIQUETA, money-gate). Se invocan vía `approveInTx` (como el efecto
  // de dominio de producción). Los tests de BLOQUEO/no-op mantienen tier-test: sus variantes no pasan a
  // `scripted`, no se construye ningún plan, y ADEMÁS se asserta que NO arrancó ningún run.
  it('edita UNA variante y aprueba TODAS: exactamente una v2 edited_by_user, todas scripted', async () => {
    const { output, variantIds, batchId } = await seedScriptedBatch(tdb.db, 2, [[], []], 'premium');

    const result = await approveInTx(output, {
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
    // T4.11: aprobar arrancó el run de generación N6→N7 (patrón `nextRunId` de CP2).
    expect(result.nextRunId).toBeTruthy();
    expect(await pipelineRunCount()).toBe(1);
    // T5c.3: el run de generación lleva el `batch_id` del lote a nivel de run → correlacionable con el
    // run de N5 del MISMO lote por SELECT (prerequisito del grafo único T5c.6).
    const { rows: genRun } = await tdb.pool.query<{ batch_id: string | null }>(
      'SELECT batch_id FROM pipeline_run WHERE id = $1',
      [result.nextRunId],
    );
    expect(genRun[0]?.batch_id).toBe(batchId);
  });

  it('T5.8b · el run de generación del flujo NORMAL emite la cola de composición N8 (máster) + N9 (CP4)', async () => {
    // EL GAP DE PLAN de F5 que T5.8b cierra: antes, el flujo normal (CP3-approve) arrancaba un run que se
    // CORTABA en N7 (sin máster, sin C2PA, sin CP4) — `buildVariantGenerationPlan` no emitía n8/n9. Ahora
    // `withComposition` añade la cola: el run del flujo normal DEBE incluir N8 y N9. Es la cláusula
    // determinista de la Verificación (regla 8) protegida contra regresión — si alguien quita
    // `withComposition` del CP3-approve, este test se pone ROJO (el run vuelve a cortarse en N7).
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[]], 'premium');

    const result = await approveInTx(output, {
      kind: 'scripts',
      verdicts: [{ variantId: variantIds[0]!, approved: true }],
    });

    expect(result.nextRunId).toBeTruthy();
    const nodeKeys = await generationRunNodeKeys(result.nextRunId!);
    // El sub-DAG completo N6→N7→N8→N9 del flujo normal.
    for (const k of ['N6', 'N7a', 'N7b', 'N7c', 'N7d', 'N7e']) {
      expect(nodeKeys, `el sub-DAG premium debe incluir ${k}`).toContain(k);
    }
    // La cola de composición de T5.8b (la que faltaba): máster+C2PA (N8) → checkpoint CP4 (N9).
    expect(nodeKeys, 'el flujo normal debe componer el máster (N8)').toContain('N8');
    expect(nodeKeys, 'el flujo normal debe pausar en CP4 (N9)').toContain('N9');
  });

  it('mandar `editedScript` IDÉNTICO al vigente NO crea v2 (aprobar no es editar)', async () => {
    // El cliente puede redonda-viajar los 6 guiones; solo los REALMENTE tocados crean v2. El
    // servidor compara contra la fila vigente, no se fía de la mera presencia del campo.
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[]], 'premium');

    const result = await approveInTx(output, {
      kind: 'scripts',
      verdicts: [{ variantId: variantIds[0]!, approved: true, editedScript: makeScriptContract() }],
    });

    expect(await variantStatus(variantIds[0]!)).toBe('scripted');
    expect(await scriptVersions(variantIds[0]!)).toEqual([{ version: 1, edited_by_user: false }]);
    // Llegó a scripted → arrancó su run.
    expect(result.nextRunId).toBeTruthy();
  });

  it('BLOQUEO SERVER-SIDE: `approved:true` sobre un guion con flag bloqueante NO lo pasa a scripted', async () => {
    // Un POST DIRECTO (saltándose la UI) que dice `approved:true` sobre una variante cuya v1 tiene un
    // flag bloqueante. El servidor NO se fía: relee los flags guardados y RECHAZA la transición.
    //
    // El lote lleva DOS variantes —una limpia aprobada, una bloqueada— a propósito: así la limpia da al
    // lote un camino hacia delante (1 `scripted`) y el foco de ESTE test —el bloqueo server-side de la
    // otra— se aísla del guard de «0 aprobadas» de T5.14 (que, con la bloqueada SOLA, haría que 0
    // quedaran `scripted` y el lote se rechazara entero — otro invariante, cubierto en su propio test).
    // Premium: la limpia llega a `scripted` y arranca su run.
    const { output, variantIds } = await seedScriptedBatch(
      tdb.db,
      2,
      [[], [BLOCKING_FLAG]],
      'premium',
    );

    const result = await approveInTx(output, {
      kind: 'scripts',
      verdicts: [
        { variantId: variantIds[0]!, approved: true },
        { variantId: variantIds[1]!, approved: true },
      ],
    });

    // La bloqueada NO llega a `scripted`: el flag bloqueante manda sobre el `approved` del cliente.
    expect(await variantStatus(variantIds[1]!)).not.toBe('scripted');
    // La limpia SÍ (el bloqueo es de la variante, no del lote) ⇒ hay una variante que generar.
    expect(await variantStatus(variantIds[0]!)).toBe('scripted');
    expect(result.nextRunId).toBeTruthy();
  });

  it('BLOQUEO SERVER-SIDE por RE-LINT: un `editedScript` que INTRODUCE un claim prohibido no se aprueba', async () => {
    // El anti-patrón «arnés más cómodo que la realidad»: el cliente manda un guion editado con
    // `approved:true` cuyo texto contiene un claim prohibido del brief. El servidor lo RE-LINTEA
    // (no se fía de que el cliente lo declare limpio) y rechaza la transición. El brief de makeBrief
    // trae banned=['cura el acné']; el guion lo dice.
    //
    // Dos variantes (premium): [0] limpia aprobada —el camino hacia delante del lote— y [1] la que se
    // edita a un texto sucio. Así el foco (el RE-LINT bloquea a [1]) se aísla del guard de T5.14 (con [1]
    // sola, 0 quedarían `scripted` y el lote se rechazaría entero).
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 2, [[], []], 'premium');
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

    const result = await approveInTx(output, {
      kind: 'scripts',
      verdicts: [
        { variantId: variantIds[0]!, approved: true },
        { variantId: variantIds[1]!, approved: true, editedScript: dirty },
      ],
    });

    // La v2 de la editada se crea (el usuario editó), PERO la variante NO pasa a scripted: el re-lint
    // server-side cazó el claim. Y la v2 guarda el flag bloqueante.
    expect(await variantStatus(variantIds[1]!)).not.toBe('scripted');
    const { rows } = await tdb.pool.query<{ guardrail_flags: GuardrailFlag[] }>(
      'SELECT guardrail_flags FROM ad_script WHERE variant_id = $1 AND version = 2',
      [variantIds[1]],
    );
    expect(rows[0]?.guardrail_flags.some((f) => f.blocking)).toBe(true);
    // La limpia SÍ pasa a scripted ⇒ el lote tiene camino hacia delante y arranca su run.
    expect(await variantStatus(variantIds[0]!)).toBe('scripted');
    expect(result.nextRunId).toBeTruthy();
  });

  it('control POSITIVO: editar un guion RESOLVIENDO el flag lo deja pasar a scripted', async () => {
    // El contraste que demuestra que el bloqueo no es «nunca aprueba»: una variante con flag
    // bloqueante en la v1, editada a un texto LIMPIO, SÍ llega a scripted. Premium (llega a scripted
    // → arranca run).
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[BLOCKING_FLAG]], 'premium');

    const result = await approveInTx(output, {
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
    expect(result.nextRunId).toBeTruthy();
  });

  it('no-op si la decisión no es `scripts` (un artefacto N5 sin decisión de guiones)', async () => {
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[]]);
    const result = await approveInTx(output, undefined);
    // Sin decisión, nada transiciona.
    expect(await variantStatus(variantIds[0]!)).toBe('planned');
    // Y no arranca ningún run.
    expect(result.nextRunId).toBeUndefined();
    expect(await pipelineRunCount()).toBe(0);
  });

  // ── MONEY-SAFETY: un tier NO generation-ready nunca crea un pipeline_run ─────────────────────────────
  // (Reemplaza al viejo test de ATOMICIDAD de T4.11, que afirmaba que aprobar en tier-test LANZA y revierte
  //  los veredictos — ese era el comportamiento REGRESIVO: la aprobación de guiones fallaba con 500 en todo
  //  tier no-premium. Corregido con el desacople de etapas 2026-07-23; el invariante money-safety que SIGUE
  //  vivo es este: jamás se arranca un run —ni se gasta— en un tier cuyo b-roll es aún etiqueta.)
  it('MONEY-SAFETY: un tier no generation-ready (b-roll etiqueta) aprueba los guiones SIN crear ningún run', async () => {
    // Dos variantes aprobables (sin flag) en tier-TEST. `isTierGenerationReady('test')` es false (broll
    // aún etiqueta, §13.1) → la generación NO se intenta: las variantes quedan `scripted` (la aprobación
    // de guiones es un hecho sobre el texto) y NO se crea ni un `pipeline_run` (nada que pueda gastar).
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 2, [[], []], 'test');

    const result = await approveInTx(output, {
      kind: 'scripts',
      verdicts: [
        { variantId: variantIds[0]!, approved: true },
        { variantId: variantIds[1]!, approved: true },
      ],
    });

    // Aprobadas y `scripted` (el desacople NO debilita la aprobación)...
    expect(await variantStatus(variantIds[0]!)).toBe('scripted');
    expect(await variantStatus(variantIds[1]!)).toBe('scripted');
    // ...pero CERO runs: el money-gate sigue vivo (ningún gasto en un tier que no puede generar).
    expect(result.nextRunId).toBeUndefined();
    expect(await pipelineRunCount()).toBe(0);
    // T5c.2: el stop ya NO es mudo. El resultado señala EXPLÍCITAMENTE que la generación se saltó por
    // tier-no-listo, nombrando el tier — es lo que viaja hasta la UI para hacer visible el stop.
    expect(result.generationSkipped).toEqual({ reason: 'tier_not_ready', tier: 'test' });
  });

  // ── NEGATIVE CONTROL del desacople: en un tier SÍ generation-ready, un fallo REAL del plan SIGUE ─────
  // ATÓMICO (throw → rollback de los veredictos). El desacople toleró SOLO el endpoint-pendiente-F4
  // (benigno) vía predicado; NO debe tragarse los errores REALES (persona sin imagen, voz incoherente).
  // Guarda contra un futuro try/catch que colapse ambos (la trampa de esta sesión, principio 9 / regla 5a).
  it('ATOMICIDAD en tier ready: un fallo REAL del plan (persona sin imagen) LANZA y hace rollback de los veredictos', async () => {
    // Premium ES generation-ready → se construye el plan. Se vacía `reference_image_ids` de la persona de
    // la variante (dato en reposo, SQL) → `buildVariantGenerationPlan` LANZA en el gate de avatar (N7c
    // exige `referenceImageIds[0]`). Como comparte la tx de `withDomainTransaction`, el throw revierte
    // TODO: la variante NO queda `scripted`, sin `pipeline_run` colgado. Es un fallo RUIDOSO (correcto):
    // el desacople no lo silencia porque no es un endpoint-pendiente, es una persona mal configurada.
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 1, [[]], 'premium');
    await tdb.pool.query(
      `UPDATE persona SET reference_image_ids = '{}'::text[]
        WHERE id = (SELECT persona_id FROM ad_variant WHERE id = $1)`,
      [variantIds[0]],
    );

    await expect(
      approveInTx(output, {
        kind: 'scripts',
        verdicts: [{ variantId: variantIds[0]!, approved: true }],
      }),
      // T5.15: el error es TIPADO y accionable — nombra la persona, el nodo que no puede generar
      // (N7c/avatar) y qué hacer (subir una imagen en /personas), en vez del genérico anterior.
    ).rejects.toThrow(/no tiene imágenes de referencia: N7c\/avatar no puede generar/);

    // El rollback deshizo el veredicto: la variante sigue sin `scripted`, y CERO runs.
    expect(await variantStatus(variantIds[0]!)).not.toBe('scripted');
    expect(await pipelineRunCount()).toBe(0);
  });

  // ── T5.11 · UN LOTE TRUNCADO NO SE APRUEBA NI POR POST DIRECTO ──────────────────────────────────
  // El defecto del run de T5.9: N5 murió a mitad (saldo Anthropic) con 5 de 12 guiones y CP3 dejaba
  // aprobar ⇒ generación de PAGO sobre un lote incompleto. El executor ya impide que ese step llegue a
  // `waiting_approval`, pero esta es la cerradura del SERVIDOR sobre el estado REAL de la BD: alcanza a
  // un step pausado ANTES del fix y a cualquier cliente hecho a mano. Mismo criterio que el bloqueo
  // server-side de los flags: el `approved` del cliente es su INTENCIÓN, la decisión la DERIVA el
  // servidor. El invariante que protege es DINERO: cero `pipeline_run` de generación.
  it('T5.11 MONEY-SAFETY: un lote con menos guiones que variantes se RECHAZA y no arranca ningún run', async () => {
    // Tier premium (generation-ready: sin el guard, ESTE es el camino que SÍ gastaría) con 2 variantes,
    // y se BORRA el guion de una — el estado exacto que deja un `api_error` a mitad de N5 (las filas
    // escritas se conservan; las que faltan, faltan). Dato en reposo por SQL, no por clicks.
    // La persona vive en `beforeAll` (NO se trunca): el test de ATOMICIDAD de arriba le VACÍA la
    // imagen de referencia. Sin restaurarla, el camino de generación reventaría por OTRA causa y el
    // CONTROL NEGATIVO de este test sería mentira (rojo por el motivo equivocado: quitar el guard
    // seguiría lanzando, ahora desde `buildVariantGenerationPlan`). Restaurarla garantiza que, sin el
    // guard, la aprobación llega DE VERDAD a `createRun` — que es el gasto que hay que impedir.
    await tdb.pool.query(
      `UPDATE persona SET reference_image_ids = ARRAY[(SELECT id FROM asset WHERE kind = 'reference_image' LIMIT 1)]`,
    );
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 2, [[], []], 'premium');
    await tdb.pool.query('DELETE FROM ad_script WHERE variant_id = $1', [variantIds[1]]);

    await expect(
      approveInTx(output, {
        kind: 'scripts',
        // El cliente pide aprobar SOLO la que tiene guion: es justo el POST que la UI truncada
        // enviaba. Aun así se rechaza — el lote, no el veredicto, es lo que está incompleto.
        verdicts: [{ variantId: variantIds[0]!, approved: true }],
      }),
    ).rejects.toThrow(/INCOMPLETO: 1\/2 guiones escritos/);

    // Ni transición ni gasto: la variante NO queda `scripted` y no hay run de generación.
    expect(await variantStatus(variantIds[0]!)).not.toBe('scripted');
    expect(await pipelineRunCount()).toBe(0);
  });

  // ── T5.14 · CONFIRMAR CON 0 APROBADAS NO ES UN CAMINO SIN RETORNO ──────────────────────────────
  // El BUG DE PRODUCCIÓN (lote 01KYEW7DE974AKZC6JMJDZE38D, la rama VECINA a T5.11 con peor desenlace):
  // pulsar «Confirmar» sin aprobar ninguna variante devolvía 200 mudo, consumía el checkpoint
  // (N5 → succeeded) y dejaba el lote VARADO —guiones ya pagados, 0 variantes hacia delante, 2º POST
  // 409—. La causa: `scriptedVariantIds.length === 0` devolvía `{}` DESPUÉS de que `applyScriptVerdicts`
  // ya había consumido el checkpoint, tratando «confirmé sin aprobar» (error irreversible) igual que
  // «todo rechazado». Ahora es un `validation_error` TIPADO lanzado ANTES de `applyScriptVerdicts`.
  //
  // POR QUÉ EL THROW ES EL FIX (no un `{}`): al lanzar dentro de `withDomainTransaction`, la tx externa
  // (que incluye la transición del step de `approveStep` en producción) revierte — el checkpoint NO se
  // consume. A este nivel de SEAM se afirma el invariante equivalente: NADA transiciona, NADA se aplica,
  // el error es tipado. El CONTROL NEGATIVO (revertir el fix → `applyScriptVerdicts` corre → el
  // checkpoint se consumiría y el 2º POST daría 409) queda cubierto porque la asersión clave es que el
  // throw ocurre ANTES de cualquier escritura: sin el guard, este test se pone ROJO (ya no lanza, y la
  // variante quedaría o intacta pero con el checkpoint consumido — la irreversibilidad que se prohíbe).
  it('T5.14: confirmar con 0 aprobadas se RECHAZA (validation_error) sin consumir el checkpoint ni transicionar nada', async () => {
    // Lote COMPLETO (no truncado: esto NO es el caso de T5.11) con 2 variantes limpias, y el cliente
    // confirma RECHAZANDO ambas (`approved:false`) — justo el POST que la UI de «0/6 aprobadas» mandaba.
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 2, [[], []], 'premium');

    await expect(
      approveInTx(output, {
        kind: 'scripts',
        verdicts: [
          { variantId: variantIds[0]!, approved: false },
          { variantId: variantIds[1]!, approved: false },
        ],
      }),
    ).rejects.toThrow(/no aprobaría NINGUNA variante/);

    // NADA transicionó (el checkpoint sigue vivo: en producción el step seguiría en `waiting_approval`
    // y el 2º POST volvería a funcionar, no daría 409) y CERO gasto.
    expect(await variantStatus(variantIds[0]!)).toBe('planned');
    expect(await variantStatus(variantIds[1]!)).toBe('planned');
    expect(await pipelineRunCount()).toBe(0);
  });

  it('T5.14: aprobar SOLO variantes con flag bloqueante (0 quedarían scripted) también se RECHAZA — mismo error irreversible', async () => {
    // El caso gemelo: el cliente marca `approved:true` pero TODAS tienen flag bloqueante ⇒ el bloqueo
    // server-side las deja fuera de `scripted`. El desenlace es idéntico al de «0 aprobadas» (0 hacia
    // delante), así que comparte el guard: no puede consumir el checkpoint en silencio.
    const { output, variantIds } = await seedScriptedBatch(
      tdb.db,
      2,
      [[BLOCKING_FLAG], [BLOCKING_FLAG]],
      'premium',
    );

    await expect(
      approveInTx(output, {
        kind: 'scripts',
        verdicts: [
          { variantId: variantIds[0]!, approved: true },
          { variantId: variantIds[1]!, approved: true },
        ],
      }),
    ).rejects.toThrow(/no aprobaría NINGUNA variante/);

    expect(await variantStatus(variantIds[0]!)).toBe('planned');
    expect(await variantStatus(variantIds[1]!)).toBe('planned');
    expect(await pipelineRunCount()).toBe(0);
  });

  it('T5.14 control POSITIVO: aprobar AL MENOS UNA sigue confirmando (el guard no encierra el camino feliz)', async () => {
    // El contraste que demuestra que el guard no es «nunca confirma»: aprobar 1 de 2 (la otra rechazada)
    // SÍ pasa — hay una variante hacia delante, el lote no queda varado.
    const { output, variantIds } = await seedScriptedBatch(tdb.db, 2, [[], []], 'premium');

    const result = await approveInTx(output, {
      kind: 'scripts',
      verdicts: [
        { variantId: variantIds[0]!, approved: true },
        { variantId: variantIds[1]!, approved: false },
      ],
    });

    expect(await variantStatus(variantIds[0]!)).toBe('scripted');
    expect(await variantStatus(variantIds[1]!)).not.toBe('scripted');
    expect(result.nextRunId).toBeTruthy();
  });
});
