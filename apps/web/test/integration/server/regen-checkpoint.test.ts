// LA VERIFICACIÓN DE T5.8 (CU4) en su parte DETERMINISTA (regla de trabajo 8: vive en `pnpm gate`).
// Prueba la op «regenerar» de CP4 (`regenerateVariantCta`, server/regen-checkpoint.ts) contra Postgres
// real, al nivel del SEAM (server/). La parte de REUTILIZACIÓN por dedup (asset-ids idénticos pre/post) es
// runtime del worker → vive en el Playwright `partial-regeneration.spec.ts` (no aquí: asertarla sin correr
// los executors reales re-implementaría la dedup — trampa T1.8). Aquí se cubre lo que NINGÚN otro nivel
// cubre:
//
//   1. CLON + RUN REGEN: regenerar clona la variante (guion nuevo con el CTA cambiado) y arranca un
//      `pipeline_run kind='regen'` con su sub-DAG N6→N7→N8→N9 encolado, en UNA tx.
//   2. ATOMICIDAD (restricción 3): si `createRun` falla dentro de la tx, el clon NO sobrevive (rollback).
//   3. TIER NO GENERATION-READY (restricción 1, decouple T4.11): regenerar en un tier con b-roll etiqueta
//      lanza `validation_error` ANTES de clonar — el throw benigno de `buildVariantGenerationPlan` NUNCA se
//      cuela en la tx (ni deja un clon a medias).
//   4. EL CTA SE APLICA: el guion del clon tiene el CTA nuevo; el resto (hook/body) queda idéntico al origen
//      (la base de la dedup — hook/body iguales ⇒ mismos content_hash ⇒ reúso; solo el CTA cambia).
//   5. Un `output_refs` que no es N9 → `validation_error` (no arranca un run sobre una variante equivocada).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';
import { newUlid } from '@ugc/core/contracts';
import type { N9Output } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { planBatch } from '@ugc/core/strategy';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import {
  createBatchWithVariants,
  createScriptsForBatch,
  ensureQueue,
  getLatestScriptsByBatch,
  listBatchVariants,
  listPlanningInputs,
  seedGallery,
  seedLibrary,
  withDomainTransaction,
  type Db,
} from '@ugc/db';
import { createAsset, getVariant, setVariantOwnMusicBed } from '@ugc/db';
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
import { regenerateVariantCta, spawnRegenForStep } from '@/server/regen-checkpoint';

let tdb: TestDatabase;
let boss: PgBoss;

const BRIEF = makeBrief();

// Persona premium COMPLETA (imagen de referencia + voiceMap premium): `buildVariantGenerationPlan` resuelve
// avatar (referenceImageIds[0]) + triple de voz sin lanzar. Es lo que hace `premium` generation-ready.
const LUCIA_BASE = {
  name: 'Lucía Regen',
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
  tdb = await createTestDatabase({ label: 'web:regen-checkpoint' });
  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* irrelevante */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
  const gseed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!gseed.ok || !gseed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, gseed.seed);
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

/** El guion v1 de una variante (CONTRATO AdScript). Escena `cta` con narración conocida para poder asertar
 *  el cambio del CTA. Hook/body fijos: son lo que debe quedar idéntico en el clon (base de la dedup). */
function makeScriptContract(): import('@ugc/core/contracts').AdScript {
  return {
    filenameCode: 'x-es-30s',
    hook: 'Mira esto ya.',
    cta: 'Enlace abajo.',
    scenes: [
      {
        t: 0,
        seconds: 2,
        segment: 'hook',
        narration: 'Mira esto ya.',
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 2,
        seconds: 5,
        segment: 'body',
        narration: 'Cuerpo del anuncio.',
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
    subtitles: [{ start: 0, end: 2, text: 'Mira esto ya.' }],
    fullText: 'Mira esto ya. Cuerpo del anuncio. Enlace abajo.',
    wordCount: 8,
    estSeconds: 9,
    tone: 'directo',
    language: 'es',
    sharedBodyKey: 'body-key',
  };
}

/** Siembra un lote `scripted` (1 variante) en el tier dado, con su guion v1. Devuelve la variante origen y
 *  su lote. La variante queda `scripted` (base para regenerar; en producción llegaría `approved` tras CP4,
 *  pero para la op de regen lo que importa es que exista con guion y máster — el N9Output trae su id). */
async function seedScriptedVariant(
  db: Db,
  tier: 'test' | 'premium',
): Promise<{ variantId: string; batchId: string; projectId: string }> {
  const { briefId, projectId } = await seedBrief();
  const { libraryHooks, personas, recipe } = await listPlanningInputs(db, tier);
  const config = {
    angleIndices: [0],
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
  const variantId = variants[0]!.id;
  await createScriptsForBatch(db, {
    stepRunId: newUlid(),
    scripts: [{ variantId, content: makeScriptContract(), guardrailFlags: [] }],
  });
  await tdb.pool.query(`UPDATE ad_variant SET status = 'approved' WHERE id = $1`, [variantId]);
  return { variantId, batchId: created.batch.id, projectId };
}

/** El N9Output que un step de CP4 lleva en su `output_refs` (la op de regen lee de él la variante origen). */
function n9Output(variantId: string): N9Output {
  return {
    variantId,
    passed: true,
    qaReport: {
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
    },
  };
}

/** Siembra un `pipeline_run` + un `step_run` N9 PAUSADO (`waiting_approval`) sobre `variantId`, con su
 *  `N9Output` en `output_refs` y el marcador de idempotencia NULL — el estado exacto sobre el que el route
 *  de CP4 llama `spawnRegenForStep`. Devuelve el id del step N9 (lo que el route recibe como `:id`). */
async function seedN9Step(projectId: string, variantId: string): Promise<string> {
  const runId = newUlid();
  await tdb.pool.query('INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)', [
    runId,
    projectId,
  ]);
  const stepId = newUlid();
  await tdb.pool.query(
    `INSERT INTO step_run (id, run_id, node_key, variant_id, status, is_checkpoint, checkpoint_config, output_refs, depends_on)
     VALUES ($1, $2, 'N9', $3, 'waiting_approval', true, $4, $5, '{}')`,
    [
      stepId,
      runId,
      variantId,
      JSON.stringify({ alwaysPause: true }),
      JSON.stringify(n9Output(variantId)),
    ],
  );
  return stepId;
}

/** El marcador `spawned_regen_run_id` del N9 (idempotencia T5.8). `null` si aún no lanzó regen. */
async function spawnedRegenRunIdOf(stepId: string): Promise<string | null> {
  const { rows } = await tdb.pool.query<{ spawned_regen_run_id: string | null }>(
    'SELECT spawned_regen_run_id FROM step_run WHERE id = $1',
    [stepId],
  );
  return rows[0]?.spawned_regen_run_id ?? null;
}

/** Invoca `regenerateVariantCta` EXACTAMENTE como el route en producción: dentro de un
 *  `withDomainTransaction` (el `db` que recibe ES la tx y comparte `withTransaction`). */
async function regenInTx(outputRefs: unknown, cta: string): Promise<{ nextRunId: string }> {
  return withDomainTransaction(tdb.db, boss, makeTestLogger(), ({ db, withTransaction }) =>
    regenerateVariantCta(db, withTransaction, outputRefs, cta),
  );
}

async function pipelineRunRows(): Promise<{ id: string; kind: string; batch_id: string | null }[]> {
  const { rows } = await tdb.pool.query<{ id: string; kind: string; batch_id: string | null }>(
    'SELECT id, kind, batch_id FROM pipeline_run',
  );
  return rows;
}

async function variantCount(): Promise<number> {
  const { rows } = await tdb.pool.query<{ count: string }>('SELECT count(*) FROM ad_variant');
  return Number(rows[0]?.count);
}

describe('CP4 · regenerateVariantCta (T5.8, CU4): clon + run regen, atomicidad, tier-gate', () => {
  it('clona la variante con el CTA nuevo y arranca un pipeline_run kind=regen con su sub-DAG encolado', async () => {
    const { variantId, batchId } = await seedScriptedVariant(tdb.db, 'premium');

    const result = await regenInTx(n9Output(variantId), 'Compra ahora con 20% de descuento.');
    expect(result.nextRunId).toBeTruthy();

    // Hay una variante MÁS (el clon) que la original.
    expect(await variantCount()).toBe(2);

    // El run es kind='regen' (lo distingue en la run-list). NO se puebla `pipeline_run.batch_id` (sin lector):
    // el linaje al lote se alcanza vía `step_run.variant_id → ad_variant.batch_id` — se asserta ESE camino.
    const runs = await pipelineRunRows();
    const regenRun = runs.find((r) => r.id === result.nextRunId);
    expect(regenRun?.kind).toBe('regen');
    // Linaje REAL (el que el E2E y el worker usan): el variant_id de un step del run → su batch_id de lote.
    const { rows: n8variant } = await tdb.pool.query<{ variant_id: string | null }>(
      `SELECT variant_id FROM step_run WHERE run_id = $1 AND node_key = 'N8' LIMIT 1`,
      [result.nextRunId],
    );
    const cloneVariantId = n8variant[0]?.variant_id;
    expect(cloneVariantId).toBeTruthy();
    const { rows: cloneBatch } = await tdb.pool.query<{ batch_id: string }>(
      'SELECT batch_id FROM ad_variant WHERE id = $1',
      [cloneVariantId],
    );
    expect(cloneBatch[0]?.batch_id).toBe(batchId);

    // Su sub-DAG existe: N6 (root, encolado) + los N7 + N8 + N9. El root N6 quedó `queued` (encolado en la tx).
    const { rows: steps } = await tdb.pool.query<{ node_key: string; status: string }>(
      'SELECT node_key, status FROM step_run WHERE run_id = $1',
      [result.nextRunId],
    );
    const nodeKeys = steps.map((s) => s.node_key);
    expect(nodeKeys).toContain('N6');
    expect(nodeKeys).toContain('N8');
    expect(nodeKeys).toContain('N9');
    const n6 = steps.find((s) => s.node_key === 'N6');
    expect(n6?.status).toBe('queued');

    // El job de N6 existe en pg-boss (encolado transaccional).
    const { rows: jobs } = await tdb.pool.query<{ count: string }>(
      `SELECT count(*) FROM pgboss.job WHERE name = $1`,
      [stepExecuteJob.name],
    );
    expect(Number(jobs[0]?.count)).toBeGreaterThan(0);
  });

  it('EL CTA SE APLICA al clon y el hook/body quedan IDÉNTICOS al origen (base de la dedup)', async () => {
    const { variantId, batchId } = await seedScriptedVariant(tdb.db, 'premium');

    await regenInTx(n9Output(variantId), 'Compra ahora con envío gratis.');

    // El guion del clon: mismo lote, distinta variante. Su CTA cambió; hook/body no.
    const latest = await getLatestScriptsByBatch(tdb.db, batchId);
    const cloneScript = latest.find((l) => l.variantId !== variantId);
    const sourceScript = latest.find((l) => l.variantId === variantId);
    expect(cloneScript).toBeDefined();
    // El CTA del clon contiene el texto nuevo; el del origen NO.
    expect(cloneScript!.script.cta).toContain('envío gratis');
    expect(sourceScript!.script.cta).toBe('Enlace abajo.');
    // Hook y body IDÉNTICOS entre origen y clon (lo que hará que sus N7 dedupliquen).
    expect(cloneScript!.script.hook).toBe(sourceScript!.script.hook);
    const bodyOf = (scenes: unknown): string | undefined =>
      (scenes as { segment: string; narration: string }[]).find((s) => s.segment === 'body')
        ?.narration;
    expect(bodyOf(cloneScript!.script.scenes)).toBe(bodyOf(sourceScript!.script.scenes));
    // El clon nace `scripted` (listo para generar), edited_by_user (lo tocó el usuario).
    const { rows } = await tdb.pool.query<{ status: string }>(
      'SELECT status FROM ad_variant WHERE id = $1',
      [cloneScript!.variantId],
    );
    expect(rows[0]?.status).toBe('scripted');
  });

  it('T6.2b: un regen de una variante own_license CONSERVA el bed propio en el clon (no re-genera IA)', async () => {
    // Sin esto, regenerar el CTA de una variante con música licenciada re-generaría un bed IA en silencio.
    // El clon debe heredar el puntero al asset music_bed Y `audio_source='own_license'`.
    const { variantId } = await seedScriptedVariant(tdb.db, 'premium');
    const bed = await createAsset(tdb.db, {
      kind: 'music_bed',
      storageKey: `music/${newUlid()}.mp3`,
      mime: 'audio/mpeg',
      bytes: 4096,
      checksum: 'cafef00dcafef00d',
    });
    await setVariantOwnMusicBed(tdb.db, variantId, bed.id);

    await regenInTx(n9Output(variantId), 'Compra ahora con música propia.');

    // Localiza el clon: la variante NUEVA del mismo lote (la que no es el origen).
    const { rows } = await tdb.pool.query<{ id: string }>(
      'SELECT id FROM ad_variant WHERE id != $1 ORDER BY id DESC LIMIT 1',
      [variantId],
    );
    const cloneId = rows[0]!.id;
    const clone = await getVariant(tdb.db, cloneId);
    expect(clone?.ownMusicBedAssetId).toBe(bed.id); // el clon apunta a la MISMA pista licenciada
    expect(clone?.audioSource).toBe('own_license'); // procedencia conservada
  });

  it('ATOMICIDAD (restricción 3): si algo FALLA tras clonar+crear el run, NO queda clon (rollback)', async () => {
    const { variantId } = await seedScriptedVariant(tdb.db, 'premium');
    const before = await variantCount();

    await expect(
      withDomainTransaction(tdb.db, boss, makeTestLogger(), async ({ db, withTransaction }) => {
        const result = await regenerateVariantCta(
          db,
          withTransaction,
          n9Output(variantId),
          'Compra ahora mismo.',
        );
        expect(result.nextRunId).toBeTruthy();
        // Dentro de la MISMA tx que acaba de clonar+crear el run: forzamos el fallo (simula cualquier error
        // posterior del callback). La tx externa debe deshacer TODO: ni clon, ni run, ni steps.
        throw new Error('fallo forzado tras clonar+crear el run');
      }),
    ).rejects.toThrow(/fallo forzado/);

    // NO quedó ni el clon ni el run: todo o nada.
    expect(await variantCount()).toBe(before);
    expect(await pipelineRunRows()).toHaveLength(0);
  });

  it('TIER NO GENERATION-READY (restricción 1): regenerar en tier-test lanza validation_error SIN clonar', async () => {
    // Tier `test`: su b-roll es aún ETIQUETA (§13.1) → `isTierGenerationReady('test')` es false. Regenerar
    // EXIGE generar; se rechaza ANTES de clonar. El throw benigno de `buildVariantGenerationPlan` NUNCA se
    // cuela en la tx (a diferencia de la regresión T4.11), y NO queda un clon a medias.
    const { variantId } = await seedScriptedVariant(tdb.db, 'test');
    const before = await variantCount();

    await expect(regenInTx(n9Output(variantId), 'Compra ahora.')).rejects.toMatchObject({
      code: 'validation_error',
    });

    // No clonó ni creó run.
    expect(await variantCount()).toBe(before);
    expect(await pipelineRunRows()).toHaveLength(0);
  });

  it('un output_refs que NO es N9 → validation_error (no arranca run sobre una variante equivocada)', async () => {
    await expect(regenInTx({ not: 'an N9 artifact' }, 'Compra ahora.')).rejects.toMatchObject({
      code: 'validation_error',
    });
    expect(await pipelineRunRows()).toHaveLength(0);
  });

  it('un CTA vacío → validation_error (nada que regenerar)', async () => {
    const { variantId } = await seedScriptedVariant(tdb.db, 'premium');
    await expect(regenInTx(n9Output(variantId), '   ')).rejects.toMatchObject({
      code: 'validation_error',
    });
    // No clonó (el CTA vacío se rechaza ANTES de la tx del clon).
    expect(await variantCount()).toBe(1);
  });
});

// ── IDEMPOTENCIA CONCURRENTE (bug de DINERO, T5.8): dos POST /regenerate solapados = UN solo run ──────────
// El control que MUERDE el caso REAL: `POST /api/steps/:id/regenerate` NO resuelve el N9 (se queda pausado a
// propósito), así que el guard de estado NO frena un 2º POST. Dos POST sobre el MISMO N9 (retry de red, dos
// pestañas) crearían DOS clones + DOS runs `kind=regen` = DOBLE gasto fal real. Y de paso, dos regens
// concurrentes hacían last-write-wins sobre `ad_batch.matrix` (read-modify-write de `cloneVariantForRegen`),
// perdiendo un clon de la matriz. El lock `SELECT … FOR UPDATE` sobre la fila N9 + el marcador persistente
// (`spawned_regen_run_id`) matan AMBOS: la 2ª tx espera el lock, despierta tras el commit de la 1ª, ve el
// marcador → 409, y su read de la matriz ya no es stale.
//
// POR QUÉ EL SOLAPE ES REAL (no secuencial-disfrazado): el pool de la BD de integración es `max:5`, así que
// las dos txs aterrizan en DOS conexiones y CONTIENDEN en el lock de Postgres — el mecanismo bajo prueba. El
// CONTROL NEGATIVO (verificado en RED, ver informe): cambiar `findStepForRegenGuard`→`findStep` (sin lock) o
// quitar el `markStepRegenSpawned` (sin marcador) pone este test ROJO con DOS runs `kind=regen`.
describe('CP4 · spawnRegenForStep — idempotencia bajo concurrencia (T5.8, bug de dinero)', () => {
  it('dos regeneraciones SOLAPADAS sobre el mismo N9 → EXACTAMENTE un run kind=regen (la 2ª obtiene 409)', async () => {
    const { variantId, projectId } = await seedScriptedVariant(tdb.db, 'premium');
    const n9StepId = await seedN9Step(projectId, variantId);
    const logger = makeTestLogger();

    // Dos llamadas SOLAPADAS (mismo N9, mismo tipo de acción). `allSettled`: no asumimos cuál gana.
    const [a, b] = await Promise.allSettled([
      spawnRegenForStep(tdb.db, boss, logger, n9StepId, 'Compra ahora con envío gratis.'),
      spawnRegenForStep(tdb.db, boss, logger, n9StepId, 'Aprovecha el 20% de descuento hoy.'),
    ]);

    // EXACTAMENTE una cumplió y una fue rechazada (no dos éxitos = doble gasto; no dos fallos = capacidad rota).
    const fulfilled = [a, b].filter(
      (r): r is PromiseFulfilledResult<{ nextRunId: string }> => r.status === 'fulfilled',
    );
    const rejected = [a, b].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // La perdedora falla con `invalid_transition` (el marcador ya estaba puesto), no con un error espurio.
    expect(rejected[0]?.reason).toMatchObject({ code: 'invalid_transition' });

    // EL BUG #1 (doble gasto): exactamente UN run kind=regen — no dos.
    const regenRuns = (await pipelineRunRows()).filter((r) => r.kind === 'regen');
    expect(regenRuns).toHaveLength(1);

    // EL BUG #2 (matrix last-write-wins): exactamente UN clon (2 variantes: origen + 1 clon), no dos ni cero.
    // Si el lock no serializara el read-modify-write de `ad_batch.matrix`, un clon se perdería de la matriz.
    expect(await variantCount()).toBe(2);

    // El marcador del N9 apunta al run ganador (linaje N9→regen).
    const marker = await spawnedRegenRunIdOf(n9StepId);
    expect(marker).toBe(regenRuns[0]?.id);
    expect(marker).toBe(fulfilled[0]?.value.nextRunId);
  });

  it('un 2º regen SECUENCIAL sobre un N9 ya usado → 409 invalid_transition (no un 2º run)', async () => {
    const { variantId, projectId } = await seedScriptedVariant(tdb.db, 'premium');
    const n9StepId = await seedN9Step(projectId, variantId);
    const logger = makeTestLogger();

    const first = await spawnRegenForStep(
      tdb.db,
      boss,
      logger,
      n9StepId,
      'Compra ya con descuento.',
    );
    expect(first.nextRunId).toBeTruthy();

    // El MISMO N9 ya lanzó su regen (marcador puesto) → el 2º intento es 409, sin 2º clon/run.
    await expect(
      spawnRegenForStep(tdb.db, boss, logger, n9StepId, 'Otra vez, otro CTA.'),
    ).rejects.toMatchObject({ code: 'invalid_transition' });

    expect((await pipelineRunRows()).filter((r) => r.kind === 'regen')).toHaveLength(1);
    expect(await variantCount()).toBe(2);
  });
});
