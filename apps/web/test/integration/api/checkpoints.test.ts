// Integración handler-level de los endpoints de checkpoint/skip/cancel (T0.8)
// contra Postgres real (api.md §2, nivel 1): los handlers exportados invocados en
// proceso con `new Request()`, la BD y el boss inyectados vía accessors lazy. El
// contrato real es el efecto transaccional (transición + supersede + audit_log),
// no solo el 200. NO es e2e/Playwright.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase, makeProject } from '@ugc/test-utils';
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
