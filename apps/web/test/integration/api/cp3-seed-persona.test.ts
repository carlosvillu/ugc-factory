// T5.15 · CP3 A NIVEL DE RUTA, PARTIENDO DEL SEED LIMPIO (Tests B y C).
//
// El bug de producción de T5.15 era una ANTI-CORRELACIÓN PERFECTA: NINGUNA persona del seed cumplía a la
// vez los DOS gates de generación (N7c/avatar exige `reference_image_ids`; N7b/voz exige un `voiceId` que
// fal acepte). Un usuario recién instalado no podía completar un lote. El fix añade MAYA (imágenes reales
// + voces reales de ElevenLabs) y convierte «persona sin imagen» de un 500 opaco en un 400 accionable.
//
// Estos dos tests cierran el hueco que el control a nivel de DATOS (`seed-data.test.ts`) y el de FILAS
// (`persona-seed.test.ts`, Test A) NO cubren: el comportamiento OBSERVABLE por la RUTA `POST /api/steps/:id/
// approve` de CP3, conduciendo el camino REAL (el mismo `approveScriptsForStep` → `buildVariantGenerationPlan`
// que arranca la generación en producción), no un seam cómodo (lección T5.14).
//
//   · TEST B — desde el seed limpio, un lote PREMIUM fijado a MAYA llega a CP3 y ARRANCA generación (200 +
//     `nextRunId` + el run N6→N7→N8→N9 encolado). La persona se DERIVA del predicado batch-ready sobre la BD
//     sembrada (NO se fija a mano: eso probaría «Maya cableada a mano», no «el seed trae una persona
//     generable» — trampa T1.13), y se pasa al planner por el camino de pin REAL del producto (`personaMode:
//     'fixed'`, T5.13). CONTROL NEGATIVO: si el seed pierde a Maya, el filtro batch-ready queda vacío y el
//     test se pone ROJO ANTES de tocar la ruta.
//   · TEST C — una persona premium SIN imágenes de referencia (el escenario real: creada en /personas, aún
//     sin subir fotos) produce un 400 ACCIONABLE (no un 500) a nivel de RUTA. El `checkpoint-errors.test.ts`
//     ya unit-testa el MAPEO en aislado; esto prueba el eslabón de ruta: el throw tipado atraviesa el route
//     handler y `toCheckpointError` lo mapea a `validation_error` con el mensaje que nombra la persona y dice
//     qué subir. CONTROL NEGATIVO: revertir ese mapeo → el 400 vuelve a caer al 500 y el test se pone ROJO.
//
// SETUP copiado de `regen-checkpoint.test.ts` (el patrón de lote premium generation-ready con persona):
// `seedLibrary` + `seedGallery` + boss, y el `beforeEach` que TRUNCA lote/variante/step PERO deja viva la
// tabla `persona` (sembrada una vez en `beforeAll` con el seed REAL). NO se injerta esto en
// `checkpoints.test.ts`: su `beforeAll` solo siembra la librería, y añadir personas cambiaría
// `listPlanningInputs` para los 40+ tests de allí (los de T5.14 dependen del camino tier-`test` NO
// generation-ready). Aislado aquí, cada suite ve exactamente el estado que necesita.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';
import { newUlid } from '@ugc/core/contracts';
import type { AdScript, GuardrailFlag, N5Output } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { planBatch } from '@ugc/core/strategy';
import { PERSONA_SEEDS } from '@ugc/core/persona/server';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import {
  createBatchWithVariants,
  createScriptsForBatch,
  ensureQueue,
  listBatchVariants,
  listPlanningInputs,
  listPersonas,
  seedGallery,
  seedLibrary,
  seedPersonas,
  type Db,
} from '@ugc/db';
import { persona, productBrief, project as projectTable, urlAnalysis } from '@ugc/db/schema';
import {
  createTestDatabase,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';
import { setDbForTests } from '@/server/db';
import { setBossForTests } from '@/server/boss';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { POST as approvePost } from '@/app/api/steps/[id]/approve/route';

const TEST_MASTER_KEY = 'test-master-key-for-cp3-seed-persona-not-a-secret';

let tdb: TestDatabase;
let boss: PgBoss;

const BRIEF = makeBrief();

function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

/** Invoca el route handler de `/approve` con `:id` en los params (patrón withRoute de Next), con cookie de
 *  sesión (el route va tras `withAuth`). Réplica del `call` de `checkpoints.test.ts`. */
function callApprove(id: string, body?: unknown): Promise<Response> {
  return approvePost(
    new Request(`http://test.local/api/steps/${id}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie() },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** Un StorageAdapter en memoria: `put` calcula bytes/checksum sin tocar el FS (el camino feliz del seed no
 *  necesita disco). Mismo doble que `persona-seed.test.ts`. */
function makeMemoryStorage(): StorageAdapter {
  return {
    put: (_key, data) => {
      const bytes = data instanceof Uint8Array ? data.byteLength : 0;
      return Promise.resolve({ bytes, checksum: `sha256:${String(bytes)}` });
    },
    get: () => Promise.reject(new Error('no usado')),
    stat: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  };
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:cp3-seed-persona' });
  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* irrelevante */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);

  // La librería + galería REALES (recipes/hooks/…): el premium recipe con endpoints reales
  // (avatar/broll/voice) es lo que hace `isTierGenerationReady('premium')` true. Viven fuera de `project`,
  // así que el TRUNCATE por-test no los toca — se siembran UNA vez.
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
  const gseed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!gseed.ok || !gseed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, gseed.seed);

  // EL SEED REAL DE PERSONAS (el mismo `seedPersonas` que `pnpm seed` invoca): materializa MAYA + las 10
  // placeholder, con sus imágenes de referencia. Test B lee de aquí la persona batch-ready — NADA se
  // inserta a mano (T1.13: el arnés no fija lo que producción deriva del seed).
  await seedPersonas(tdb.db, makeMemoryStorage(), PERSONA_SEEDS);

  setDbForTests(tdb.db);
  setBossForTests(boss);
});

afterAll(async () => {
  setDbForTests(undefined);
  setBossForTests(undefined);
  setMasterKeyForTests(undefined);
  await boss.stop({ graceful: true, timeout: 10_000 });
  await tdb.close();
});

beforeEach(async () => {
  // Se limpia el lote/variante/step de cada test; la tabla `persona` (y librería/galería) sobrevive — es
  // el seed que Test B lee y sobre el que se apoya el escenario de Test C.
  await tdb.pool.query(
    'TRUNCATE ad_script, ad_variant, ad_batch, step_run, pipeline_run, product_brief, url_analysis, project CASCADE',
  );
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});
afterEach(async () => {
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

/** El guion v1 de una variante (CONTRATO AdScript válido: 3 escenas hook/body/cta). Es lo que
 *  `createScriptsForBatch` persiste como v1 y lo que CP3 re-lintea. Molde de los seam-tests de T2.6/T5.14. */
function makeScriptContract(): AdScript {
  const hook = 'Mira esto ya.';
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
    subtitles: [{ start: 0, end: 2, text: hook }],
    fullText: `${hook} Cuerpo del anuncio. Enlace abajo.`,
    wordCount: 8,
    estSeconds: 9,
    tone: 'directo',
    language: 'es',
    sharedBodyKey: 'body-key',
  };
}

/** Un proyecto + análisis + brief persistidos. Base de cualquier lote. */
async function seedBrief(): Promise<{ projectId: string; briefId: string }> {
  const [p] = await tdb.db.insert(projectTable).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [briefRow] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();
  return { projectId: p!.id, briefId: briefRow!.id };
}

/**
 * Siembra un lote PREMIUM (generation-ready) con 1 variante FIJADA a `personaId`, su guion v1 y un step N5
 * en `waiting_approval` cuyo `output_refs` es el N5Output que apunta a la variante. Es el estado exacto sobre
 * el que el route de CP3 llama `approveScriptsForStep`. Devuelve el `stepId` y el `variantId`.
 *
 * La persona se FIJA por el camino REAL del producto (`personaMode:'fixed'` + `personaId`, T5.13): el planner
 * no la re-filtra por `avatar_hint`, así que la variante lleva SIEMPRE la persona pedida (imprescindible para
 * discriminar «Maya con imágenes» de «persona sin imágenes» sin depender del matching).
 */
async function seedPremiumCp3(
  db: Db,
  personaId: string,
): Promise<{ stepId: string; variantId: string }> {
  const { projectId, briefId } = await seedBrief();
  const { libraryHooks, personas, recipe } = await listPlanningInputs(db, 'premium');
  const config = {
    angleIndices: [0],
    hooksPerAngle: 1,
    objective: 'hook_test' as const,
    tier: 'premium' as const,
    languages: ['es'],
    personaMode: 'fixed' as const,
    personaId,
  };
  const args = { brief: BRIEF, config, libraryHooks, personas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(db, {
    projectId,
    briefId,
    tier: 'premium',
    objective: 'hook_test',
    languages: ['es'],
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
  const variants = await listBatchVariants(db, created.batch.id);
  const variantId = variants[0]!.id;
  // Sanidad del setup: la variante quedó fijada a la persona pedida (no `null`, no otra).
  expect(variants[0]!.personaId).toBe(personaId);

  const runId = newUlid();
  await tdb.pool.query('INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)', [
    runId,
    projectId,
  ]);
  const stepId = newUlid();
  const createdScripts = await createScriptsForBatch(db, {
    stepRunId: stepId,
    scripts: [{ variantId, content: makeScriptContract(), guardrailFlags: [] as GuardrailFlag[] }],
  });
  // El N5Output que N5 dejó: una scriptRef por la variante (lote COMPLETO — sin esto saltaría el guard de
  // lote truncado de T5.11 ANTES que el camino bajo prueba).
  const artifact: N5Output = {
    batchId: created.batch.id,
    scriptRefs: createdScripts.map((s) => ({
      variantId: s.variantId,
      scriptId: s.id,
      filenameCode: variants[0]!.filenameCode,
      blocked: false,
    })),
    status: 'scripted',
    warnings: [],
  };
  await tdb.pool.query(
    `INSERT INTO step_run (id, run_id, node_key, status, is_checkpoint, output_refs, depends_on)
     VALUES ($1, $2, 'N5', 'waiting_approval', true, $3, '{}')`,
    [stepId, runId, JSON.stringify(artifact)],
  );
  return { stepId, variantId };
}

/** La decisión `scripts` del body de `/approve`: un veredicto por variante con su `approved`. */
function scriptsDecision(verdicts: { variantId: string; approved: boolean }[]): {
  decision: { kind: 'scripts'; verdicts: { variantId: string; approved: boolean }[] };
} {
  return { decision: { kind: 'scripts', verdicts } };
}

// ── TEST B · UN LOTE PREMIUM ARRANCA GENERACIÓN CON LA PERSONA DEL SEED LIMPIO ───────────────────────
describe('CP3 · un lote premium arranca generación con la persona batch-ready del seed (T5.15, Test B)', () => {
  /** Los `voiceId` de un `voice_map` jsonb OPACO (fila de BD), defensivamente. */
  function voiceIdsOf(voiceMap: unknown): string[] {
    if (voiceMap === null || typeof voiceMap !== 'object') return [];
    return Object.values(voiceMap as Record<string, unknown>)
      .map((v) =>
        v !== null &&
        typeof v === 'object' &&
        typeof (v as { voiceId?: unknown }).voiceId === 'string'
          ? (v as { voiceId: string }).voiceId
          : '',
      )
      .filter((id) => id.length > 0);
  }

  /** ¿La fila de persona (tal cual sale de la BD) es batch-ready? — ≥1 imagen de referencia REAL (N7c/avatar)
   *  + ninguna voz placeholder (N7b). DERIVADA de la BD sembrada, no fijada a mano (T1.13): es el control
   *  negativo — sin persona completa en el seed, queda vacío y el test se pone ROJO antes de tocar la ruta. */
  function isBatchReadyRow(p: { referenceImageIds: string[]; voiceMap: unknown }): boolean {
    const voiceIds = voiceIdsOf(p.voiceMap);
    return (
      p.referenceImageIds.length > 0 &&
      voiceIds.length > 0 &&
      voiceIds.every((id) => !id.startsWith('placeholder'))
    );
  }

  it('desde el seed limpio: CP3 aprueba y ARRANCA el run de generación (200 + nextRunId + N6 encolado)', async () => {
    // LA PERSONA SE DERIVA DEL SEED, no se fija a mano: se buscan en la BD las personas batch-ready (≥1
    // imagen de referencia REAL + ninguna voz placeholder). Este filtro ES el control negativo: quitar MAYA
    // de `PERSONA_SEEDS` lo deja vacío → el `expect(readyRow)` de abajo se pone ROJO ANTES de tocar la ruta.
    const seededPersonas = await listPersonas(tdb.db);
    const readyRow = seededPersonas.find(isBatchReadyRow);
    expect(
      readyRow,
      'el seed no dejó NINGUNA persona batch-ready: un usuario recién instalado no puede arrancar un lote',
    ).toBeDefined();

    // Un lote premium (generation-ready) fijado a esa persona, hasta CP3.
    const { stepId, variantId } = await seedPremiumCp3(tdb.db, readyRow!.id);

    // Se conduce la RUTA REAL de CP3 aprobando la variante: `approveScriptsForStep` →
    // `isTierGenerationReady('premium')` true → `buildVariantGenerationPlan` (que resuelve avatar por
    // `referenceImageIds[0]` y la voz por el `voice_map`, sin lanzar, porque la persona es completa) →
    // `createRun` arranca el sub-DAG N6→N7→N8→N9.
    const res = await callApprove(stepId, scriptsDecision([{ variantId, approved: true }]));

    expect(res.status).toBe(200);
    const bodyJson = (await res.json()) as { ok: boolean; nextRunId?: string };
    // ARRANCAR GENERACIÓN = hay `nextRunId` (el run N6→…): es el observable de «el lote avanza a generar».
    expect(bodyJson.nextRunId).toBeTruthy();

    // El step de CP3 se consumió (N5 → succeeded) y la variante quedó `scripted`.
    const { rows: stepRows } = await tdb.pool.query<{ status: string }>(
      'SELECT status FROM step_run WHERE id = $1',
      [stepId],
    );
    expect(stepRows[0]!.status).toBe('succeeded');
    const { rows: varRows } = await tdb.pool.query<{ status: string }>(
      'SELECT status FROM ad_variant WHERE id = $1',
      [variantId],
    );
    expect(varRows[0]!.status).toBe('scripted');

    // El run de generación existe con su sub-DAG: N6 (root, ENCOLADO) + N8 + N9. Prueba que la generación
    // ARRANCÓ de verdad (no solo un 200), que es la Verificación de T5.15 («llega a arrancar generación»).
    const { rows: genSteps } = await tdb.pool.query<{ node_key: string; status: string }>(
      'SELECT node_key, status FROM step_run WHERE run_id = $1',
      [bodyJson.nextRunId],
    );
    const nodeKeys = genSteps.map((s) => s.node_key);
    expect(nodeKeys).toContain('N6');
    expect(nodeKeys).toContain('N8');
    expect(nodeKeys).toContain('N9');
    expect(genSteps.find((s) => s.node_key === 'N6')?.status).toBe('queued');
  });
});

// ── TEST C · PERSONA SIN IMAGEN → 400 ACCIONABLE A NIVEL DE RUTA (no 500) ────────────────────────────
describe('CP3 · una persona sin imagen produce un 400 accionable, no un 500 (T5.15, Test C)', () => {
  /** Inserta una persona PREMIUM con voces reales pero SIN imágenes de referencia (`reference_image_ids`
   *  vacío). Es el escenario REAL del usuario: la creó en /personas y aún no ha subido fotos. Es el INPUT
   *  del test, no lo que se prueba — por eso se inserta directa (no via seed). Devuelve id y nombre. */
  async function seedPersonaWithoutImages(): Promise<{ id: string; name: string }> {
    const name = `Sin Fotos ${newUlid()}`;
    const [row] = await tdb.db
      .insert(persona)
      .values({
        name,
        ageRange: '25-34',
        gender: 'female',
        ethnicity: 'mixed',
        style: 'natural',
        descriptor: 'creadora de 30 años, estilo natural',
        setting: 'salón luminoso',
        personality: 'cercana',
        // Voces REALES (no placeholder): así el gate que FALLA es el de AVATAR (sin imagen), no el de voz —
        // el test aísla el `PersonaWithoutReferenceImageError` de T5.15.
        voiceMap: { es: { provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' } },
        referenceImageIds: [], // ← EL DEFECTO: sin imágenes, N7c/avatar no puede generar.
      })
      .returning();
    return { id: row!.id, name: row!.name };
  }

  it('POST /approve con una persona sin imágenes → 400 validation_error accionable (nombra la persona, dice qué subir)', async () => {
    const { id: personaId, name } = await seedPersonaWithoutImages();
    // Lote premium (generation-ready) fijado a esa persona sin imágenes, hasta CP3.
    const { stepId, variantId } = await seedPremiumCp3(tdb.db, personaId);

    // Se aprueba la variante: la aprobación PROCEDE (guard de 0-aprobadas de T5.14 NO salta, lote COMPLETO
    // → guard de T5.11 NO salta), `isTierGenerationReady('premium')` true → `buildVariantGenerationPlan`
    // lanza `PersonaWithoutReferenceImageError` porque `referenceImageIds[0]` es undefined. Ese throw sube
    // por el route handler y `toCheckpointError` lo mapea a `validation_error` (400).
    const res = await callApprove(stepId, scriptsDecision([{ variantId, approved: true }]));

    // EL ESLABÓN DE RUTA (el que el unit del mapeo NO cubre): 400, no 500.
    expect(res.status).toBe(400);
    const bodyJson = (await res.json()) as { code: string; message: string };
    expect(bodyJson.code).toBe('validation_error');
    // El mensaje es ACCIONABLE (regla 5a): nombra la persona, apunta a N7c/avatar y dice subir una imagen.
    // Se asserta el MENSAJE (no solo el 400): este camino tiene ≥3 `validation_error` distintos (T5.11,
    // T5.14 y este); un 400 pelado podría ir verde por el motivo equivocado y el control negativo sería
    // teatro.
    expect(bodyJson.message).toContain(name);
    expect(bodyJson.message).toMatch(/N7c|avatar/);
    expect(bodyJson.message).toMatch(/imagen de referencia/i);

    // Y el 400 NO consumió el checkpoint (el throw revirtió la tx): el step sigue vivo — gratis de asertar y
    // prueba que fue un rechazo limpio, no un 500 a medias que dejara estado inconsistente.
    const { rows } = await tdb.pool.query<{ status: string }>(
      'SELECT status FROM step_run WHERE id = $1',
      [stepId],
    );
    expect(rows[0]!.status).toBe('waiting_approval');
  });
});
