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

  const deps: TransitionDeps = {
    withTransaction: async (fn) => {
      // Snapshot para rollback.
      const snapshot = new Map([...steps].map(([k, v]) => [k, { ...v }]));
      const enqLen = enqueued.length;
      const notLen = notified.length;
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
          succeededStatus: (ids) =>
            Promise.resolve(
              Object.fromEntries(ids.map((id) => [id, steps.get(id)?.status === 'succeeded'])),
            ),
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
      };
      try {
        return await fn(stores);
      } catch (err) {
        // Rollback: restaurar filas y truncar efectos.
        steps.clear();
        for (const [k, v] of snapshot) steps.set(k, v);
        enqueued.length = enqLen;
        notified.length = notLen;
        throw err;
      }
    },
  };

  return { deps, steps, enqueued, notified };
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
