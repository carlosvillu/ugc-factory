// Integración handler-level de `POST /api/runs` (T0.7b) contra Postgres real
// (api.md §2, nivel 1): el handler exportado invocado en proceso con `new
// Request()`, la BD y el boss inyectados vía los accessors lazy. El contrato real
// de la ruta es el efecto transaccional (§9.0): INSERT del run + steps y encolado
// atómico de los roots, no solo el 201. NO es e2e/Playwright.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newUlid, RunListSchema, type RunList } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase, makeProject } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';
import { ensureQueue } from '@ugc/db';
import { setDbForTests } from '@/server/db';
import { setBossForTests } from '@/server/boss';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { GET, POST } from '@/app/api/runs/route';
import { GET as runDetailGet } from '@/app/api/runs/[id]/route';

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

// ────────────────────────────────────────────────────────────────────────────────────────────
// `GET /api/runs` — EL LISTADO (T1.17)
//
// Lo que estos tests blindan NO es "devuelve 200 con un array": es que el listado NO MIENTA.
// Tres columnas de la BD mienten hoy y el endpoint no puede leer ninguna:
//
//   · `pipeline_run.status` — nadie lo mantiene (deuda de T0.8). Por eso los runs de estos
//     tests se siembran con status `pending` A PROPÓSITO (el default de la tabla, exactamente
//     lo que hay en la BD real) y aun así el listado debe decir `succeeded`/`failed`. Un
//     endpoint que leyera la columna suspendería aquí.
//   · `pipeline_run.total_cost_actual` — NULL siempre, misma historia.
//   · `step_run.cost_actual` — la peor: `rollupStepCost` solo corre al cerrar BIEN un step, así
//     que un step FALLIDO que GASTÓ deja la columna NULL. El test del run muerto lo reproduce
//     literalmente (cost_actual NULL + 13 céntimos en el ledger) y exige ver los 13 céntimos.
// ────────────────────────────────────────────────────────────────────────────────────────────

interface SeedStep {
  nodeKey: string;
  status: string;
  /** Céntimos que ESTE step dejó en el LEDGER (`cost_entry`), gastados de verdad. */
  ledgerCents?: number;
  /** Lo que `rollupStepCost` habría escrito en `step_run.cost_actual` (NULL si el step falló). */
  costActual?: number | null;
  error?: unknown;
  config?: unknown;
}

/**
 * Siembra un run TERMINAL por SQL. Deliberado: `POST /api/runs` crea el run pero solo el WORKER
 * lo mueve, y este es un test de LECTURA — necesita runs ya acabados (uno completado, otro
 * muerto), que es justo el estado que el listado tiene que saber contar. (La regla "los runs se
 * crean vía POST" de `e2e/support/runs.ts` existe porque un run insertado por SQL no se EJECUTA;
 * aquí no queremos que se ejecute.)
 */
async function seedRun(opts: {
  projectId: string;
  createdAt: string;
  steps: SeedStep[];
}): Promise<string> {
  const runId = newUlid();
  await tdb.pool.query(
    // `status` se deja en su DEFAULT ('pending'): es lo que la BD real tiene en TODOS los runs,
    // incluidos los completados. Si el listado lo leyera, mentiría — y estos tests lo cazan.
    `INSERT INTO pipeline_run (id, project_id, kind, created_at) VALUES ($1, $2, 'full', $3)`,
    [runId, opts.projectId, opts.createdAt],
  );
  for (const step of opts.steps) {
    const stepId = newUlid();
    await tdb.pool.query(
      `INSERT INTO step_run (id, run_id, node_key, status, cost_actual, error, config)
       VALUES ($1, $2, $3, $4::step_status, $5, $6::jsonb, $7::jsonb)`,
      [
        stepId,
        runId,
        step.nodeKey,
        step.status,
        step.costActual ?? null,
        step.error === undefined ? null : JSON.stringify(step.error),
        step.config === undefined ? null : JSON.stringify(step.config),
      ],
    );
    if (step.ledgerCents !== undefined) {
      await tdb.pool.query(
        `INSERT INTO cost_entry (id, provider, step_run_id, amount_cents) VALUES ($1, 'anthropic', $2, $3)`,
        [newUlid(), stepId, step.ledgerCents],
      );
    }
  }
  return runId;
}

function callGet(query = ''): Promise<Response> {
  return GET(
    new Request(`http://test.local/api/runs${query}`, {
      headers: { cookie: sessionCookieHeader() },
    }),
    { params: Promise.resolve({}) },
  );
}

async function getRuns(query = ''): Promise<RunList> {
  const res = await callGet(query);
  expect(res.status).toBe(200);
  // Se valida contra el contrato de core: si el handler devolviera otra forma, revienta AQUÍ.
  return RunListSchema.parse(await res.json());
}

describe('GET /api/runs (T1.17)', () => {
  beforeEach(async () => {
    // `TRUNCATE step_run … CASCADE` no se lleva `cost_entry` (no hay FK: el ledger sobrevive a
    // propósito al run que lo generó). Se limpia aquí o los céntimos de un test se colarían en
    // las sumas del siguiente.
    await tdb.pool.query('TRUNCATE cost_entry');
  });

  it('lista los runs en orden DESC por creación, con su origen', async () => {
    const projectId = await seedProject();
    const older = await seedRun({
      projectId,
      createdAt: '2026-07-13T06:00:00Z',
      steps: [
        {
          nodeKey: 'N1',
          status: 'succeeded',
          config: { source: 'url', projectId, url: 'https://relatio.chat/' },
        },
      ],
    });
    const newer = await seedRun({
      projectId,
      createdAt: '2026-07-13T09:00:00Z',
      steps: [
        {
          nodeKey: 'N1',
          status: 'succeeded',
          config: { source: 'url', projectId, url: 'https://es.stayforlong.com' },
        },
      ],
    });

    const page = await getRuns();
    expect(page.total).toBe(2);
    expect(page.runs.map((r) => r.id)).toEqual([newer, older]); // el último lanzado, arriba
    // El ORIGEN: qué se analizó, no un ULID opaco. Sale de la `config` de N1 (el input del
    // intake), la única atadura real run→análisis (no hay FK a `url_analysis`).
    expect(page.runs[0]!.origin).toEqual({ source: 'url', url: 'https://es.stayforlong.com' });
    expect(page.runs[1]!.origin).toEqual({ source: 'url', url: 'https://relatio.chat/' });
  });

  it('un run con sus 3 steps OK se lista SUCCEEDED aunque pipeline_run.status diga pending', async () => {
    // Los dos runs REALES de la BD local que completaron. La columna del run dice `pending`.
    const projectId = await seedProject();
    const runId = await seedRun({
      projectId,
      createdAt: '2026-07-13T09:41:53Z',
      steps: [
        { nodeKey: 'N1', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        { nodeKey: 'N2', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        { nodeKey: 'N3', status: 'succeeded', costActual: 18, ledgerCents: 18 },
      ],
    });

    // La premisa del test: la columna del run MIENTE. Si algún día alguien la arregla, este
    // assert cae y hay que revisar la derivación (no borrarla: seguiría siendo el oráculo).
    const { rows } = await tdb.pool.query<{ status: string; total_cost_actual: number | null }>(
      `SELECT status, total_cost_actual FROM pipeline_run WHERE id = $1`,
      [runId],
    );
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.total_cost_actual).toBeNull();

    const [run] = (await getRuns()).runs;
    expect(run!.status).toBe('succeeded'); // DERIVADO de los steps, no leído de la columna
    expect(run!.costActualCents).toBe(18);
    expect(run!.currentStep).toBeNull(); // un run completado no tiene «paso actual»
    expect(run!.error).toBeNull();
  });

  it('un run muerto en N3 se lista FAILED, señala el step y MUESTRA EL DINERO QUE GASTÓ', async () => {
    // Reproduce literalmente los dos runs muertos de la BD local: N1/N2 OK, N3 `failed` con
    // `cost_actual` NULL (el rollup no corre en el fallo) pero 13 céntimos EN EL LEDGER.
    // Un listado que sumara `step_run.cost_actual` diría $0.00 aquí: ocultaría gasto real.
    const projectId = await seedProject();
    await seedRun({
      projectId,
      createdAt: '2026-07-13T06:14:28Z',
      steps: [
        { nodeKey: 'N1', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        { nodeKey: 'N2', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        {
          nodeKey: 'N3',
          status: 'failed',
          costActual: null, // ← la columna del step MIENTE: gastó y no lo dice
          ledgerCents: 13, // ← la verdad del dinero vive en el ledger
          error: { message: 'N3: el brief no supera la validación determinista (T1.9)' },
        },
      ],
    });

    const [run] = (await getRuns()).runs;
    expect(run!.status).toBe('failed');
    expect(run!.currentStep).toBe('N3'); // el step que EXPLICA el estado
    expect(run!.error).toContain('no supera la validación determinista');
    expect(run!.costActualCents).toBe(13); // ← EL ASSERT QUE IMPORTA: no $0.00
  });

  it('un run parado en un checkpoint se lista WAITING_APPROVAL con su step', async () => {
    const projectId = await seedProject();
    await seedRun({
      projectId,
      createdAt: '2026-07-13T10:00:00Z',
      steps: [
        { nodeKey: 'N1', status: 'succeeded' },
        { nodeKey: 'N2', status: 'skipped' }, // un nodo saltado SATISFACE su dependencia (T0.8)
        { nodeKey: 'N3', status: 'waiting_approval' },
      ],
    });

    const [run] = (await getRuns()).runs;
    expect(run!.status).toBe('waiting_approval');
    expect(run!.currentStep).toBe('N3');
  });

  it('el coste del run agrega el LEDGER de TODOS sus steps (incluidos los superseded)', async () => {
    // Asimetría deliberada: el ESTADO ignora los steps superseded (la verdad de un nodo es su
    // fila viva), pero el COSTE los incluye — el dinero del intento invalidado se gastó.
    const projectId = await seedProject();
    await seedRun({
      projectId,
      createdAt: '2026-07-13T11:00:00Z',
      steps: [
        { nodeKey: 'N1', status: 'succeeded', ledgerCents: 5 },
        { nodeKey: 'N3', status: 'superseded', ledgerCents: 16 }, // el intento fallido, ya PAGADO
        { nodeKey: 'N3', status: 'succeeded', ledgerCents: 18 }, // el reintento bueno
      ],
    });

    const [run] = (await getRuns()).runs;
    expect(run!.status).toBe('succeeded'); // el superseded NO arrastra el pasado
    expect(run!.costActualCents).toBe(5 + 16 + 18); // …pero su gasto SÍ cuenta
  });

  it('un run sin cargos vale 0, no null/NaN (el GROUP BY no lo devuelve)', async () => {
    const projectId = await seedProject();
    await seedRun({
      projectId,
      createdAt: '2026-07-13T12:00:00Z',
      steps: [{ nodeKey: 'N1', status: 'pending' }],
    });
    const [run] = (await getRuns()).runs;
    expect(run!.costActualCents).toBe(0);
    expect(run!.status).toBe('pending');
  });

  it('un run que NO es de análisis (DAG de demo) no inventa un origen', async () => {
    const projectId = await seedProject();
    await seedRun({
      projectId,
      createdAt: '2026-07-13T13:00:00Z',
      steps: [{ nodeKey: 'demo.canvas.N0', status: 'succeeded', config: { sleepMs: 10 } }],
    });
    const [run] = (await getRuns()).runs;
    expect(run!.origin).toEqual({ source: 'other' });
  });

  it('pagina con limit/offset y devuelve el total real', async () => {
    const projectId = await seedProject();
    for (let i = 0; i < 3; i++) {
      await seedRun({
        projectId,
        createdAt: `2026-07-13T0${String(i)}:00:00Z`,
        steps: [{ nodeKey: 'N1', status: 'succeeded' }],
      });
    }
    const first = await getRuns('?limit=2');
    expect(first.runs).toHaveLength(2);
    expect(first.total).toBe(3); // el TOTAL es el de la tabla, no el de la página
    expect(first.limit).toBe(2);

    const second = await getRuns('?limit=2&offset=2');
    expect(second.runs).toHaveLength(1);
    expect(second.offset).toBe(2);
    // Sin solapes: la página 2 no repite ninguno de la 1.
    const ids = new Set(first.runs.map((r) => r.id));
    expect(second.runs.some((r) => ids.has(r.id))).toBe(false);
  });

  it('una query inválida es 400 validation_error, no un 500', async () => {
    const res = await callGet('?limit=abc');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');

    // Y un limit fuera de rango tampoco puede tumbar la BD desde fuera.
    expect((await callGet('?limit=100000')).status).toBe(400);
  });

  it('sin sesión es 401 antes de tocar la BD', async () => {
    const res = await GET(new Request('http://test.local/api/runs'), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// `GET /api/runs/:id` — EL COSTE HONESTO DEL RUN (T1.17, bug de dinero)
//
// La cabecera del canvas sumaba en el CLIENTE el `costActual` de los steps del SSE, que sale de
// `step_run.cost_actual` — una columna que se queda **NULL cuando un step FALLA** (el rollup solo
// corre al cerrar BIEN). Los dos runs reales que murieron en N3 gastando 16 y 13 céntimos
// mostraban «Coste real: $0.00».
//
// Ahora el total lo computa el SERVIDOR desde el LEDGER (`runLedgerCost`, la MISMA función que
// alimenta el listado) y viaja en `costActualCents`. Este test lo blinda en el endpoint.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('GET /api/runs/:id · costActualCents (T1.17)', () => {
  beforeEach(async () => {
    await tdb.pool.query('TRUNCATE cost_entry');
  });

  async function getRun(runId: string): Promise<{
    costActualCents: number;
    totalCostActual: number | null;
    status: string;
  }> {
    const res = await runDetailGet(
      new Request(`http://test.local/api/runs/${runId}`, {
        headers: { cookie: sessionCookieHeader() },
      }),
      { params: Promise.resolve({ id: runId }) },
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      costActualCents: number;
      totalCostActual: number | null;
      status: string;
    };
  }

  it('un run MUERTO devuelve el dinero del LEDGER, no el 0 de la columna del step', async () => {
    const projectId = await seedProject();
    const runId = await seedRun({
      projectId,
      createdAt: '2026-07-13T06:14:28Z',
      steps: [
        { nodeKey: 'N1', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        { nodeKey: 'N2', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        // La fila del bug: falló, GASTÓ 13 céntimos, y su `cost_actual` es NULL.
        { nodeKey: 'N3', status: 'failed', costActual: null, ledgerCents: 13 },
      ],
    });

    const run = await getRun(runId);
    // Sumar `step_run.cost_actual` daría 0 (0 + 0 + NULL). El ledger dice 13.
    expect(run.costActualCents).toBe(13);
    // …y las DOS columnas muertas siguen muertas (se exponen, pero ya no las pinta nadie).
    expect(run.totalCostActual).toBeNull();
    expect(run.status).toBe('pending'); // el agregado que nadie mantiene
  });

  it('incluye el gasto de los intentos SUPERSEDED (el dinero del intento invalidado se gastó)', async () => {
    const projectId = await seedProject();
    const runId = await seedRun({
      projectId,
      createdAt: '2026-07-13T11:00:00Z',
      steps: [
        { nodeKey: 'N3', status: 'superseded', ledgerCents: 16 }, // intento fallido, ya PAGADO
        { nodeKey: 'N3', status: 'succeeded', costActual: 18, ledgerCents: 18 },
      ],
    });
    expect((await getRun(runId)).costActualCents).toBe(16 + 18);
  });

  it('un run sin cargos vale 0, no null/NaN', async () => {
    const projectId = await seedProject();
    const runId = await seedRun({
      projectId,
      createdAt: '2026-07-13T12:00:00Z',
      steps: [{ nodeKey: 'N1', status: 'pending' }],
    });
    expect((await getRun(runId)).costActualCents).toBe(0);
  });

  it('el coste del DETALLE y el del LISTADO coinciden (una sola verdad del dinero)', async () => {
    // El invariante que motivó extraer `runLedgerCost`: canvas y lista no pueden contradecirse
    // sobre lo que costó un run.
    const projectId = await seedProject();
    const runId = await seedRun({
      projectId,
      createdAt: '2026-07-13T13:00:00Z',
      steps: [
        { nodeKey: 'N1', status: 'succeeded', ledgerCents: 5 },
        { nodeKey: 'N3', status: 'failed', costActual: null, ledgerCents: 13 },
      ],
    });

    const detail = await getRun(runId);
    const listed = (await getRuns()).runs.find((r) => r.id === runId);
    expect(detail.costActualCents).toBe(18);
    expect(listed?.costActualCents).toBe(detail.costActualCents);
  });
});
