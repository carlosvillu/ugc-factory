// Contrato SSE de `GET /api/runs/:id/events` (T0.10, §9.0) a NIVEL SERVER
// (testing/references/api.md §3, §3.3): un servidor Next REAL en subproceso contra
// un Postgres del testcontainer, no el route handler en proceso. Es la única forma
// de ejercitar el camino completo `transition → NOTIFY → LISTEN → frame SSE`
// cruzando el borde de proceso, más el ciclo de vida de la conexión (abort del
// cliente, conexión pg dedicada en LISTEN) que un test en proceso no toca.
//
// El delta se provoca con una TRANSICIÓN REAL vía el orquestador de @ugc/core
// contra el MISMO Postgres que ve el server: el NOTIFY que emite `transition()` en
// el COMMIT viaja por `pipeline_events` hasta el LISTEN del handler y sale como
// frame `step_changed`. El heartbeat se ve en <1 s gracias a `SSE_HEARTBEAT_MS=250`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgBoss } from 'pg-boss';
import { createRun, transition, demoRunDefinition, RunEventSchema } from '@ugc/core/orchestrator';
import { newUlid } from '@ugc/core/contracts';
import { stepExecuteJob } from '@ugc/core/jobs';
import { ensureQueue, makeWithTransaction } from '@ugc/db';
import { createTestDatabase, makeProject } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { createSessionValue, SESSION_COOKIE } from '@/server/session';
import { startWebServer, type RunningServer } from '../../helpers/server';
import { collectSse } from '../../helpers/sse';

let tdb: TestDatabase;
let boss: PgBoss;
let server: RunningServer;

// La cookie de sesión se firma con la master key del PROCESO DE TEST (.env.test:
// APP_MASTER_KEY=test-app-master-key-not-a-secret). El subproceso recibe la MISMA
// clave (server.ts propaga process.env.APP_MASTER_KEY), así que verifica esta misma
// cookie: sin esa coincidencia el 401 sería un falso fallo (la trampa de T0.7b).
function cookieHeader(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

// Un WithTransaction del PROCESO DE TEST contra el mismo Postgres del server: con él
// se siembra el run (createRun) y se dispara la transición (transition). Necesita su
// propio pg-boss porque createRun/transition encolan jobs en la MISMA tx.
function withTx() {
  return makeWithTransaction(tdb.db, boss);
}

async function seedProject(): Promise<string> {
  const p = makeProject();
  const { rows } = await tdb.pool.query<{ id: string }>(
    `INSERT INTO project (id, name) VALUES ($1, $2) RETURNING id`,
    [newUlid(), p.name],
  );
  return rows[0]!.id;
}

// Siembra el DAG de demo (N0→N1→N2). Tras createRun el root N0 queda `queued`
// (start es legal desde queued): la transición 'start' del test lo lleva a running.
async function seedDemoRun(): Promise<{ runId: string; rootStepId: string }> {
  const projectId = await seedProject();
  const result = await createRun({ withTransaction: withTx() }, demoRunDefinition(projectId));
  const root = result.steps.find((s) => s.key === 'N0')!;
  return { runId: result.runId, rootStepId: root.stepId };
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'web:sse' });
  boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* errores operativos del poller: irrelevantes para estos asserts */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);
  // El server ve el MISMO Postgres (misma connection string del clon). Heartbeat a
  // 250 ms para observar un latido en <1 s sin esperar 25 s reales.
  server = await startWebServer({
    databaseUrl: tdb.connectionString,
    env: { SSE_HEARTBEAT_MS: '250' },
  });
}, 120_000);

afterAll(async () => {
  // Orden de teardown load-bearing: matar el server (cierra su conexión pg en
  // LISTEN) ANTES de parar boss / dropear la BD, o el DROP DATABASE se bloquearía
  // por la conexión viva del subproceso.
  await server.stop();
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

describe('GET /api/runs/:id/events (SSE)', () => {
  it('sin cookie de sesión → 401 (withAuth)', async () => {
    const { runId } = await seedDemoRun();
    const res = await fetch(`${server.baseUrl}/api/runs/${runId}/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(401);
    // No es un stream: el 401 es JSON tipado, no text/event-stream.
    expect(res.headers.get('content-type')).not.toContain('text/event-stream');
    await res.body?.cancel();
  });

  it('snapshot al conectar → step_changed por transición real → heartbeat → reconexión con Last-Event-ID re-snapshotea el estado ACTUAL', async () => {
    const { runId, rootStepId } = await seedDemoRun();
    const url = `${server.baseUrl}/api/runs/${runId}/events`;
    const cookie = cookieHeader();

    // Conectar y disparar la transición SOLO tras recibir el snapshot: así se evita
    // la carrera conexión/NOTIFY (el NOTIFY sin LISTEN activo se perdería). timeoutMs
    // holgado: incluye la compilación en frío de la ruta (next dev) al primer hit.
    let fired = false;
    const events = await collectSse(url, {
      headers: { cookie },
      onEvent: (e) => {
        if (e.event === 'snapshot' && !fired) {
          fired = true;
          void transition({ withTransaction: withTx() }, rootStepId, 'start');
        }
      },
      until: (evs) =>
        evs.some((e) => e.event === 'step_changed') && evs.some((e) => e.event === 'heartbeat'),
      timeoutMs: 30_000,
    });

    // Todo frame válida contra el contrato de core (discriminated union Zod).
    for (const e of events) {
      expect(() => RunEventSchema.parse({ event: e.event, ...e.data })).not.toThrow();
    }

    // El PRIMER evento es SIEMPRE el snapshot, con los 3 steps del DAG de demo.
    expect(events[0]!.event).toBe('snapshot');
    const snapSteps = events[0]!.data.steps as { id: string; status: string }[];
    expect(snapSteps).toHaveLength(3);

    // El delta refleja la transición real: N0 pasó a running.
    const delta = events.find((e) => e.event === 'step_changed' && e.data.stepId === rootStepId);
    expect(delta).toBeDefined();
    expect(delta!.data).toMatchObject({ stepId: rootStepId, status: 'running' });

    // Se vio al menos un heartbeat (implica que el intervalo corre; su ausencia haría
    // saltar el timeoutMs del helper).
    expect(events.some((e) => e.event === 'heartbeat')).toBe(true);

    // id: monotónico (contrato §9.0): la secuencia de ids ya viene creciente.
    const ids = events.map((e) => Number(e.id));
    expect(ids.every((n) => Number.isFinite(n))).toBe(true);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);

    // Cambiar el estado MIENTRAS el cliente está desconectado: N0 running→succeeded.
    // Sin esta transición en la ventana de desconexión, la aserción de reconexión no
    // distinguiría un re-snapshot FRESCO de uno rancio (N0 ya estaba running antes del
    // corte). Con ella, ver `succeeded` tras reconectar PRUEBA que el re-snapshot
    // refleja el estado alcanzado durante el gap — la cláusula "sin perder el estado
    // final".
    const lastId = String(ids.at(-1));
    await transition({ withTransaction: withTx() }, rootStepId, 'succeed');

    // Reconexión con Last-Event-ID: re-snapshot del estado ACTUAL (N0=succeeded),
    // NUNCA replay de los deltas perdidos.
    const again = await collectSse(url, {
      headers: { cookie, 'last-event-id': lastId },
      until: (evs) => evs.length >= 1,
      timeoutMs: 30_000,
    });
    expect(again[0]!.event).toBe('snapshot');
    const againSteps = again[0]!.data.steps as { id: string; status: string }[];
    // El estado alcanzado durante la desconexión llega en el re-snapshot: no se
    // perdió el estado final.
    expect(againSteps.find((s) => s.id === rootStepId)!.status).toBe('succeeded');
    // Los ids del re-snapshot ARRANCAN por encima del Last-Event-ID (sembrado desde
    // el header): siguen siendo monotónicos entre reconexiones.
    expect(Number(again[0]!.id)).toBeGreaterThan(Number(lastId));
  }, 60_000);
});
