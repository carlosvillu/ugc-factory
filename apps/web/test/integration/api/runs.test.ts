// Integración handler-level de `POST /api/runs` (T0.7b) contra Postgres real
// (api.md §2, nivel 1): el handler exportado invocado en proceso con `new
// Request()`, la BD y el boss inyectados vía los accessors lazy. El contrato real
// de la ruta es el efecto transaccional (§9.0): INSERT del run + steps y encolado
// atómico de los roots, no solo el 201. NO es e2e/Playwright.
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
import { POST } from '@/app/api/runs/route';

// `POST /api/runs` va envuelta en withAuth (T0.4): sin una cookie de sesión válida
// devuelve 401 antes de tocar la BD. Estos tests inyectan una master key de test y
// firman una cookie con ella; el 401 propio se cubre en el test de auth de runs.
const TEST_MASTER_KEY = 'test-master-key-for-runs-suite';
function sessionCookieHeader(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

interface StepRow {
  id: string;
  status: string;
  config: unknown;
}

let tdb: TestDatabase;
let boss: PgBoss;

function callPost(body: unknown): Promise<Response> {
  return POST(
    new Request('http://test.local/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookieHeader() },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }, // ctx de Next: la ruta ahora usa withRoute
  );
}

async function seedProject(): Promise<string> {
  // INSERT vía SQL crudo (web no depende de drizzle-orm). El `id` ULID es
  // app-generated ($defaultFn de drizzle, NO un default de la BD): en SQL crudo hay
  // que pasarlo a mano.
  const p = makeProject();
  const { rows } = await tdb.pool.query<{ id: string }>(
    `INSERT INTO project (id, name) VALUES ($1, $2) RETURNING id`,
    [newUlid(), p.name],
  );
  return rows[0]!.id;
}

async function stepsOfRun(runId: string): Promise<StepRow[]> {
  const { rows } = await tdb.pool.query<{ id: string; status: string; config: unknown }>(
    `SELECT id, status, config FROM step_run WHERE run_id = $1`,
    [runId],
  );
  return rows;
}

async function countRows(table: 'pipeline_run' | 'step_run', runId?: string): Promise<number> {
  const { rows } = runId
    ? await tdb.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${table === 'pipeline_run' ? 'id' : 'run_id'} = $1`,
        [runId],
      )
    : await tdb.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]!.n;
}

async function countStepJobs(): Promise<number> {
  const { rows } = await tdb.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1`,
    [stepExecuteJob.name],
  );
  return rows[0]!.n;
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:runs' });
  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* errores operativos del poller: irrelevantes para estos asserts */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);
  // Inyecta la BD y el boss del test en los accessors lazy del handler.
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

describe('POST /api/runs', () => {
  it('DAG N0→N1→N2: 201, crea run + 3 steps y encola el root en la MISMA tx', async () => {
    const projectId = await seedProject();
    const res = await callPost({
      projectId,
      // node_key DISTINTO por nodo: el mismo node_key en un run colisionaría en el
      // singletonKey de encolado (validado en validateDag).
      nodes: [
        { key: 'N0', nodeKey: 'demo.sleep.N0', dependsOn: [], config: { sleepMs: 0 } },
        { key: 'N1', nodeKey: 'demo.sleep.N1', dependsOn: ['N0'], config: { sleepMs: 0 } },
        { key: 'N2', nodeKey: 'demo.sleep.N2', dependsOn: ['N1'], config: { sleepMs: 0 } },
      ],
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string; steps: { status: string }[] };
    expect(body.runId).toBeTruthy();
    expect(body.steps).toHaveLength(3);

    // El run existe y tiene 3 steps.
    expect(await countRows('pipeline_run', body.runId)).toBe(1);
    const steps = await stepsOfRun(body.runId);
    expect(steps).toHaveLength(3);

    // Estados iniciales POST-encolado: 1 root `queued`, 2 dependientes
    // `awaiting_deps`. La Entrega exige que EXISTAN ambos estados.
    expect(steps.filter((s) => s.status === 'queued')).toHaveLength(1);
    expect(steps.filter((s) => s.status === 'awaiting_deps')).toHaveLength(2);

    // Encolado ATÓMICO en la misma tx: exactamente 1 job step.execute (el root).
    expect(await countStepJobs()).toBe(1);

    // La config del root se persistió en step_run.config.
    const root = steps.find((s) => s.status === 'queued')!;
    expect(root.config).toEqual({ sleepMs: 0 });
  });

  it('body que no cumple el schema ⇒ 400 validation_error con details', async () => {
    const res = await callPost({ projectId: 'p', nodes: [] }); // nodes vacío viola min(1)
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string; details?: unknown };
    expect(body.code).toBe('validation_error');
    expect(typeof body.message).toBe('string');
    expect(body.details).toBeDefined();
  });

  it('DAG con ciclo ⇒ 400 validation_error, cero filas', async () => {
    const projectId = await seedProject();
    const res = await callPost({
      projectId,
      // node_keys distintos: aísla el fallo al CICLO, no a node_key duplicado.
      nodes: [
        { key: 'A', nodeKey: 'demo.a', dependsOn: ['B'] },
        { key: 'B', nodeKey: 'demo.b', dependsOn: ['A'] },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('validation_error');
    expect(await countRows('step_run')).toBe(0);
  });

  it('DAG con node_key duplicado (keys distintas) ⇒ 400 validation_error, cero filas', async () => {
    const projectId = await seedProject();
    const res = await callPost({
      projectId,
      nodes: [
        { key: 'A', nodeKey: 'demo.dup', dependsOn: [] },
        { key: 'B', nodeKey: 'demo.dup', dependsOn: ['A'] },
      ],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('validation_error');
    expect(await countRows('step_run')).toBe(0);
  });

  it('body JSON malformado ⇒ 400 validation_error', async () => {
    const res = await POST(
      new Request('http://test.local/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: sessionCookieHeader() },
        body: '{ no json',
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('validation_error');
  });
});
