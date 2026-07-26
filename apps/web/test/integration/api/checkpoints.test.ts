// Integración handler-level de los endpoints de checkpoint/skip/cancel (T0.8)
// contra Postgres real (api.md §2, nivel 1): los handlers exportados invocados en
// proceso con `new Request()`, la BD y el boss inyectados vía accessors lazy. El
// contrato real es el efecto transaccional (transición + supersede + audit_log),
// no solo el 200. NO es e2e/Playwright.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import type { AdScript, GuardrailFlag, N5Output, N9Output } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { planBatch } from '@ugc/core/strategy';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import {
  createTestDatabase,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
} from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';
import {
  createBatchWithVariants,
  createScriptsForBatch,
  ensureQueue,
  listBatchVariants,
  listPlanningInputs,
  seedLibrary,
} from '@ugc/db';
import { productBrief, project as projectTable, urlAnalysis } from '@ugc/db/schema';
import { setDbForTests } from '@/server/db';
import { setBossForTests } from '@/server/boss';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { POST as approvePost } from '@/app/api/steps/[id]/approve/route';
import { POST as editPost } from '@/app/api/steps/[id]/edit/route';
import { POST as rejectPost } from '@/app/api/steps/[id]/reject/route';
import { POST as skipPost } from '@/app/api/steps/[id]/skip/route';
import { POST as cancelPost } from '@/app/api/runs/[id]/cancel/route';

const TEST_MASTER_KEY = 'test-master-key-for-checkpoints-suite';
function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

let tdb: TestDatabase;
let boss: PgBoss;

/** Invoca un handler con `:id` en los params (patrón withRoute de Next). */
function call(
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  id: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return handler(
    new Request(`http://test.local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie() },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

/** Igual que `call` pero SIN cookie de sesión: para verificar el guard withAuth. */
function callNoAuth(
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  id: string,
  path: string,
): Promise<Response> {
  return handler(
    new Request(`http://test.local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function seedProjectRunStep(opts: {
  status: string;
  isCheckpoint?: boolean;
  outputRefs?: unknown;
  dependsOn?: string[];
  stepId?: string;
}): Promise<{ runId: string; stepId: string }> {
  const p = makeProject();
  const projectId = newUlid();
  await tdb.pool.query(`INSERT INTO project (id, name) VALUES ($1, $2)`, [projectId, p.name]);
  const runId = newUlid();
  await tdb.pool.query(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [
    runId,
    projectId,
  ]);
  const stepId = opts.stepId ?? newUlid();
  await tdb.pool.query(
    `INSERT INTO step_run (id, run_id, node_key, status, is_checkpoint, output_refs, depends_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      stepId,
      runId,
      'N0',
      opts.status,
      opts.isCheckpoint ?? false,
      opts.outputRefs === undefined ? null : JSON.stringify(opts.outputRefs),
      opts.dependsOn ?? [],
    ],
  );
  return { runId, stepId };
}

async function statusOf(stepId: string): Promise<string> {
  const { rows } = await tdb.pool.query<{ status: string }>(
    `SELECT status FROM step_run WHERE id = $1`,
    [stepId],
  );
  return rows[0]!.status;
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:checkpoints' });
  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* irrelevante */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);
  // La librería real (hooks/recipes/personas): la sección CP4 (T5.5c) siembra un lote+variante con
  // `createBatchWithVariants`, que planifica sobre estos seeds. Vive fuera de `project`, así que el
  // TRUNCATE por-test (que cascadea desde `project`) no lo toca — se siembra UNA vez aquí.
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
  setDbForTests(tdb.db);
  setBossForTests(boss);
});

afterAll(async () => {
  setDbForTests(undefined);
  setBossForTests(undefined);
  setMasterKeyForTests(undefined);
  const stopped = new Promise<void>((resolve) => {
    boss.once('stopped', () => {
      resolve();
    });
  });
  const safety = new Promise<void>((resolve) => setTimeout(resolve, 15_000));
  await boss.stop({ graceful: true, timeout: 10_000 });
  await Promise.race([stopped, safety]);
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project, audit_log CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});
afterEach(async () => {
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

describe('POST /api/steps/:id/approve', () => {
  it('aprueba un checkpoint en waiting_approval → 200 + step succeeded', async () => {
    const { stepId } = await seedProjectRunStep({ status: 'waiting_approval', isCheckpoint: true });
    const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`);
    expect(res.status).toBe(200);
    expect(await statusOf(stepId)).toBe('succeeded');
  });

  it('approve sobre un step ya succeeded → 409 invalid_transition (BD intacta)', async () => {
    const { stepId } = await seedProjectRunStep({ status: 'succeeded' });
    const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');
    expect(await statusOf(stepId)).toBe('succeeded');
  });

  it('approve sobre un step inexistente → 404 not_found', async () => {
    const res = await call(approvePost, newUlid(), `/api/steps/x/approve`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_found');
  });

  it(':id malformado (no ULID) → 400 validation_error', async () => {
    const res = await call(approvePost, 'not-a-ulid', `/api/steps/not-a-ulid/approve`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });
});

describe('POST /api/steps/:id/edit', () => {
  it('edita output_refs de un checkpoint → 200 + step succeeded con el output editado', async () => {
    const { stepId } = await seedProjectRunStep({
      status: 'waiting_approval',
      isCheckpoint: true,
      outputRefs: { v: 1 },
    });
    const res = await call(editPost, stepId, `/api/steps/${stepId}/edit`, { outputRefs: { v: 2 } });
    expect(res.status).toBe(200);
    expect(await statusOf(stepId)).toBe('succeeded');
    const { rows } = await tdb.pool.query<{ output_refs: unknown; action: string }>(
      `SELECT output_refs FROM step_run WHERE id = $1`,
      [stepId],
    );
    expect(rows[0]!.output_refs).toEqual({ v: 2 });
  });

  it('body sin outputRefs sigue siendo válido (unknown acepta ausente → undefined)', async () => {
    // z.object({ outputRefs: z.unknown() }) acepta el body vacío; outputRefs = undefined.
    const { stepId } = await seedProjectRunStep({ status: 'waiting_approval', isCheckpoint: true });
    const res = await call(editPost, stepId, `/api/steps/${stepId}/edit`, {});
    expect(res.status).toBe(200);
  });
});

describe('POST /api/steps/:id/reject', () => {
  it('rechaza un checkpoint → 200 + step rejected', async () => {
    const { stepId } = await seedProjectRunStep({ status: 'waiting_approval', isCheckpoint: true });
    const res = await call(rejectPost, stepId, `/api/steps/${stepId}/reject`);
    expect(res.status).toBe(200);
    expect(await statusOf(stepId)).toBe('rejected');
  });
});

describe('POST /api/steps/:id/skip', () => {
  it('salta un step skippable → 200 + step skipped', async () => {
    const { stepId } = await seedProjectRunStep({ status: 'pending' });
    const res = await call(skipPost, stepId, `/api/steps/${stepId}/skip`);
    expect(res.status).toBe(200);
    expect(await statusOf(stepId)).toBe('skipped');
  });
});

describe('POST /api/runs/:id/cancel', () => {
  it('cancela un run en curso → 200 con cancelled>0 y el step cancelled', async () => {
    const { runId, stepId } = await seedProjectRunStep({ status: 'running' });
    const res = await call(cancelPost, runId, `/api/runs/${runId}/cancel`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cancelled: number };
    expect(body.cancelled).toBeGreaterThan(0);
    expect(await statusOf(stepId)).toBe('cancelled');
  });

  it('cancel es idempotente: segunda vez cancela 0 → 200 cancelled=0', async () => {
    const { runId } = await seedProjectRunStep({ status: 'running' });
    await call(cancelPost, runId, `/api/runs/${runId}/cancel`);
    const res = await call(cancelPost, runId, `/api/runs/${runId}/cancel`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { cancelled: number }).cancelled).toBe(0);
  });
});

describe('auth: las 5 rutas de T0.8 exigen sesión (withAuth) → 401 sin cookie', () => {
  // auth es load-bearing (api.md §6): sin cookie de sesión válida, cada ruta que
  // muta estado responde 401 ANTES de tocar la BD. Un id ULID válido aísla el fallo
  // al guard de auth (no a la validación de params).
  const validId = newUlid();

  it('approve sin sesión → 401 unauthorized', async () => {
    const res = await callNoAuth(approvePost, validId, `/api/steps/${validId}/approve`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });

  it('edit sin sesión → 401 unauthorized', async () => {
    const res = await callNoAuth(editPost, validId, `/api/steps/${validId}/edit`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });

  it('reject sin sesión → 401 unauthorized', async () => {
    const res = await callNoAuth(rejectPost, validId, `/api/steps/${validId}/reject`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });

  it('skip sin sesión → 401 unauthorized', async () => {
    const res = await callNoAuth(skipPost, validId, `/api/steps/${validId}/skip`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });

  it('cancel sin sesión → 401 unauthorized', async () => {
    const res = await callNoAuth(cancelPost, validId, `/api/runs/${validId}/cancel`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// T1.10b — ATOMICIDAD del efecto de DOMINIO del checkpoint del brief (CP1).
//
// El efecto de dominio (versionar/aprobar el `product_brief`) y la transición del orquestador
// (`editStep`/`approveStep`) son DOS escrituras que tienen que commitear JUNTAS. Cuando no lo
// hacían, el code-review encontró dos agujeros REALES, y estos tests son su regresión:
//
//   - EDIT: si `editStep` falla DESPUÉS de crear la v2, quedaba una fila `product_brief`
//     HUÉRFANA — una versión que ningún step referencia, que quema un número de versión (el
//     linaje v1→v3 sugiere una edición que nunca ocurrió) y que el lector futuro de "el brief
//     actual de este producto" (F2, el compositor de la matriz) se llevaría creyendo que el
//     usuario la aprobó.
//   - APPROVE: si el efecto de dominio fallaba DESPUÉS de `approveStep`, el run ya había
//     REANUDADO y el brief se quedaba en `draft` PARA SIEMPRE (irreparable: un segundo POST da
//     409, el step ya no está en `waiting_approval`).
//
// El disparador de fallo que usan los tests es el REALISTA, no uno inventado: el step ya no está
// en `waiting_approval` (doble clic, run cancelado entre medias, redelivery) ⇒ el orquestador
// lanza `IllegalTransitionError`. Lo que se afirma es que la BD queda como estaba.
describe('CP1 · el efecto sobre product_brief es ATÓMICO con la transición (T1.10b)', () => {
  /** Un proyecto + análisis + brief v1 (lo que N3 deja) + un step CP1 con su artefacto. */
  async function seedBriefCheckpoint(stepStatus: string): Promise<{
    stepId: string;
    briefId: string;
    analysisId: string;
  }> {
    const projectId = newUlid();
    await tdb.pool.query(`INSERT INTO project (id, name) VALUES ($1, $2)`, [
      projectId,
      makeProject().name,
    ]);
    const analysisId = newUlid();
    await tdb.pool.query(
      `INSERT INTO url_analysis (id, project_id, source, platform, content_hash, raw_content)
       VALUES ($1, $2, 'url', 'shopify', $3, $4)`,
      [analysisId, projectId, `hash-${analysisId}`, JSON.stringify({ markdown: '#', images: [] })],
    );
    const briefId = newUlid();
    await tdb.pool.query(
      `INSERT INTO product_brief (id, url_analysis_id, version, data, language, status, edited_by_user)
       VALUES ($1, $2, 1, $3, 'es', 'draft', false)`,
      [briefId, analysisId, JSON.stringify(makeBrief())],
    );
    const runId = newUlid();
    await tdb.pool.query(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [
      runId,
      projectId,
    ]);
    const stepId = newUlid();
    // El artefacto REAL de N3: `{briefId, brief, warnings, status}` (N3OutputSchema).
    await tdb.pool.query(
      `INSERT INTO step_run (id, run_id, node_key, status, is_checkpoint, output_refs, depends_on)
       VALUES ($1, $2, 'N3', $3, true, $4, '{}')`,
      [
        stepId,
        runId,
        stepStatus,
        JSON.stringify({ briefId, brief: makeBrief(), warnings: [], status: 'ok' }),
      ],
    );
    return { stepId, briefId, analysisId };
  }

  async function briefRows(analysisId: string): Promise<{ version: number; status: string }[]> {
    const { rows } = await tdb.pool.query<{ version: number; status: string }>(
      `SELECT version, status FROM product_brief WHERE url_analysis_id = $1 ORDER BY version`,
      [analysisId],
    );
    return rows;
  }

  it('edit que FALLA la transición NO deja una versión huérfana del brief', async () => {
    // El step ya está `succeeded` (alguien lo aprobó antes: doble clic / redelivery) ⇒ `editStep`
    // lanzará IllegalTransitionError. La v2 se crea ANTES en el mismo código (`editStep` necesita
    // su id para el output_refs): la única defensa es la TRANSACCIÓN.
    const { stepId, analysisId } = await seedBriefCheckpoint('succeeded');

    const res = await call(editPost, stepId, `/api/steps/${stepId}/edit`, { brief: makeBrief() });

    expect(res.status).toBe(409); // invalid_transition
    // LO QUE IMPORTA: sigue habiendo UNA sola versión (la v1 de la IA). Antes del fix aquí
    // quedaba una v2 `approved`+`edited_by_user:true` que ningún step referenciaba.
    expect(await briefRows(analysisId)).toEqual([{ version: 1, status: 'draft' }]);
  });

  it('edit que SÍ transiciona crea la v2 y el step apunta a ella', async () => {
    // El contraste imprescindible: el rollback no puede ser "nunca escribe nada".
    const { stepId, briefId, analysisId } = await seedBriefCheckpoint('waiting_approval');

    const res = await call(editPost, stepId, `/api/steps/${stepId}/edit`, { brief: makeBrief() });
    expect(res.status).toBe(200);

    expect(await briefRows(analysisId)).toEqual([
      { version: 1, status: 'draft' }, // la de la IA queda como testigo del linaje
      { version: 2, status: 'approved' }, // la del humano
    ]);
    const { rows } = await tdb.pool.query<{ output_refs: { briefId: string } }>(
      `SELECT output_refs FROM step_run WHERE id = $1`,
      [stepId],
    );
    // El step referencia la versión NUEVA, no la de la IA.
    expect(rows[0]?.output_refs.briefId).not.toBe(briefId);
  });

  it('approve que FALLA la transición NO deja el brief aprobado a medias', async () => {
    // Espejo del anterior por el otro lado: aquí lo que no debe pasar es que el brief se apruebe
    // cuando el step NO se aprobó.
    const { stepId, analysisId } = await seedBriefCheckpoint('succeeded');

    const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`);
    expect(res.status).toBe(409);
    expect(await briefRows(analysisId)).toEqual([{ version: 1, status: 'draft' }]);
  });

  it('approve SIN editar aprueba el v1 y NO crea una v2 (aprobar no es editar)', async () => {
    const { stepId, analysisId } = await seedBriefCheckpoint('waiting_approval');

    const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`);
    expect(res.status).toBe(200);
    // UNA sola fila, ya aprobada. Un v2 idéntico con `edited_by_user:true` MENTIRÍA sobre quién
    // escribió ese contenido (§19.1 mide justo cuánto corrige el humano a la IA).
    expect(await briefRows(analysisId)).toEqual([{ version: 1, status: 'approved' }]);
  });

  it('edit con `brief` Y `outputRefs` a la vez → 400 (uno pisaría al otro en silencio)', async () => {
    const { stepId } = await seedBriefCheckpoint('waiting_approval');
    const res = await call(editPost, stepId, `/api/steps/${stepId}/edit`, {
      brief: makeBrief(),
      outputRefs: { cualquier: 'cosa' },
    });
    expect(res.status).toBe(400);
  });

  // ──────────────────────────────────────────────────────────────────────────────────────────
  // T1.11 — EL CANAL DE DECISIONES del checkpoint.
  //
  // Un checkpoint humano produce DOS cosas: un ARTEFACTO (el brief editado, en `output_refs`) y
  // una DECISIÓN (CP1: ¿subo fotos o genero un packshot-IA?). Hasta T1.11 solo viajaba la
  // primera: la decisión era `useState` del editor y se EVAPORABA. Aquí se prueba el canal:
  // `decision` en el body de `/approve` (y de `/edit`), persistida en `checkpoint_decision` EN LA
  // MISMA TX que la transición — el mismo criterio de atomicidad que la v2 huérfana de arriba.
  describe('CP1 · la DECISIÓN del checkpoint se persiste con la transición (T1.11)', () => {
    async function decisionsOf(stepId: string): Promise<{ kind: string; decision: unknown }[]> {
      const { rows } = await tdb.pool.query<{ kind: string; decision: unknown }>(
        `SELECT kind, decision FROM checkpoint_decision WHERE step_run_id = $1`,
        [stepId],
      );
      return rows;
    }

    it('approve con decisión → 200 y la decisión queda en checkpoint_decision, asociada al step', async () => {
      const { stepId } = await seedBriefCheckpoint('waiting_approval');

      const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`, {
        decision: { kind: 'brief', images: 'ai_packshot' },
      });

      expect(res.status).toBe(200);
      expect(await statusOf(stepId)).toBe('succeeded');
      // La decisión es LEGIBLE por step (lectura por clave: lo que N7a/T4.4 necesita, y lo que un
      // `audit_log` append-only no sabe hacer bien) — y NO está en el artefacto.
      expect(await decisionsOf(stepId)).toEqual([
        { kind: 'brief', decision: { kind: 'brief', images: 'ai_packshot' } },
      ]);
    });

    it('ATOMICIDAD: si la transición FALLA, la decisión NO queda persistida', async () => {
      // Mismo disparador realista que los tests de la v2 huérfana: el step ya no está en
      // `waiting_approval` (doble clic, run cancelado entre medias, redelivery) ⇒ el orquestador
      // lanza IllegalTransitionError. La decisión se escribe en la MISMA tx ⇒ rollback.
      // Sin esto quedaría una decisión sobre una aprobación QUE NUNCA OCURRIÓ, y N7a la leería
      // como si el humano hubiese elegido.
      const { stepId } = await seedBriefCheckpoint('succeeded');

      const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`, {
        decision: { kind: 'brief', images: 'ai_packshot' },
      });

      expect(res.status).toBe(409); // invalid_transition
      expect(await decisionsOf(stepId)).toEqual([]);
    });

    it('edit con decisión: la decisión se persiste JUNTO a la v2 del brief (mismo commit)', async () => {
      // El camino que se perdería si la decisión solo montara en `/approve`: el usuario decide
      // packshot-IA Y ADEMÁS edita el brief antes de guardar.
      const { stepId, analysisId } = await seedBriefCheckpoint('waiting_approval');

      const res = await call(editPost, stepId, `/api/steps/${stepId}/edit`, {
        brief: makeBrief(),
        decision: { kind: 'brief', images: 'upload_images' },
      });

      expect(res.status).toBe(200);
      expect(await briefRows(analysisId)).toEqual([
        { version: 1, status: 'draft' },
        { version: 2, status: 'approved' },
      ]);
      expect(await decisionsOf(stepId)).toEqual([
        { kind: 'brief', decision: { kind: 'brief', images: 'upload_images' } },
      ]);
    });

    it('ATOMICIDAD (edit): transición fallida ⇒ ni v2 del brief ni decisión', async () => {
      const { stepId, analysisId } = await seedBriefCheckpoint('succeeded');

      const res = await call(editPost, stepId, `/api/steps/${stepId}/edit`, {
        brief: makeBrief(),
        decision: { kind: 'brief', images: 'ai_packshot' },
      });

      expect(res.status).toBe(409);
      expect(await briefRows(analysisId)).toEqual([{ version: 1, status: 'draft' }]);
      expect(await decisionsOf(stepId)).toEqual([]);
    });

    it('aprobar SIN decisión (la rama URL, que no necesita ninguna) sigue funcionando igual', async () => {
      // La otra mitad de la Verificación. Sin `decision` no se escribe fila: una decisión vacía
      // "por si acaso" sería ruido que el consumidor tendría que aprender a ignorar.
      const { stepId } = await seedBriefCheckpoint('waiting_approval');

      const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`);

      expect(res.status).toBe(200);
      expect(await statusOf(stepId)).toBe('succeeded');
      expect(await decisionsOf(stepId)).toEqual([]);
    });

    it('una decisión con forma DESCONOCIDA → 400 (el canal es tipado, no un jsonb libre)', async () => {
      // El `kind` discrimina: una decisión de un checkpoint que no existe (o con un valor fuera
      // del enum) es un caller roto ⇒ 400 ANTES de tocar la BD, no basura persistida que
      // reventaría en F4 cuando N7a intente leerla.
      const { stepId } = await seedBriefCheckpoint('waiting_approval');

      const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`, {
        decision: { kind: 'brief', images: 'lo_que_sea' },
      });

      expect(res.status).toBe(400);
      expect(await statusOf(stepId)).toBe('waiting_approval'); // BD intacta
      expect(await decisionsOf(stepId)).toEqual([]);
    });

    // ── T1.15 · `/approve` RECHAZA la promoción a hero ───────────────────────────────────────
    it('promote_scraped en /approve → 400: promover EDITA el brief, y /approve no lo toca', async () => {
      // EL INVARIANTE, y es de CONTRATO, no de UI. `/approve` aprueba el brief de la IA TAL CUAL
      // (`approveBriefForStep` solo marca la v1 `approved`: no crea versión ni cambia contenido).
      // Si aceptase una decisión `promote_scraped`, persistiría una decisión que dice «promoví
      // ESTA imagen» contra un brief cuyo `hero_image_url` sigue siendo `null` — los dos canales
      // (decisión y artefacto) diciendo cosas distintas, y N7a (T4.4) descubriéndolo en F4
      // gastando dinero en fal.ai contra un hero que no existe.
      //
      // El `if` del editor (que redirige la promoción a `/edit`) protege a UN llamante; esto para
      // a cualquier otro — un curl, un test, el MCP de F8. Es el control negativo del guard: si
      // alguien quita el `.refine()` del BodySchema, este test se pone rojo.
      const { stepId } = await seedBriefCheckpoint('waiting_approval');

      const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`, {
        decision: {
          kind: 'brief',
          images: 'promote_scraped',
          hero_image_url: 'https://es.stayforlong.com/img/banner.jpg',
        },
      });

      expect(res.status).toBe(400);
      // Y NADA se ha tocado: ni la transición, ni la decisión. El borde para antes de la BD.
      expect(await statusOf(stepId)).toBe('waiting_approval');
      expect(await decisionsOf(stepId)).toEqual([]);
    });

    it('promote_scraped SÍ es válida en /edit: es donde el hero elegido entra en la v2', async () => {
      // La otra mitad: el 400 de arriba NO es "esta decisión es inválida", es "por esta puerta no".
      // Por `/edit` sí pasa —y tiene que pasar—: es el camino que crea la v2 con el hero elegido.
      const { stepId, analysisId } = await seedBriefCheckpoint('waiting_approval');
      const hero = makeBrief().assets.images[0]?.url ?? '';
      const promovido = makeBrief();
      promovido.assets.hero_image_url = hero;

      const res = await call(editPost, stepId, `/api/steps/${stepId}/edit`, {
        brief: promovido,
        decision: { kind: 'brief', images: 'promote_scraped', hero_image_url: hero },
      });

      expect(res.status).toBe(200);
      // Las DOS mitades commitean juntas: la v2 con su hero, y la decisión que dice de dónde salió.
      expect(await briefRows(analysisId)).toEqual([
        { version: 1, status: 'draft' },
        { version: 2, status: 'approved' },
      ]);
      expect(await decisionsOf(stepId)).toEqual([
        {
          kind: 'brief',
          decision: { kind: 'brief', images: 'promote_scraped', hero_image_url: hero },
        },
      ]);
    });

    it('body VACÍO (curl sin -d) sigue siendo una aprobación válida; body BASURA → 400', async () => {
      // T1.11 tocó `readJson` (withRoute) para que `/approve` pudiera declarar un body schema sin
      // romper a quien no manda body: un POST SIN body no es "JSON malformado", es "sin body" ⇒
      // `{}`, y el schema (todo opcional) lo acepta. Esta es la regresión de las DOS ramas — la
      // segunda (bytes que no parsean) SIGUE siendo un 400: eso sí es un caller roto.
      const { stepId } = await seedBriefCheckpoint('waiting_approval');
      const vacio = await approvePost(
        new Request(`http://test.local/api/steps/${stepId}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: cookie() },
        }),
        { params: Promise.resolve({ id: stepId }) },
      );
      expect(vacio.status).toBe(200);
      expect(await statusOf(stepId)).toBe('succeeded');

      const { stepId: otro } = await seedBriefCheckpoint('waiting_approval');
      const basura = await approvePost(
        new Request(`http://test.local/api/steps/${otro}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: cookie() },
          body: '{esto no es json',
        }),
        { params: Promise.resolve({ id: otro }) },
      );
      expect(basura.status).toBe(400);
      expect(await statusOf(otro)).toBe('waiting_approval'); // BD intacta
    });

    // T1.11 (code-review): `readJson` MATERIALIZA el body en memoria. Sin tope, un POST gigante es
    // un OOM del proceso que sirve TODA la app. Hay DOS caminos y los dos se prueban: el
    // `Content-Length` (que rechaza ANTES de leer nada — es el que usa cualquier cliente real) y
    // el recuento de bytes sobre el texto ya leído (el cinturón para peticiones sin
    // `Content-Length`, o sea chunked). 400 y no 413 porque `APP_ERROR_CODES` es una unión CERRADA
    // (tabla del Apéndice E): añadir `payload_too_large` es un cambio de CONTRATO, no una decisión
    // de un route handler.
    //
    // Ojo al detalle que hace falta escribir aquí para que el test pruebe lo que cree: un `Request`
    // construido a mano NO trae `content-length` (lo pone la capa de fetch al enviar), así que sin
    // fijarlo explícitamente solo se estaría ejercitando el cinturón.
    const enorme = () =>
      JSON.stringify({ decision: { kind: 'brief', images: 'x'.repeat(2_000_000) } });

    it('body DESMESURADO con `Content-Length` → 400 SIN llegar a leerlo (el camino real)', async () => {
      const { stepId } = await seedBriefCheckpoint('waiting_approval');
      const body = enorme();

      const res = await approvePost(
        new Request(`http://test.local/api/steps/${stepId}/approve`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(body)),
            cookie: cookie(),
          },
          body,
        }),
        { params: Promise.resolve({ id: stepId }) },
      );

      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('validation_error');
      expect(await statusOf(stepId)).toBe('waiting_approval'); // BD intacta
    });

    it('body DESMESURADO SIN `Content-Length` (chunked) → 400 igualmente (el cinturón)', async () => {
      const { stepId } = await seedBriefCheckpoint('waiting_approval');

      const res = await approvePost(
        new Request(`http://test.local/api/steps/${stepId}/approve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: cookie() },
          body: enorme(),
        }),
        { params: Promise.resolve({ id: stepId }) },
      );

      expect(res.status).toBe(400);
      expect(await statusOf(stepId)).toBe('waiting_approval');
    });

    it('una clave DESCONOCIDA en el body → 400 (strict: un typo no se pierde en silencio)', async () => {
      // Deuda menor que entra con T1.11: con el `strip` por defecto de Zod, `{ decison: … }`
      // parseaba a `{}` y la decisión se EVAPORABA con un 200 — el usuario se enteraría en F4.
      const { stepId } = await seedBriefCheckpoint('waiting_approval');

      const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`, {
        decison: { kind: 'brief', images: 'ai_packshot' },
      });

      expect(res.status).toBe(400);
      expect(await statusOf(stepId)).toBe('waiting_approval');
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// T5.5c — CP4 · QA: las ops de checkpoint a nivel ROUTE (API+BD).
//
// La Verificación de T5.5c pide un «test de API+BD en el gate (aprobar/rechazar mutan el estado
// correcto)». La suite de SEAM (`server/qa-checkpoint.test.ts`) prueba el WRITER de la variante en
// aislamiento, pero NO atraviesa los route handlers: no ejerce la transición del `step_run` ni el
// despacho por el registro de efectos (`applyDomainEffect`/`applyDomainEffectOnReject`). Estos tests SÍ
// —conducen `POST /api/steps/:id/{approve,reject}` con cookie de sesión real (los routes van tras
// `withAuth`)— y afirman las DOS MITADES en la misma tx: la transición del step Y el status de la variante.
//
// El route de RECHAZO es la superficie MÁS NUEVA del diff (reescrito de `rejectStep` genérico a
// `withDomainTransaction` + `applyDomainEffectOnReject`): el caso de reject de aquí es su ÚNICA cobertura
// que atraviesa el efecto de dominio de la variante. El control negativo que MUERDE vive en la suite de
// seam (revertir `rejectApply` ⇒ la variante no pasa a `rejected`); aquí se codifica el comportamiento
// route-level que el verifier condujo por HTTP a mano.
describe('CP4 · QA (T5.5c): las ops de checkpoint mutan step_run Y ad_variant a nivel ROUTE', () => {
  /** Siembra un lote + 1 variante en `planned` y un step N9 en `waiting_approval` cuyo `output_refs` es un
   *  N9Output apuntando a esa variante (lo que el efecto de dominio de CP4 lee). Devuelve ambos ids. */
  async function seedQaCheckpoint(passed = true): Promise<{ stepId: string; variantId: string }> {
    const [p] = await tdb.db.insert(projectTable).values(makeProject()).returning();
    const [ua] = await tdb.db
      .insert(urlAnalysis)
      .values(makeUrlAnalysis({ projectId: p!.id }))
      .returning();
    const brief = makeBrief();
    const [briefRow] = await tdb.db
      .insert(productBrief)
      .values(makeProductBrief({ urlAnalysisId: ua!.id, data: brief }))
      .returning();

    const { libraryHooks, personas, recipe } = await listPlanningInputs(tdb.db, 'test');
    const config = {
      angleIndices: [0],
      hooksPerAngle: 1,
      objective: 'hook_test' as const,
      tier: 'test' as const,
      languages: ['es'],
      personaMode: 'rotate' as const,
    };
    const args = { brief, config, libraryHooks, personas, recipe: recipe! };
    const preview = planBatch(args);
    const created = await createBatchWithVariants(tdb.db, {
      projectId: p!.id,
      briefId: briefRow!.id,
      tier: 'test',
      objective: 'hook_test',
      languages: ['es'],
      costEstimatedCents: preview.estimate.total.maxCents,
      composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
    });
    const [variant] = await listBatchVariants(tdb.db, created.batch.id);
    const variantId = variant!.id;

    // El step N9 en `waiting_approval` con SU artefacto (el veredicto que N9 emitió antes de pausar). El
    // `output_refs` es un `N9Output` REAL: es lo que `applyQaVerdict` valida por schema para sacar el
    // `variantId`. Reusa el `seedProjectRunStep` de la suite pero con un run del MISMO proyecto — se hace
    // a mano porque `seedProjectRunStep` crea su propio proyecto y aquí hace falta uno con lote/variante.
    const runId = newUlid();
    await tdb.pool.query(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [
      runId,
      p!.id,
    ]);
    const stepId = newUlid();
    const artifact: N9Output = {
      variantId,
      passed,
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
        passed,
        score: passed ? 100 : 88,
      },
    };
    await tdb.pool.query(
      `INSERT INTO step_run (id, run_id, node_key, variant_id, status, is_checkpoint, checkpoint_config, output_refs, depends_on)
       VALUES ($1, $2, 'N9', $3, 'waiting_approval', true, $4, $5, '{}')`,
      [stepId, runId, variantId, JSON.stringify({ alwaysPause: true }), JSON.stringify(artifact)],
    );
    return { stepId, variantId };
  }

  async function variantStatusOf(variantId: string): Promise<string> {
    const { rows } = await tdb.pool.query<{ status: string }>(
      `SELECT status FROM ad_variant WHERE id = $1`,
      [variantId],
    );
    return rows[0]!.status;
  }

  it('APROBAR: POST /approve → 200, step succeeded Y ad_variant approved (ambas mitades, misma tx)', async () => {
    const { stepId, variantId } = await seedQaCheckpoint();
    expect(await variantStatusOf(variantId)).toBe('planned');

    const res = await call(approvePost, stepId, `/api/steps/${stepId}/approve`);

    expect(res.status).toBe(200);
    // Mitad 1 (transición del orquestador): el step avanza a succeeded.
    expect(await statusOf(stepId)).toBe('succeeded');
    // Mitad 2 (efecto de dominio de CP4): la variante pasa a approved. Que las DOS ocurran es lo que el
    // seam-test no puede afirmar (bypasea el route) — aquí se atraviesa `applyDomainEffect`.
    expect(await variantStatusOf(variantId)).toBe('approved');
  });

  it('RECHAZAR: POST /reject → 200, step rejected Y ad_variant rejected (el route reescrito, net-new)', async () => {
    // El path MÁS NUEVO: reject dejó de ser `rejectStep` pelado y ahora corre `withDomainTransaction` +
    // `applyDomainEffectOnReject`. Sin este test, la mitad de la variante viajaría solo en la Playwright
    // de T5.6. El control negativo que demuestra que el efecto MUERDE está en `server/qa-checkpoint.test.ts`.
    const { stepId, variantId } = await seedQaCheckpoint(false);

    const res = await call(rejectPost, stepId, `/api/steps/${stepId}/reject`);

    expect(res.status).toBe(200);
    expect(await statusOf(stepId)).toBe('rejected');
    expect(await variantStatusOf(variantId)).toBe('rejected');
  });

  it('ATOMICIDAD: si la transición del reject FALLA (step no está en waiting_approval), la variante NO se muta', async () => {
    // El invariante que hace load-bearing la tx compartida del route de reject: si el step ya no está en
    // `waiting_approval` (doble clic / redelivery) la transición lanza 409, y el efecto de dominio
    // (ad_variant→rejected) NO debe haber quedado escrito. Sin la tx compartida, la variante quedaría
    // `rejected` sobre un step que nunca se rechazó.
    const { stepId, variantId } = await seedQaCheckpoint(false);
    // Se fuerza el estado terminal: el step ya está succeeded (aprobado antes) ⇒ reject es ilegal.
    await tdb.pool.query(`UPDATE step_run SET status = 'succeeded' WHERE id = $1`, [stepId]);

    const res = await call(rejectPost, stepId, `/api/steps/${stepId}/reject`);

    expect(res.status).toBe(409);
    // La variante sigue como estaba: el rollback deshizo cualquier escritura del efecto de dominio.
    expect(await variantStatusOf(variantId)).toBe('planned');
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// T5.14 — CP3 · CONFIRMAR CON 0 APROBADAS NO VARA EL LOTE, CONDUCIDO POR LA RUTA REAL.
//
// EL GAP QUE CIERRA (patrón T1.13: el arnés asertando en un SEAM más cómodo que la ruta). El fix de
// T5.14 vive en `server/script-checkpoint.ts`: un guard que lanza `AppError('validation_error')` si 0
// variantes quedarían `scripted`, ANTES de `applyScriptVerdicts`, DENTRO de `withDomainTransaction`. Su
// MECANISMO —el que impide el varado irreversible— es que ese throw revierte la MISMA tx que envuelve
// `approveStep`, de modo que la transición del step (N5 → succeeded) se DES-HACE y el checkpoint NO se
// consume. Los 5 tests existentes de T5.14 assertan en el seam (`approveInTx` de
// `server/scripts-checkpoint.test.ts`: variante `planned`, throw) o en componente UI; NINGUNO conduce
// `POST /api/steps/:id/approve`. Eso deja sin proteger el eslabón real: que el guard corra DENTRO de la
// tx del route handler y su throw des-consuma el checkpoint. Si alguien sacara el guard fuera de esa tx
// (o partiera la transición del step en su propio commit), el seam-test seguiría VERDE y el bug de
// producción (lote varado, guiones ya pagados, 2º POST 409) volvería. Estos tests conducen el HANDLER
// REAL y afirman el desenlace observable por HTTP: 400 tipado + checkpoint intacto + 2º POST 400 (no 409).
//
// CONTROL NEGATIVO (verificado por el implementer, no vive en el árbol): revertir el guard —el throw
// pasa a `return {}` como el bug original— pone ROJO el 2º test: `applyScriptVerdicts` corre, el
// checkpoint se consume (N5 → succeeded) y el 2º POST devuelve 409 (`expected 409 to be 400`).
describe('CP3 · confirmar con 0 aprobadas NO vara el lote — a nivel ROUTE (T5.14)', () => {
  /** Un `AdScript` de contrato mínimo pero válido (mismo molde que el seam-test de T2.6): 3 escenas
   *  hook/body/cta. Es lo que `createScriptsForBatch` persiste como v1 de cada variante del lote. */
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
    };
  }

  /**
   * Siembra un CP3 REAL: un lote tier-TEST con `n` variantes + sus guiones v1 (sin flags bloqueantes) y un
   * step N5 en `waiting_approval` (is_checkpoint) cuyo `output_refs` es el N5Output que apunta a TODAS ellas.
   * Devuelve el `stepId` y los ids de variante — lo que el route lee para despachar `approveScriptsForStep`.
   *
   * Tier `test` a propósito (no `premium`): esta suite NO siembra persona ni galería, así que
   * `isTierGenerationReady('test')` es false → aprobar guiones commitea los veredictos (variantes →
   * `scripted`, step → `succeeded`) SIN intentar `buildVariantGenerationPlan` (que reventaría por falta de
   * imagen de referencia). Así el control POSITIVO llega limpio a `scripted` y el 400 del caso negativo es
   * inequívocamente el guard de T5.14, no un `PersonaWithoutReferenceImageError` disfrazado de validation_error.
   *
   * El `output_refs` referencia a TODAS las variantes del lote (guiones completos): si faltara alguno,
   * saltaría ANTES el guard de lote truncado de T5.11 (otro `validation_error`) y el test mordería por el
   * motivo equivocado.
   */
  async function seedScriptsCheckpoint(
    n: number,
  ): Promise<{ stepId: string; variantIds: string[] }> {
    const [p] = await tdb.db.insert(projectTable).values(makeProject()).returning();
    const [ua] = await tdb.db
      .insert(urlAnalysis)
      .values(makeUrlAnalysis({ projectId: p!.id }))
      .returning();
    const brief = makeBrief();
    const [briefRow] = await tdb.db
      .insert(productBrief)
      .values(makeProductBrief({ urlAnalysisId: ua!.id, data: brief }))
      .returning();

    const { libraryHooks, personas, recipe } = await listPlanningInputs(tdb.db, 'test');
    const config = {
      angleIndices: Array.from({ length: n }, (_, i) => i),
      hooksPerAngle: 1,
      objective: 'hook_test' as const,
      tier: 'test' as const,
      languages: ['es'],
      personaMode: 'rotate' as const,
    };
    const args = { brief, config, libraryHooks, personas, recipe: recipe! };
    const preview = planBatch(args);
    const created = await createBatchWithVariants(tdb.db, {
      projectId: p!.id,
      briefId: briefRow!.id,
      tier: 'test',
      objective: 'hook_test',
      languages: ['es'],
      costEstimatedCents: preview.estimate.total.maxCents,
      composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
    });
    const variants = await listBatchVariants(tdb.db, created.batch.id);

    // El step N5 se inserta ANTES que los guiones para pasar su id REAL como `origin_step_run_id` (idempotencia
    // de N5). El seam-test usa un ULID huérfano; aquí el step existe de verdad, más fiel al camino de producción.
    const runId = newUlid();
    await tdb.pool.query(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [
      runId,
      p!.id,
    ]);
    const stepId = newUlid();

    const createdScripts = await createScriptsForBatch(tdb.db, {
      stepRunId: stepId,
      scripts: variants.map((v) => ({
        variantId: v.id,
        content: makeScriptContract(),
        guardrailFlags: [] as GuardrailFlag[],
      })),
    });

    // El N5Output que N5 dejó en su `output_refs`: una scriptRef por CADA variante (lote COMPLETO — sin esto
    // saltaría el guard de T5.11 primero). Es lo que `approveScriptsForStep` valida por schema y lee.
    const artifact: N5Output = {
      batchId: created.batch.id,
      scriptRefs: createdScripts.map((s, i) => ({
        variantId: s.variantId,
        scriptId: s.id,
        filenameCode: variants[i]!.filenameCode,
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
    return { stepId, variantIds: variants.map((v) => v.id) };
  }

  /** La decisión `scripts` que el body de `/approve` lleva: un veredicto por variante con su `approved`. */
  function scriptsDecision(verdicts: { variantId: string; approved: boolean }[]) {
    return { decision: { kind: 'scripts' as const, verdicts } };
  }

  async function variantStatusOf(variantId: string): Promise<string> {
    const { rows } = await tdb.pool.query<{ status: string }>(
      `SELECT status FROM ad_variant WHERE id = $1`,
      [variantId],
    );
    return rows[0]!.status;
  }

  it('POST con 0 aprobadas → 400 validation_error y el checkpoint NO se consume (step sigue waiting_approval)', async () => {
    // El POST que la UI de «0/6 aprobadas» mandaba: lote completo, todas `approved:false`. El guard de
    // T5.14 lanza DENTRO de `withDomainTransaction` → la tx entera (incluida la transición del step de
    // `approveStep`) revierte. Se asserta el MENSAJE, no solo el 400: en este camino hay ≥3
    // `validation_error` distintos (lote truncado T5.11, veredicto sin guion, y este) — el 400 pelado
    // podría ir verde por el motivo equivocado y el control negativo sería teatro.
    const { stepId, variantIds } = await seedScriptsCheckpoint(2);

    const res = await call(
      approvePost,
      stepId,
      `/api/steps/${stepId}/approve`,
      scriptsDecision([
        { variantId: variantIds[0]!, approved: false },
        { variantId: variantIds[1]!, approved: false },
      ]),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('validation_error');
    expect(body.message).toMatch(/no aprobaría NINGUNA variante/);
    // EL INVARIANTE DEL FIX: el checkpoint sigue vivo (el throw des-consumió la transición). Si el guard
    // corriera fuera de la tx del route, aquí el step estaría `succeeded` y el lote quedaría varado.
    expect(await statusOf(stepId)).toBe('waiting_approval');
    expect(await variantStatusOf(variantIds[0]!)).toBe('planned');
    expect(await variantStatusOf(variantIds[1]!)).toBe('planned');
  });

  it('el lote sigue OPERABLE: un 2º POST idéntico vuelve a dar 400 (NO 409) — el checkpoint no se consumió', async () => {
    // ESTE es el test que muerde el mecanismo T1.13: si el fix estuviera fuera de la tx (o el guard se
    // quitara), el 1er POST habría consumido el checkpoint (N5 → succeeded) y el 2º daría 409
    // invalid_transition (el step ya no está en `waiting_approval`). Que el 2º dé OTRA VEZ 400 prueba que
    // el checkpoint sigue en `waiting_approval`, es decir que el throw revirtió la tx del route handler.
    const { stepId, variantIds } = await seedScriptsCheckpoint(2);
    const body = scriptsDecision([
      { variantId: variantIds[0]!, approved: false },
      { variantId: variantIds[1]!, approved: false },
    ]);

    // Los DOS POST se emiten ANTES de cualquier assert, y se asserta el 2º PRIMERO. El orden importa
    // para el CONTROL NEGATIVO: sin el guard, el 1er POST devuelve 200 (consume el checkpoint) y el 2º
    // da 409 — si se asertara `first` antes, el test abortaría en «expected 200 to be 400» sin llegar a
    // exhibir el 409, que es LA evidencia que caracteriza este bug (checkpoint consumido). Asertando
    // `second` primero, quitar el guard produce el literal `expected 409 to be 400`.
    const first = await call(approvePost, stepId, `/api/steps/${stepId}/approve`, body);
    const second = await call(approvePost, stepId, `/api/steps/${stepId}/approve`, body);

    // EL ASSERT QUE MUERDE: el 2º POST vuelve a dar 400 (mismo guard), NO 409. Un 409 aquí significaría
    // que el 1er POST consumió el checkpoint (N5 → succeeded) — exactamente el varado que T5.14 cierra.
    expect(second.status).toBe(400);
    expect(((await second.json()) as { code: string }).code).toBe('validation_error');
    // El 1er POST también fue 400 (se conserva la cobertura): si hubiera sido 500, el 2º daría 400 igual
    // y el test pasaría por el motivo equivocado — este assert descarta ese falso verde.
    expect(first.status).toBe(400);
    expect(await statusOf(stepId)).toBe('waiting_approval');
  });

  it('control POSITIVO: aprobar AL MENOS UNA variante limpia → 200 y el lote avanza (step succeeded, variante scripted)', async () => {
    // El contraste que demuestra que el test no es «siempre 400»: con 1 aprobada el guard NO salta, la
    // aprobación procede y el lote avanza. En tier-test no arranca run (no generation-ready) → sin
    // `nextRunId`, que es el equivalente legítimo de «el lote avanza»: la transición del step Y la
    // transición de la variante a `scripted` (el efecto de dominio CP3) SÍ commitean. Asertar `scripted`
    // es lo que prueba que el despacho atravesó `approveScriptsForStep` por la ruta (no solo `approveStep`).
    const { stepId, variantIds } = await seedScriptsCheckpoint(2);

    const res = await call(
      approvePost,
      stepId,
      `/api/steps/${stepId}/approve`,
      scriptsDecision([
        { variantId: variantIds[0]!, approved: true },
        { variantId: variantIds[1]!, approved: false },
      ]),
    );

    expect(res.status).toBe(200);
    expect(await statusOf(stepId)).toBe('succeeded');
    // La aprobada llegó a `scripted` (efecto de dominio CP3 atravesado por la ruta); la rechazada, no.
    expect(await variantStatusOf(variantIds[0]!)).toBe('scripted');
    expect(await variantStatusOf(variantIds[1]!)).not.toBe('scripted');
  });
});
