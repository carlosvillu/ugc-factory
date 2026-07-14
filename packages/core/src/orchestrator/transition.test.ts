// Test de `transition()` con puertos FAKE en memoria: verifica la ORQUESTACIÓN
// (validar → update → resolver deps → encolar → notify + rollback en ilegal) sin
// Postgres. La atomicidad REAL (rollback des-encola, FOR UPDATE, NOTIFY en
// commit) se prueba en integración (packages/db); aquí se prueba que el core
// llama a los puertos en el orden y las condiciones correctas.
import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  StepNotFoundError,
  transition,
  type TransitionDeps,
} from './transition';
import type { StepPatch, StepRow, TxStores } from './ports';
import type { StepEvent, StepStatus } from './transitions';

interface EnqueuedJob {
  name: string;
  payload: unknown;
  singletonKey?: string;
}

/**
 * Un mundo en memoria: filas de step + registros de efectos. `withTransaction`
 * ejecuta el callback y, si lanza, DESHACE los efectos (simula el rollback) para
 * que los tests puedan afirmar "cero efectos en ilegal".
 */
type StoredStep = StepRow & { startedAt?: Date; finishedAt?: Date | null };

function makeWorld(rows: StepRow[]) {
  const steps = new Map<string, StoredStep>(rows.map((r) => [r.id, { ...r }]));
  const enqueued: EnqueuedJob[] = [];
  const notified: string[] = [];
  // T1.20: qué steps/runs pidió recomputar la transición (el puerto CostStore). Aquí solo se
  // registra la LLAMADA — el SQL del rollup se prueba contra Postgres real (db/test/integration/
  // cost-rollup.test.ts). Lo que este nivel fija es el GATE: qué eventos liquidan el coste.
  const rolledSteps: string[] = [];
  const rolledRuns: string[] = [];

  const deps: TransitionDeps = {
    withTransaction: async (fn) => {
      // Snapshot para rollback.
      const snapshot = new Map([...steps].map(([k, v]) => [k, { ...v }]));
      const enqLen = enqueued.length;
      const notLen = notified.length;
      const rolledStepsLen = rolledSteps.length;
      const rolledRunsLen = rolledRuns.length;
      // Fakes SÍNCRONOS envueltos en Promise.resolve: no hay I/O, así que no hay
      // nada que `await` (evita require-await sin desactivarlo). Cumplen la firma
      // async de los puertos igual.
      const stores: TxStores = {
        steps: {
          findForUpdate: (id) => {
            const r = steps.get(id);
            return Promise.resolve(r ? { ...r } : null);
          },
          update: (id: string, patch: StepPatch) => {
            const r = steps.get(id);
            if (r) {
              const { incrementRetryCount, ...rest } = patch;
              Object.assign(r, rest);
              // Simula el `retry_count = retry_count + 1` atómico del adapter real.
              if (incrementRetryCount === true) r.retryCount += 1;
            }
            return Promise.resolve();
          },
          findDependents: (stepId) =>
            Promise.resolve(
              [...steps.values()]
                .filter((r) => r.dependsOn.includes(stepId))
                .sort((a, b) => (a.id < b.id ? -1 : 1))
                .map((r) => ({ ...r })),
            ),
          resolvedStatus: (ids) =>
            Promise.resolve(
              Object.fromEntries(
                ids.map((id) => {
                  const s = steps.get(id)?.status;
                  return [id, s === 'succeeded' || s === 'skipped'];
                }),
              ),
            ),
          findStepAndClosureForUpdate: () =>
            Promise.reject(
              new Error('findStepAndClosureForUpdate no debe usarse en transition() puro'),
            ),
          findCancellableByRun: () =>
            Promise.reject(new Error('findCancellableByRun no debe usarse en transition() puro')),
          insertSuperseding: () =>
            Promise.reject(new Error('insertSuperseding no debe usarse en transition() puro')),
        },
        jobs: {
          enqueue: (req) => {
            enqueued.push({
              name: req.job.name,
              payload: req.payload,
              singletonKey: req.singletonKey,
            });
            return Promise.resolve();
          },
        },
        events: {
          notify: (runId) => {
            notified.push(runId);
            return Promise.resolve();
          },
        },
        // `transition()` no usa `runs` (es de createRun), pero TxStores lo exige:
        // stubs que lanzan si se invocaran por error.
        runs: {
          insertRun: () =>
            Promise.reject(new Error('runs.insertRun no debe usarse en transition()')),
          insertSteps: () =>
            Promise.reject(new Error('runs.insertSteps no debe usarse en transition()')),
        },
        audit: {
          write: () => Promise.reject(new Error('audit.write no debe usarse en transition()')),
        },
        costs: {
          rollupStep: (stepId) => {
            rolledSteps.push(stepId);
            return Promise.resolve();
          },
          rollupRun: (runId) => {
            rolledRuns.push(runId);
            return Promise.resolve();
          },
        },
      };
      try {
        return await fn(stores);
      } catch (err) {
        // Rollback: restaurar filas y truncar efectos.
        steps.clear();
        for (const [k, v] of snapshot) steps.set(k, v);
        enqueued.length = enqLen;
        notified.length = notLen;
        rolledSteps.length = rolledStepsLen;
        rolledRuns.length = rolledRunsLen;
        throw err;
      }
    },
  };

  return { deps, steps, enqueued, notified, rolledSteps, rolledRuns };
}

function step(overrides: Partial<StepRow> & Pick<StepRow, 'id'>): StepRow {
  return {
    runId: 'run1',
    nodeKey: 'N0',
    status: 'pending',
    dependsOn: [],
    retryCount: 0,
    maxRetries: 3,
    config: null,
    isCheckpoint: false,
    checkpointConfig: null,
    outputRefs: null,
    ...overrides,
  };
}

describe('transition(): transición LEGAL', () => {
  it('pending --(enqueue)--> queued: aplica el UPDATE, ENCOLA el step y emite NOTIFY', async () => {
    const w = makeWorld([step({ id: 's1', status: 'pending', nodeKey: 'N0' })]);
    await transition(w.deps, 's1', 'enqueue');
    expect(w.steps.get('s1')?.status).toBe('queued');
    expect(w.notified).toEqual(['run1']);
    // Alcanzar `queued` crea el job del step (jobs.md §5): queued ⇒ en la cola.
    expect(w.enqueued).toHaveLength(1);
    expect(w.enqueued[0]).toMatchObject({
      name: 'step.execute',
      payload: { runId: 'run1', stepId: 's1', nodeKey: 'N0' },
      singletonKey: 'run1:N0',
    });
  });

  it('queued --(start)--> running: fija started_at', async () => {
    const w = makeWorld([step({ id: 's1', status: 'queued' })]);
    await transition(w.deps, 's1', 'start');
    const s = w.steps.get('s1');
    expect(s?.status).toBe('running');
    expect(s?.startedAt).toBeInstanceOf(Date);
  });

  it('running --(succeed)--> succeeded: fija finished_at', async () => {
    const w = makeWorld([step({ id: 's1', status: 'running' })]);
    await transition(w.deps, 's1', 'succeed');
    const s = w.steps.get('s1');
    expect(s?.status).toBe('succeeded');
    expect(s?.finishedAt).toBeInstanceOf(Date);
  });

  it('failed --(retry)--> queued: LIMPIA finished_at (null en el patch)', async () => {
    // El step llega a `failed` con un finished_at ya fijado (simulado): el retry
    // debe emitirlo como null en el patch. (El paso a NULL en la columna real lo
    // prueba el test de integración; aquí se prueba que el orquestador lo LIMPIA.)
    const w = makeWorld([step({ id: 's1', status: 'failed' })]);
    w.steps.get('s1')!.finishedAt = new Date();
    await transition(w.deps, 's1', 'retry');
    const s = w.steps.get('s1');
    expect(s?.status).toBe('queued');
    expect(s?.finishedAt).toBeNull();
  });
});

describe('transition(): resolución de depends_on aguas abajo (§7.1.a)', () => {
  it('al completar la última dep, el dependiente pasa awaiting_deps→queued y se ENCOLA', async () => {
    const w = makeWorld([
      step({ id: 'a', status: 'running' }),
      step({ id: 'b', status: 'awaiting_deps', nodeKey: 'N1', dependsOn: ['a'] }),
    ]);
    await transition(w.deps, 'a', 'succeed');
    expect(w.steps.get('a')?.status).toBe('succeeded');
    // El dependiente listo queda `queued` (no `pending`): §7.1 queued = en la cola.
    expect(w.steps.get('b')?.status).toBe('queued');
    expect(w.enqueued).toHaveLength(1);
    expect(w.enqueued[0]).toMatchObject({
      name: 'step.execute',
      payload: { runId: 'run1', stepId: 'b', nodeKey: 'N1' },
      singletonKey: 'run1:N1',
    });
  });

  it('con deps AÚN pendientes, el dependiente NO avanza ni se encola', async () => {
    const w = makeWorld([
      step({ id: 'a1', status: 'running' }),
      step({ id: 'a2', status: 'pending' }), // NO succeeded
      step({ id: 'b', status: 'awaiting_deps', dependsOn: ['a1', 'a2'] }),
    ]);
    await transition(w.deps, 'a1', 'succeed');
    expect(w.steps.get('b')?.status).toBe('awaiting_deps');
    expect(w.enqueued).toHaveLength(0);
  });
});

describe('transition(): transición ILEGAL → throw SIN efectos (rollback)', () => {
  it('succeeded --(start)--> ✗: lanza IllegalTransitionError, fila intacta, 0 enqueue, 0 notify', async () => {
    const w = makeWorld([step({ id: 's1', status: 'succeeded' })]);
    await expect(transition(w.deps, 's1', 'start')).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(w.steps.get('s1')?.status).toBe('succeeded'); // intacta
    expect(w.enqueued).toHaveLength(0);
    expect(w.notified).toHaveLength(0);
  });

  it('step inexistente → StepNotFoundError sin efectos', async () => {
    const w = makeWorld([]);
    await expect(transition(w.deps, 'missing', 'start')).rejects.toBeInstanceOf(StepNotFoundError);
    expect(w.notified).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// T1.20 — EL GATE DEL ROLLUP DEL COSTE: qué eventos LIQUIDAN el dinero del step.
//
// El fix de T1.20 no es "llamar al rollup en el fail": es meterlo en el EMBUDO ÚNICO
// (`applyTransition`) por el que pasan TODOS los cierres, para que ningún camino futuro
// pueda olvidarse. Esta tabla es esa garantía, machine-checked: recorre el conjunto COMPLETO
// de eventos de §7.1 desde el estado en que cada uno es legal y afirma si el rollup corrió.
// Un evento NUEVO en la máquina de estados rompe la exhaustividad de este mapa y obliga a
// decidir, conscientemente, si liquida coste o no.
// ─────────────────────────────────────────────────────────────────────────────────────────
describe('transition(): rollup del coste real (T1.20) — todos los caminos de cierre', () => {
  // [evento, estado desde el que es legal, ¿debe liquidar el coste?]
  const EVENTS: [StepEvent, StepStatus, boolean][] = [
    // NO liquidan: el trabajo no ha terminado (o se está reabriendo).
    ['deps_satisfied', 'awaiting_deps', false],
    ['enqueue', 'pending', false],
    ['start', 'queued', false],
    ['retry', 'failed', false], // REABRE el trabajo; el siguiente cierre recomputará
    // Liquidan: el gasto del step ya está en el ledger y el step no vuelve a trabajar…
    ['succeed', 'running', true],
    ['fail', 'running', true], // ← EL BUG DE T1.20: gastó y murió, y la columna decía NULL
    ['expire', 'running', true], // sweeper (T0.9)
    ['skip_inapplicable', 'running', true], // auto-skip (T1.10a)
    ['cancel', 'running', true],
    ['supersede', 'running', true],
    ['approve', 'waiting_approval', true],
    ['approve_edited', 'waiting_approval', true],
    ['reject', 'waiting_approval', true],
    ['skip', 'pending', true],
    // …Y el que NO es terminal pero SÍ liquida: un checkpoint real hace su trabajo y LO PAGA
    // antes de pausar. Si no se liquidara aquí, el nodo mostraría $0,00 durante toda la
    // ventana de aprobación (lo que tarde el humano) con el dinero ya gastado.
    ['reach_checkpoint', 'running', true],
  ];

  for (const [event, from, settles] of EVENTS) {
    it(`${from} --(${event})--> ${settles ? 'RECOMPUTA' : 'no toca'} el coste`, async () => {
      const w = makeWorld([step({ id: 's1', status: from, maxRetries: 5 })]);
      await transition(w.deps, 's1', event);
      expect(w.rolledSteps).toEqual(settles ? ['s1'] : []);
      // El AGREGADO del run se recomputa en el mismo sitio y en la misma tx: si el step
      // liquida, `pipeline_run.total_cost_actual` también (T1.20).
      expect(w.rolledRuns).toEqual(settles ? ['run1'] : []);
    });
  }

  it('una transición ILEGAL no recomputa nada (rollback total: tampoco el coste)', async () => {
    const w = makeWorld([step({ id: 's1', status: 'succeeded' })]);
    await expect(transition(w.deps, 's1', 'fail')).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(w.rolledSteps).toHaveLength(0);
    expect(w.rolledRuns).toHaveLength(0);
  });
});
