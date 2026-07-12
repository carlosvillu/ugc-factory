// Integración handler-level de los endpoints de checkpoint/skip/cancel (T0.8)
// contra Postgres real (api.md §2, nivel 1): los handlers exportados invocados en
// proceso con `new Request()`, la BD y el boss inyectados vía accessors lazy. El
// contrato real es el efecto transaccional (transición + supersede + audit_log),
// no solo el 200. NO es e2e/Playwright.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase, makeBrief, makeProject } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';
import { ensureQueue } from '@ugc/db';
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
