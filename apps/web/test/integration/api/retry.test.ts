// Integración handler-level de `POST /api/steps/:id/retry` (T0.9) contra Postgres
// real + pg-boss real (api.md §2, nivel 1): el handler exportado invocado en
// proceso con `new Request()`, la BD y el boss inyectados vía accessors lazy. El
// contrato real es el efecto transaccional (failed→queued + reset de retry_count +
// patch de config + re-encolado), no solo el 200. NO es e2e/Playwright (T0.9 no
// declara Playwright permanente: sin superficie operable en navegador).
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
import { POST as retryPost } from '@/app/api/steps/[id]/retry/route';

const TEST_MASTER_KEY = 'test-master-key-for-retry-suite';
function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

let tdb: TestDatabase;
let boss: PgBoss;

function call(id: string, body?: unknown): Promise<Response> {
  return retryPost(
    new Request(`http://test.local/api/steps/${id}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie() },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function callNoAuth(id: string): Promise<Response> {
  return retryPost(
    new Request(`http://test.local/api/steps/${id}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function seedFailedStep(opts: {
  status?: string;
  nodeKey?: string;
  config?: unknown;
  retryCount?: number;
  maxRetries?: number;
}): Promise<{ runId: string; stepId: string }> {
  const p = makeProject();
  const projectId = newUlid();
  await tdb.pool.query(`INSERT INTO project (id, name) VALUES ($1, $2)`, [projectId, p.name]);
  const runId = newUlid();
  await tdb.pool.query(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [
    runId,
    projectId,
  ]);
  const stepId = newUlid();
  await tdb.pool.query(
    `INSERT INTO step_run (id, run_id, node_key, status, config, retry_count, max_retries)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      stepId,
      runId,
      opts.nodeKey ?? 'demo.fail',
      opts.status ?? 'failed',
      opts.config === undefined ? null : JSON.stringify(opts.config),
      opts.retryCount ?? 0,
      opts.maxRetries ?? 3,
    ],
  );
  return { runId, stepId };
}

async function rowOf(stepId: string): Promise<{
  status: string;
  retryCount: number;
  config: unknown;
}> {
  const { rows } = await tdb.pool.query<{ status: string; retry_count: string; config: unknown }>(
    `SELECT status, retry_count, config FROM step_run WHERE id = $1`,
    [stepId],
  );
  return {
    status: rows[0]!.status,
    retryCount: Number(rows[0]!.retry_count),
    config: rows[0]!.config,
  };
}

async function countJobs(nodeKey: string, runId: string): Promise<number> {
  const { rows } = await tdb.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND singleton_key = $2`,
    [stepExecuteJob.name, `${runId}:${nodeKey}`],
  );
  return rows[0]!.n;
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:retry' });
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
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});
afterEach(async () => {
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

describe('POST /api/steps/:id/retry', () => {
  it('reintenta un step failed → 200 + step queued + job encolado', async () => {
    const { runId, stepId } = await seedFailedStep({ status: 'failed', nodeKey: 'demo.fail' });
    const res = await call(stepId);
    expect(res.status).toBe(200);
    const row = await rowOf(stepId);
    expect(row.status).toBe('queued');
    expect(await countJobs('demo.fail', runId)).toBe(1);
  });

  it('con retries agotados: resetea retry_count a 0 y re-encola', async () => {
    const { stepId } = await seedFailedStep({
      status: 'failed',
      retryCount: 3,
      maxRetries: 3,
    });
    const res = await call(stepId);
    expect(res.status).toBe(200);
    const row = await rowOf(stepId);
    expect(row.status).toBe('queued');
    expect(row.retryCount).toBe(0);
  });

  it('aplica el patch de config del body (fail_rate 1→0) antes del re-encolado', async () => {
    const { stepId } = await seedFailedStep({ status: 'failed', config: { failRate: 1 } });
    const res = await call(stepId, { config: { failRate: 0 } });
    expect(res.status).toBe(200);
    const row = await rowOf(stepId);
    expect(row.status).toBe('queued');
    expect(row.config).toEqual({ failRate: 0 });
  });

  it('MERGE: un patch parcial NO borra claves obligatorias de la config (regresión del bug de prod)', async () => {
    // Escenario exacto del handoff 2026-07-15: N3 con `{ targetLanguage: "es" }` falla;
    // un patch parcial `{ failRate: 0 }` NO debe reemplazar la config entera (borrando
    // `targetLanguage`) sino mergear sobre ella. Antes del fix esto dejaba
    // `{ failRate: 0 }` sin `targetLanguage` → N3 moría en su safeParse al reencolarse.
    const { stepId } = await seedFailedStep({ status: 'failed', config: { targetLanguage: 'es' } });
    const res = await call(stepId, { config: { failRate: 0 } });
    expect(res.status).toBe(200);
    const row = await rowOf(stepId);
    expect(row.status).toBe('queued');
    // La clave obligatoria SOBREVIVE y la nueva se añade (merge superficial).
    expect(row.config).toEqual({ targetLanguage: 'es', failRate: 0 });
  });

  it('MERGE: una clave homónima del patch pisa la actual (misma clave = override)', async () => {
    const { stepId } = await seedFailedStep({
      status: 'failed',
      config: { targetLanguage: 'es', failRate: 1 },
    });
    const res = await call(stepId, { config: { failRate: 0 } });
    expect(res.status).toBe(200);
    expect((await rowOf(stepId)).config).toEqual({ targetLanguage: 'es', failRate: 0 });
  });

  it('MERGE: si la config actual es null (no-objeto), el patch la REEMPLAZA', async () => {
    const { stepId } = await seedFailedStep({ status: 'failed', config: undefined });
    const res = await call(stepId, { config: { failRate: 0 } });
    expect(res.status).toBe(200);
    expect((await rowOf(stepId)).config).toEqual({ failRate: 0 });
  });

  it('body vacío conserva la config existente', async () => {
    const { stepId } = await seedFailedStep({ status: 'failed', config: { failRate: 1 } });
    const res = await call(stepId, {});
    expect(res.status).toBe(200);
    expect((await rowOf(stepId)).config).toEqual({ failRate: 1 });
  });

  it('retry sobre un step NO-failed (running) → 409 invalid_transition, BD intacta', async () => {
    const { stepId } = await seedFailedStep({ status: 'running' });
    const before = await rowOf(stepId);
    const res = await call(stepId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');
    expect(await rowOf(stepId)).toEqual(before);
  });

  it('retry sobre un expired → 409 (no hay retry desde expired)', async () => {
    const { stepId } = await seedFailedStep({ status: 'expired', nodeKey: 'demo.hang' });
    const res = await call(stepId);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_transition');
  });

  it('step inexistente → 404 not_found', async () => {
    const res = await call(newUlid());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_found');
  });

  it(':id malformado (no ULID) → 400 validation_error', async () => {
    const res = await call('not-a-ulid');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('sin sesión → 401 unauthorized', async () => {
    const { stepId } = await seedFailedStep({ status: 'failed' });
    const res = await callNoAuth(stepId);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });
});
