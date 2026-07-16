// Unit de `sweepStuckGenerations` (T4.3): la lógica del 2º paso del tick del sweeper. Con dobles.
// Prueba lo que el sweeper del worker NO puede (eso es integración): que el barrido llama a
// `reconcileGeneration` por fila, tallya cada outcome, NO deja que el fallo de una fila tumbe el
// resto, que dos ticks DENTRO del deadline de descarga NO encolan dos veces (backoff por deadline),
// y que una fila in_progress colgada PASADO el deadline SÍ se re-encola (recuperación del agujero negro).
import { describe, expect, it } from 'vitest';
import { makeLogger } from '../observability';
import { sweepStuckGenerations, type SweepableGenerationRow } from './sweep-generations';
import { FalResponseError, type FalStatusCheck } from './fal-client';

const silent = makeLogger({ name: 'worker', level: 'silent' });
const T0 = new Date('2026-07-16T10:00:00.000Z');

function row(overrides: Partial<SweepableGenerationRow> = {}): SweepableGenerationRow {
  return {
    id: '01ROW00000000000000000000AA',
    status: 'submitted',
    falRequestId: 'req-1',
    statusUrl: 'https://queue.fal.run/fal-ai/flux-2/requests/req-1/status',
    responseUrl: 'https://queue.fal.run/fal-ai/flux-2/requests/req-1',
    createdAt: T0,
    startedAt: T0,
    updatedAt: T0,
    modelProfileId: 'mp-flux',
    ...overrides,
  };
}

const COMPLETED: FalStatusCheck = {
  state: 'completed',
  output: { images: [{ url: 'https://fal.media/x.png' }] },
  statusPayload: {},
};

describe('sweepStuckGenerations', () => {
  it('reconcilia cada fila listada y tallya el outcome', async () => {
    const enqueued: string[] = [];
    const res = await sweepStuckGenerations({
      listReconcilable: () =>
        Promise.resolve([
          row({ id: 'A' }),
          row({
            id: 'B',
            status: 'submitting',
            falRequestId: null,
            statusUrl: null,
            responseUrl: null,
          }),
        ]),
      // A (submitted) → COMPLETED → enqueue. B (submitting joven) → noop.
      checkStatus: () => Promise.resolve(COMPLETED),
      updateGeneration: () => Promise.resolve(true),
      enqueueDownload: (id) => {
        enqueued.push(id);
        return Promise.resolve();
      },
      now: () => T0.getTime(),
      logger: silent,
    });
    expect(res.enqueued).toBe(1);
    expect(res.noop).toBe(1);
    expect(enqueued).toEqual(['A']);
  });

  it('el fallo de UNA fila (contrato roto → FalResponseError propaga) NO tumba el barrido: errored++ y sigue', async () => {
    const enqueued: string[] = [];
    let call = 0;
    const res = await sweepStuckGenerations({
      listReconcilable: () => Promise.resolve([row({ id: 'A' }), row({ id: 'B' })]),
      checkStatus: () => {
        call += 1;
        // Un FalResponseError (contrato roto de fal) es lo que reconcile PROPAGA (una rama transitoria
        // como 429/timeout sería un noop, no un errored). El sweep lo captura por fila y continúa.
        if (call === 1) return Promise.reject(new FalResponseError('status desconocido')); // 1ª peta
        return Promise.resolve(COMPLETED); // la 2ª reconcilia bien
      },
      updateGeneration: () => Promise.resolve(true),
      enqueueDownload: (id) => {
        enqueued.push(id);
        return Promise.resolve();
      },
      now: () => T0.getTime(),
      logger: silent,
    });
    expect(res.errored).toBe(1);
    expect(res.enqueued).toBe(1);
    expect(enqueued).toEqual(['B']); // la 2ª se procesó pese al fallo de la 1ª
  });

  it('DOS ticks DENTRO del deadline de descarga NO encolan dos veces: tras el 1º la fila queda in_progress y el 2º es no-op por deadline', async () => {
    // El listado simula el repo REAL: `in_progress` SÍ se lista (recuperable). El backoff lo da el
    // deadline de descarga: tras el tick 1 la fila queda in_progress con `updatedAt` fresco; el tick 2
    // la lista, pero como lleva 0 ms en in_progress (< inProgressMs) → no-op, NO re-encola. Un mapa de
    // estado + updatedAt compartido entre ticks.
    const state = new Map<string, { status: string; updatedAt: Date }>([
      ['A', { status: 'submitted', updatedAt: T0 }],
    ]);
    const enqueued: string[] = [];
    const deps = {
      // Lista lo que el repo real (incl. in_progress); terminales fuera.
      listReconcilable: (): Promise<SweepableGenerationRow[]> =>
        Promise.resolve(
          [...state.entries()]
            .filter(([, s]) =>
              ['submitted', 'in_queue', 'submitting', 'in_progress'].includes(s.status),
            )
            .map(([id, s]) => row({ id, status: s.status, updatedAt: s.updatedAt })),
        ),
      checkStatus: (): Promise<FalStatusCheck> => Promise.resolve(COMPLETED),
      updateGeneration: (
        id: string,
        patch: { status?: string },
        fromStatuses: readonly string[],
      ): Promise<boolean> => {
        // Claim condicional simulado: solo aplica si la fila SIGUE en fromStatuses; refresca updatedAt.
        const current = state.get(id);
        if (current === undefined || !fromStatuses.includes(current.status)) {
          return Promise.resolve(false);
        }
        state.set(id, {
          status: patch.status ?? current.status,
          updatedAt: new Date(T0.getTime()),
        });
        return Promise.resolve(true);
      },
      enqueueDownload: (id: string): Promise<void> => {
        enqueued.push(id);
        return Promise.resolve();
      },
      now: () => T0.getTime(),
      logger: silent,
    };

    await sweepStuckGenerations(deps); // tick 1: A submitted → in_progress + encola
    await sweepStuckGenerations(deps); // tick 2: A ya in_progress dentro del deadline → no re-encola

    expect(enqueued).toEqual(['A']); // UNA sola vez, no dos
    expect(state.get('A')?.status).toBe('in_progress');
  });

  it('RECUPERACIÓN del agujero negro: una fila in_progress colgada PASADO el deadline de descarga se RE-ENCOLA', async () => {
    // La descarga se perdió (enqueue fallido / job agotado): la fila lleva > inProgressMs en
    // in_progress. El sweep la re-lista (in_progress es reconcilable) y RE-ENCOLA la descarga.
    const enqueued: string[] = [];
    // updatedAt muy en el pasado (25 min) → supera inProgressMs (20 min) pero no maxAge (2 h).
    const stale = new Date(T0.getTime() - 25 * 60_000);
    const res = await sweepStuckGenerations({
      listReconcilable: () =>
        Promise.resolve([row({ id: 'STUCK', status: 'in_progress', updatedAt: stale })]),
      checkStatus: () => Promise.resolve(COMPLETED),
      updateGeneration: () => Promise.resolve(true),
      enqueueDownload: (id) => {
        enqueued.push(id);
        return Promise.resolve();
      },
      now: () => T0.getTime(),
      logger: silent,
    });
    expect(res.enqueued).toBe(1); // el re_enqueued_download cuenta como enqueued
    expect(enqueued).toEqual(['STUCK']);
  });

  it('lista vacía → resultado en cero, sin lanzar', async () => {
    const res = await sweepStuckGenerations({
      listReconcilable: () => Promise.resolve([]),
      checkStatus: () => Promise.resolve(COMPLETED),
      updateGeneration: () => Promise.resolve(true),
      enqueueDownload: () => Promise.resolve(),
      logger: silent,
    });
    expect(res).toEqual({ enqueued: 0, expired: 0, stillProcessing: 0, noop: 0, errored: 0 });
  });
});
