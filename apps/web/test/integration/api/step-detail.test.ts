// Integración handler-level de `GET /api/steps/:id` (T1.16) contra Postgres real (api.md §2,
// nivel 1). El contrato que se prueba NO es "devuelve 200": es que devuelve el artefacto Y el
// error **ENTEROS**, mientras la proyección del SSE los TRUNCA a 200 caracteres.
//
// Por qué importa el control negativo: el `errorExcerpt` del stream se corta a 200 chars, y los
// errores que de verdad hay que leer son largos (un `PermanentStepError` de N3 arrastra el
// volcado de issues de Zod, varios KB — cortado, el usuario ve el prefijo y CERO issues). Un
// test con un error corto ("fallo inyectado", 25 chars) NO PUEDE ponerse rojo por ese bug: cabe
// entero en el recorte. Así que aquí el error de la fixture pasa de 200 caracteres y se asserta
// las DOS caras: el snapshot del SSE lo trunca (el cliente NO tiene el dato) y el endpoint lo
// sirve completo (por eso existe).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { createTestDatabase, makeProject } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { readRunSnapshot } from '@ugc/db';
import { setDbForTests } from '@/server/db';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { GET as getStep } from '@/app/api/steps/[id]/route';

const TEST_MASTER_KEY = 'test-master-key-for-step-detail-suite';

// Un error con la FORMA de los reales: prefijo del nodo + volcado de issues (lo que produce
// `PermanentStepError` con el `.message` de Zod). Bien pasado de 200 caracteres, y con un
// centinela AL FINAL — el sitio donde el recorte lo mataría.
const SENTINEL = 'ANGULO_SIN_HOOK_AL_FINAL';
const LONG_ERROR = `N3: config inválida: ${Array.from(
  { length: 12 },
  (_, i) =>
    `[{"code":"invalid_type","expected":"string","path":["angles",${String(i)},"hook"],"message":"Required"}]`,
).join(' ')} ${SENTINEL}`;

// El artefacto también supera el recorte (mismo criterio para el output). El centinela va en el
// ÚLTIMO elemento de una lista larga —y no en "la última clave"— porque el orden de claves de un
// objeto NO es el que uno escribe: Postgres normaliza el jsonb (ordena las claves por longitud y
// luego alfabéticamente), así que "la última clave del literal" puede acabar la primera del
// serializado. Dentro de un ARRAY el orden sí se conserva.
const OUTPUT_SENTINEL = 'ULTIMO_ANGULO_DEL_BRIEF';
const OUTPUT = {
  brief: {
    name: 'Sérum Hidratante 24h',
    angles: [
      ...Array.from(
        { length: 12 },
        (_, i) => `angulo numero ${String(i)} del brief, con su texto largo de verdad`,
      ),
      OUTPUT_SENTINEL,
    ],
  },
};

let tdb: TestDatabase;

function cookie(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

function call(id: string): Promise<Response> {
  return getStep(
    new Request(`http://test.local/api/steps/${id}`, { headers: { cookie: cookie() } }),
    { params: Promise.resolve({ id }) },
  );
}

async function seedFailedStep(): Promise<{ runId: string; stepId: string }> {
  const projectId = newUlid();
  await tdb.pool.query(`INSERT INTO project (id, name) VALUES ($1, $2)`, [
    projectId,
    makeProject().name,
  ]);
  const runId = newUlid();
  await tdb.pool.query(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [
    runId,
    projectId,
  ]);
  const stepId = newUlid();
  await tdb.pool.query(
    `INSERT INTO step_run (id, run_id, node_key, status, output_refs, error)
     VALUES ($1, $2, 'N3', 'failed', $3, $4)`,
    // El error se persiste como `{message}` — la forma que escribe el consumer real
    // (step-execute.ts). Serializarlo distinto aquí sería un test cómodo contra una fixture
    // que producción no produce.
    [stepId, runId, JSON.stringify(OUTPUT), JSON.stringify({ message: LONG_ERROR })],
  );
  return { runId, stepId };
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:step-detail' });
  setDbForTests(tdb.db);
});

afterEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project CASCADE');
});

afterAll(async () => {
  await tdb.close();
});

describe('GET /api/steps/:id (T1.16)', () => {
  it('devuelve el error COMPLETO, que la proyección del SSE sí trunca', async () => {
    const { runId, stepId } = await seedFailedStep();

    // CONTROL NEGATIVO: lo que el cliente recibe por SSE está recortado — el centinela del
    // final del mensaje NO viaja. Si el excerpt dejara de truncar, este assert fallaría y el
    // test dejaría de tener sentido (y avisaría, en vez de mentir en verde).
    const snapshot = await readRunSnapshot(tdb.db, runId);
    const snap = snapshot.steps.find((s) => s.id === stepId);
    expect(snap?.errorExcerpt).toBeTruthy();
    expect(snap?.errorExcerpt).not.toContain(SENTINEL);
    expect(snap?.errorExcerpt?.length).toBe(200);

    // Y lo que sirve el endpoint es el mensaje ENTERO (pelado del `{message}`), centinela
    // final incluido: es exactamente el dato que la modal del inspector pinta.
    const res = await call(stepId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: string | null; outputRefs: unknown };
    expect(body.error).toBe(LONG_ERROR);
    expect(body.error).toContain(SENTINEL);
    expect(body.error?.length).toBeGreaterThan(200);
  });

  it('devuelve el output_refs ENTERO, que el SSE también trunca', async () => {
    const { runId, stepId } = await seedFailedStep();

    // CONTROL NEGATIVO, igual que con el error: el excerpt del SSE está cortado y el
    // centinela de la última clave NO llega al cliente.
    const snapshot = await readRunSnapshot(tdb.db, runId);
    const snap = snapshot.steps.find((s) => s.id === stepId);
    expect(snap?.outputExcerpt?.length).toBe(200);
    expect(snap?.outputExcerpt).not.toContain(OUTPUT_SENTINEL);

    const body = (await (await call(stepId)).json()) as { outputRefs: unknown };
    expect(body.outputRefs).toEqual(OUTPUT); // el jsonb entero, sin recorte
    expect(JSON.stringify(body.outputRefs)).toContain(OUTPUT_SENTINEL);
  });

  it('un step sin error devuelve `error: null` (no un hueco raro)', async () => {
    const projectId = newUlid();
    await tdb.pool.query(`INSERT INTO project (id, name) VALUES ($1, $2)`, [
      projectId,
      makeProject().name,
    ]);
    const runId = newUlid();
    await tdb.pool.query(`INSERT INTO pipeline_run (id, project_id) VALUES ($1, $2)`, [
      runId,
      projectId,
    ]);
    const stepId = newUlid();
    await tdb.pool.query(
      `INSERT INTO step_run (id, run_id, node_key, status) VALUES ($1, $2, 'N1', 'succeeded')`,
      [stepId, runId],
    );

    const body = (await (await call(stepId)).json()) as { error: unknown; outputRefs: unknown };
    expect(body.error).toBeNull();
    expect(body.outputRefs).toBeNull();
  });
});
