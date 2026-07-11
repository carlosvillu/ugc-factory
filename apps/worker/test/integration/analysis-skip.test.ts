// La propiedad que da sentido a T1.10a, como REGRESIÓN PERMANENTE (T1.9 nos enseñó a
// no fiarnos de un fixture cómodo): un nodo que se autodeclara INAPLICABLE termina en
// `skipped` de verdad —en la BD, vía la máquina de estados real— y su dependiente
// AVANZA igual. Es el camino de "texto libre sin imágenes" del PRD (§7.1: "skipped
// (nodo no aplicable, p. ej. N2 sin imágenes)"; §7.2, ficha de N2).
//
// Se prueba contra Postgres 16 real (Testcontainers) + pg-boss real + el consumer
// GENÉRICO real (registerStepConsumer) + `transition()` real. Lo ÚNICO simulado son los
// executors: stubs que llaman a `markInapplicable()` / `collectOutput()` igual que los
// reales, para no tocar la red ni gastar dinero. Así lo que se verifica es el MECANISMO
// (consumer → skip_inapplicable → skipped → resolveDownstream), que es justo lo que
// podría romperse en silencio.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeLogger } from '@ugc/core/observability';
import { createRun, PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor, TransitionDeps } from '@ugc/core/orchestrator';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase, makeProject } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { createDbPool, ensureQueue, makeWithTransaction } from '@ugc/db';
import { project } from '@ugc/db/schema';
import { PgBoss } from 'pg-boss';
import { registerStepConsumer } from '../../src/consumers/step-execute';
import { waitFor } from '../helpers';

const silentLogger = makeLogger({ name: 'worker', level: 'silent' });

let tdb: TestDatabase;

interface StepRowLite {
  nodeKey: string;
  status: string;
  outputRefs: unknown;
  finishedAt: Date | null;
  retryCount: number;
}

async function fetchSteps(runId: string): Promise<StepRowLite[]> {
  const { rows } = await tdb.pool.query<{
    node_key: string;
    status: string;
    output_refs: unknown;
    finished_at: Date | null;
    retry_count: string;
  }>(
    `SELECT node_key, status, output_refs, finished_at, retry_count FROM step_run WHERE run_id = $1`,
    [runId],
  );
  return rows.map((r) => ({
    nodeKey: r.node_key,
    status: r.status,
    outputRefs: r.output_refs,
    finishedAt: r.finished_at,
    retryCount: Number(r.retry_count),
  }));
}

async function seedProject(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  return p!.id;
}

/** Para el boss y ESPERA a que suelte sus conexiones (si no, el DROP de la BD da 57P01). */
async function stopBossAndWait(b: PgBoss): Promise<void> {
  const stopped = new Promise<void>((resolve) =>
    b.once('stopped', () => {
      resolve();
    }),
  );
  await b.stop({ graceful: false });
  await stopped;
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:analysis-skip' });
  const seedBoss = new PgBoss(tdb.connectionString);
  seedBoss.on('error', () => {
    /* irrelevante */
  });
  await seedBoss.start();
  await stopBossAndWait(seedBoss);
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project CASCADE');
  await tdb.pool.query(`DELETE FROM pgboss.job WHERE name = $1`, [stepExecuteJob.name]);
});

/** Un worker real (boss + consumer genérico) con los executors que le pasemos. */
async function startWorkerWith(executors: Record<string, StepExecutor>): Promise<{
  deps: TransitionDeps;
  cleanup: () => Promise<void>;
}> {
  const boss = new PgBoss(tdb.connectionString);
  boss.on('error', () => {
    /* irrelevante para estos asserts */
  });
  await boss.start();
  await ensureQueue(boss, stepExecuteJob);
  const { db, pool } = createDbPool(tdb.connectionString);
  const deps: TransitionDeps = { withTransaction: makeWithTransaction(db, boss) };
  await registerStepConsumer({ boss, db, transitionDeps: deps, executors, logger: silentLogger });
  return {
    deps,
    cleanup: async () => {
      await stopBossAndWait(boss);
      await pool.end();
    },
  };
}

describe('resolución de deps por ULID (T1.10a): inmune al supersede de un checkpoint', () => {
  // EL BUG QUE ESTO IMPIDE (latente hasta que T1.10b cablee CP1): resolver la dependencia
  // buscando `steps.find(s => s.nodeKey === 'N1')` entre los steps del run es INCORRECTO,
  // porque `node_key` NO identifica una fila. Cuando el usuario edita un brief en un
  // checkpoint, la invalidación (T0.8, `insertSuperseding`) crea una fila NUEVA con el MISMO
  // `node_key` que la que supersede. La query no tiene ORDER BY ⇒ `find` devolvería una AL
  // AZAR, y el nodo dependiente podría sintetizar sobre el artefacto VIEJO (el de la fila
  // `superseded`) sin lanzar un solo error. Silencioso y carísimo de diagnosticar.
  //
  // El fix: el consumer resuelve las deps por los ULIDs EXACTOS de `dependsOn` (que el
  // supersede REMAPEA) y se las entrega al executor. Este test lo fija: se planta en el run
  // una fila `superseded` con el MISMO node_key y un output VIEJO, y se comprueba que el
  // dependiente lee el output VIGENTE — el que su `dependsOn` señala.

  it('con DOS steps de node_key N1 (uno superseded), el dependiente lee el VIGENTE', async () => {
    let visto: unknown;
    // N1 tarda un poco: da margen a plantar la fila impostora ANTES de que N2 arranque (si
    // se plantara después de que N2 leyera sus deps, el test no probaría nada).
    const n1: StepExecutor = async ({ collectOutput }) => {
      await new Promise((r) => setTimeout(r, 1_500));
      collectOutput?.({ marca: 'VIGENTE' });
    };
    const n2: StepExecutor = async ({ deps, collectOutput }) => {
      // El executor ya NO busca por node_key ni toca la BD: consume lo que el consumer le
      // entregó, resuelto por ULID.
      visto = deps?.find((d) => d.nodeKey === 'N1')?.outputRefs;
      collectOutput?.({ ok: true });
      await Promise.resolve();
    };

    const { deps, cleanup } = await startWorkerWith({ N1: n1, N2: n2 });
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [
          { key: 'N1', nodeKey: 'N1', dependsOn: [], config: {} },
          { key: 'N2', nodeKey: 'N2', dependsOn: ['N1'], config: {} },
        ],
      });

      // Plantamos la fila IMPOSTORA mientras N1 sigue trabajando: mismo run, MISMO node_key,
      // estado `superseded` y un output VIEJO. Es exactamente lo que deja `insertSuperseding`
      // tras editar un checkpoint. Si el executor resolviera por node_key, podría leer ESTA.
      await tdb.pool.query(
        `INSERT INTO step_run (id, run_id, node_key, status, depends_on, output_refs, retry_count, max_retries)
         VALUES ($1, $2, 'N1', 'superseded', '{}'::text[], $3::jsonb, 0, 3)`,
        [
          '01JZZZZZZZZZZZZZZZZZZZZZZZ', // ULID cualquiera, distinto del de N1
          runId,
          JSON.stringify({ marca: 'VIEJO_SUPERSEDED' }),
        ],
      );

      // Ahora sí: N2 arranca (su dep ya está satisfecha) y lee su dependencia.
      await waitFor(
        async () =>
          (await fetchSteps(runId)).find((s) => s.nodeKey === 'N2')?.status === 'succeeded',
        30_000,
        'N2 succeeded',
        50,
      );

      // LO QUE IMPORTA: leyó el VIGENTE (el que su `dependsOn` apunta), no el superseded.
      expect(visto).toEqual({ marca: 'VIGENTE' });
    } finally {
      await cleanup();
    }
  }, 60_000);
});

describe('fallo PERMANENTE (T1.10a): un error determinista NO quema reintentos de PAGO', () => {
  // El bug que esto impide: N3 (Sonnet 5, ~$0,20/llamada) lanza cuando la síntesis sale
  // `refused`/`parse_error` o cuando el brief no pasa la validación determinista de T1.9.
  // Si eso fuera un throw normal, `failStep` lo reintentaría hasta agotar `max_retries`
  // (3 vueltas) — y como el fallo es DETERMINISTA sobre el mismo RawContent, las 3 vueltas
  // fallan igual, pagando 3 veces (~$0,60) para acabar en `failed` de todos modos.
  //
  // `PermanentStepError` hace que el consumer lo lleve a `failed` TERMINAL sin retry. El
  // assert que lo fija es el CONTADOR de ejecuciones del executor: si vuelve a valer 1
  // tras reintroducir el retry, este test se pone rojo.

  it('un PermanentStepError ejecuta el nodo UNA sola vez y lo deja failed terminal', async () => {
    let calls = 0;
    const n1: StepExecutor = async ({ collectOutput }) => {
      calls += 1;
      // Simula lo que hace N3 ante un refusal del modelo (o un ok:false del validador):
      // el trabajo de PAGO ya se hizo, y el resultado es irreparable.
      collectOutput?.({ nada: true });
      await Promise.resolve();
      throw new PermanentStepError('N3: la síntesis no produjo brief (status=refused)');
    };

    const { deps, cleanup } = await startWorkerWith({ N1: n1 });
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [{ key: 'N1', nodeKey: 'N1', dependsOn: [], config: {} }],
      });

      await waitFor(
        async () => (await fetchSteps(runId))[0]?.status === 'failed',
        30_000,
        'el step en failed',
        100,
      );

      // Margen para que un eventual retry se materializara (el re-encolado es inmediato).
      await new Promise((r) => setTimeout(r, 1_500));

      const [s] = await fetchSteps(runId);
      expect(s!.status).toBe('failed');
      // LO QUE IMPORTA: UNA sola ejecución. Con `failStep` habrían sido 1 + max_retries.
      expect(calls).toBe(1);
      // Y no se consumió ningún intento: el step no pasó por el gate de retry.
      expect(s!.retryCount).toBe(0);
    } finally {
      await cleanup();
    }
  }, 60_000);

  it('un error NORMAL (transitorio) SÍ se reintenta: el contraste que prueba que el gate sigue vivo', async () => {
    // Sin este contrapunto, un consumer que NUNCA reintentara nada pasaría el test de
    // arriba. Un fallo transitorio (timeout de red, 5xx del proveedor) DEBE seguir
    // reintentándose: otra vuelta tiene una posibilidad real de ir bien.
    let calls = 0;
    const n1: StepExecutor = async () => {
      calls += 1;
      await Promise.resolve();
      throw new Error('timeout de red hablando con el proveedor');
    };

    const { deps, cleanup } = await startWorkerWith({ N1: n1 });
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [{ key: 'N1', nodeKey: 'N1', dependsOn: [], config: {} }],
      });

      await waitFor(
        async () => {
          const [s] = await fetchSteps(runId);
          return s?.status === 'failed' && s.retryCount >= 1;
        },
        30_000,
        'el step failed TRAS agotar reintentos',
        100,
      );

      const [s] = await fetchSteps(runId);
      expect(s!.status).toBe('failed');
      // Se reintentó: más de una ejecución y retry_count consumido.
      expect(calls).toBeGreaterThan(1);
      expect(s!.retryCount).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  }, 60_000);
});

describe('auto-skip del nodo inaplicable (T1.10a): N2 sin imágenes → skipped, y N3 avanza', () => {
  it('markInapplicable() lleva el step a `skipped` (no a succeeded) y el dependiente CORRE', async () => {
    // N1 produce contenido SIN imágenes; N2 lo mira, se declara inaplicable y se salta;
    // N3 debe ejecutarse igualmente (skipped satisface la dep, T0.8) y terminar el run.
    let n3Ran = false;

    const n1: StepExecutor = async ({ collectOutput }) => {
      collectOutput?.({ images: [] }); // sin imágenes: el caso del PRD
      await Promise.resolve();
    };
    // El stub replica EXACTAMENTE lo que hace el N2 real cuando no hay visuales:
    // deja el motivo en output_refs y se declara inaplicable. No lanza (no es un fallo).
    const n2: StepExecutor = async ({ collectOutput, markInapplicable }) => {
      collectOutput?.({ skipped: true, reason: 'no_analyzable_visuals' });
      markInapplicable?.();
      await Promise.resolve();
    };
    const n3: StepExecutor = async ({ collectOutput }) => {
      n3Ran = true;
      collectOutput?.({ brief: { ok: true } });
      await Promise.resolve();
    };

    const { deps, cleanup } = await startWorkerWith({ N1: n1, N2: n2, N3: n3 });
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [
          { key: 'N1', nodeKey: 'N1', dependsOn: [], config: {} },
          { key: 'N2', nodeKey: 'N2', dependsOn: ['N1'] },
          { key: 'N3', nodeKey: 'N3', dependsOn: ['N2'], config: {} },
        ],
      });

      await waitFor(
        async () => {
          const steps = await fetchSteps(runId);
          return steps.find((s) => s.nodeKey === 'N3')?.status === 'succeeded';
        },
        30_000,
        'N3 succeeded (el run completa pese al nodo saltado)',
        100,
      );

      const steps = await fetchSteps(runId);
      const byKey = Object.fromEntries(steps.map((s) => [s.nodeKey, s]));

      // LO QUE IMPORTA: N2 está `skipped` — ni `succeeded` (no hizo el trabajo) ni
      // `failed` (no es un error). Es el estado que la Verificación mira en el grafo.
      expect(byKey.N2?.status).toBe('skipped');
      expect(byKey.N1?.status).toBe('succeeded');
      // Y el dependiente NO se quedó varado en awaiting_deps: corrió de verdad.
      expect(byKey.N3?.status).toBe('succeeded');
      expect(n3Ran).toBe(true);

      // El motivo del skip queda persistido (el panel explica POR QUÉ, no un hueco).
      expect(byKey.N2?.outputRefs).toEqual({ skipped: true, reason: 'no_analyzable_visuals' });
      // `skipped` es terminal: lleva finished_at como cualquier otro cierre.
      expect(byKey.N2?.finishedAt).not.toBeNull();
    } finally {
      await cleanup();
    }
  }, 60_000);

  it('con imágenes, N2 NO se salta: hace su trabajo y queda `succeeded` con su output', async () => {
    // El contrapunto: el mismo mecanismo NO se dispara cuando sí hay algo que analizar.
    // Sin este test, un `markInapplicable()` incondicional pasaría el test de arriba.
    const n1: StepExecutor = async ({ collectOutput }) => {
      collectOutput?.({ images: ['https://cdn.example.com/a.jpg'] });
      await Promise.resolve();
    };
    const n2: StepExecutor = async ({ collectOutput }) => {
      collectOutput?.({ visualAnalysis: { palette: ['#000'] }, status: 'analyzed' });
      await Promise.resolve();
    };
    const n3: StepExecutor = async () => {
      await Promise.resolve();
    };

    const { deps, cleanup } = await startWorkerWith({ N1: n1, N2: n2, N3: n3 });
    try {
      const projectId = await seedProject();
      const { runId } = await createRun(deps, {
        projectId,
        nodes: [
          { key: 'N1', nodeKey: 'N1', dependsOn: [], config: {} },
          { key: 'N2', nodeKey: 'N2', dependsOn: ['N1'] },
          { key: 'N3', nodeKey: 'N3', dependsOn: ['N2'], config: {} },
        ],
      });

      await waitFor(
        async () => {
          const steps = await fetchSteps(runId);
          return steps.find((s) => s.nodeKey === 'N3')?.status === 'succeeded';
        },
        30_000,
        'N3 succeeded',
        100,
      );

      const steps = await fetchSteps(runId);
      const byKey = Object.fromEntries(steps.map((s) => [s.nodeKey, s]));
      expect(byKey.N2?.status).toBe('succeeded');
      expect(byKey.N2?.outputRefs).toMatchObject({ status: 'analyzed' });
    } finally {
      await cleanup();
    }
  }, 60_000);
});
