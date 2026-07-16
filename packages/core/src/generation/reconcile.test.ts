// Unit de `reconcileGeneration` (T4.3, §6.3.9, §9.6): la primitiva de resume-sin-resubmit. Con
// DOBLES inyectados que emiten lo que fal REAL emitiría (principio 9: la forma de `checkStatus` la
// dicta `fal-client.ts`, no lo que conviene al test). Cubre CADA rama de la máquina de decisión:
//   · submitted → COMPLETED → persiste payload webhook-shaped + in_progress + encola → enqueued_download
//   · submitted → processing → dentro de deadline → still_processing (no-op, no encola)
//   · submitted → processing → colgada > deadline por tipo → expired (failed, sin re-submit)
//   · submitted → fal FAILED → expired (failed inmediato, terminal)
//   · submitting sin request_id → dentro de edad → noop; superada la edad → expired (sin re-submit)
//   · completed/failed/cancelled → noop; in_progress → sub-lógica de recuperación por deadline de descarga
// INVARIANTE DINERO: reconcile NUNCA re-submitea (no hay dep de submit; el doble solo tiene
// checkStatus/update/enqueue). Y dos reconciliaciones seguidas de una COMPLETED NO encolan dos veces
// (el 2º pasa por `in_progress` = noop): se prueba explícitamente.
import { describe, expect, it, vi } from 'vitest';
import { makeLogger } from '../observability';
import { reconcileGeneration, type ReconcilableGeneration, type ReconcileDeps } from './reconcile';
import { FalProviderError, FalResponseError, type FalStatusCheck } from './fal-client';

const silent = makeLogger({ name: 'worker', level: 'silent' });

const T0 = new Date('2026-07-16T10:00:00.000Z');
const nowAt = (d: Date) => (): number => d.getTime();

/** Una fila `submitted` con URLs guardadas (el camino pollable), imagen. */
function submittedGen(overrides: Partial<ReconcilableGeneration> = {}): ReconcilableGeneration {
  return {
    id: '01SUBMITTED0000000000000000',
    status: 'submitted',
    falRequestId: 'req-abc',
    statusUrl: 'https://queue.fal.run/fal-ai/flux-2/requests/req-abc/status',
    responseUrl: 'https://queue.fal.run/fal-ai/flux-2/requests/req-abc',
    createdAt: T0,
    startedAt: T0,
    updatedAt: T0,
    kind: 'image',
    ...overrides,
  };
}

/** Deps con dobles; `checkStatus` devuelve lo que se le pase, `update`/`enqueue` son spies. */
function makeDeps(
  check: FalStatusCheck | (() => Promise<FalStatusCheck>),
  now = nowAt(T0),
): {
  deps: ReconcileDeps;
  updates: {
    id: string;
    patch: { status?: string; falStatusPayload?: unknown; completedAt?: Date };
  }[];
  enqueued: string[];
  checkStatus: ReturnType<typeof vi.fn>;
} {
  const updates: {
    id: string;
    patch: { status?: string; falStatusPayload?: unknown; completedAt?: Date };
  }[] = [];
  const enqueued: string[] = [];
  const checkStatus = vi.fn(() => (typeof check === 'function' ? check() : Promise.resolve(check)));
  const deps: ReconcileDeps = {
    checkStatus,
    updateGeneration: (id, patch) => {
      updates.push({ id, patch });
      // El claim toma efecto por defecto (la fila sigue reconciliable); los tests de carrera pasan
      // su propio doble que devuelve `false`.
      return Promise.resolve(true);
    },
    enqueueDownload: (id) => {
      enqueued.push(id);
      return Promise.resolve();
    },
    now,
    logger: silent,
  };
  return { deps, updates, enqueued, checkStatus };
}

describe('reconcileGeneration — COMPLETED en fal', () => {
  it('persiste el output en forma WEBHOOK-COMPATIBLE, marca in_progress y ENCOLA la descarga', async () => {
    const output = { images: [{ url: 'https://fal.media/out.png', width: 1024, height: 1024 }] };
    const { deps, updates, enqueued } = makeDeps({
      state: 'completed',
      output,
      statusPayload: { status: 'COMPLETED' },
    });
    const res = await reconcileGeneration(deps, submittedGen());

    expect(res.outcome).toBe('enqueued_download');
    // El payload persistido tiene la forma que el consumer output.download lee (FalWebhookPayloadSchema):
    // { status:'OK', payload:<output>, request_id }. Sin esto, el consumer no encontraría el output.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.patch.status).toBe('in_progress');
    expect(updates[0]!.patch.falStatusPayload).toEqual({
      request_id: 'req-abc',
      status: 'OK',
      payload: output,
      error: null,
    });
    // La descarga se encola DESPUÉS de persistir (el consumer siempre encuentra el output al releer).
    expect(enqueued).toEqual(['01SUBMITTED0000000000000000']);
  });

  it('NUNCA re-submitea: no hay dep de submit y solo se llama checkStatus + update + enqueue', async () => {
    const { deps, checkStatus } = makeDeps({
      state: 'completed',
      output: { images: [{ url: 'https://fal.media/out.png' }] },
      statusPayload: {},
    });
    await reconcileGeneration(deps, submittedGen());
    // checkStatus pollea el status_url GUARDADO (no reconstruido).
    expect(checkStatus).toHaveBeenCalledWith({
      statusUrl: submittedGen().statusUrl,
      responseUrl: submittedGen().responseUrl,
    });
  });

  it('IDEMPOTENCIA: una 2ª reconciliación de la MISMA generación (ya in_progress) es NO-OP, NO re-encola', async () => {
    // 1ª pasada: submitted → COMPLETED → in_progress + encola.
    const output = { images: [{ url: 'https://fal.media/out.png' }] };
    const first = makeDeps({ state: 'completed', output, statusPayload: {} });
    await reconcileGeneration(first.deps, submittedGen());
    expect(first.enqueued).toHaveLength(1);

    // 2ª pasada: la fila ya está in_progress (descarga encolada). NO debe pollear ni re-encolar.
    const second = makeDeps({ state: 'completed', output, statusPayload: {} });
    const res = await reconcileGeneration(second.deps, submittedGen({ status: 'in_progress' }));
    expect(res.outcome).toBe('noop');
    expect(second.enqueued).toEqual([]);
    expect(second.checkStatus).not.toHaveBeenCalled();
  });

  it('CARRERA anti-doble-cobro: si el claim NO toma efecto (otro actor ya completó la fila), NO se encola', async () => {
    // La fila se listó como `submitted`, pero entre el listado y el write el webhook + su descarga la
    // llevaron a `completed` (y escribieron su cost_entry). El claim condicional devuelve `false` → NO
    // se encola una 2ª descarga (que produciría un 2º cost_entry pese al FOR UPDATE). Es el bug que el
    // `updateGeneration` incondicional tendría: regresar `completed`→`in_progress` y re-encolar.
    const updates: { id: string; patch: unknown }[] = [];
    const enqueued: string[] = [];
    const res = await reconcileGeneration(
      {
        checkStatus: () =>
          Promise.resolve({
            state: 'completed',
            output: { images: [{ url: 'https://fal.media/out.png' }] },
            statusPayload: {},
          }),
        // El claim FALLA: la fila ya no está reconciliable (otro actor la completó).
        updateGeneration: (id, patch) => {
          updates.push({ id, patch });
          return Promise.resolve(false);
        },
        enqueueDownload: (id) => {
          enqueued.push(id);
          return Promise.resolve();
        },
        now: nowAt(T0),
        logger: silent,
      },
      submittedGen(),
    );
    expect(res.outcome).toBe('noop');
    // Se INTENTÓ el claim (condicional), pero como no tomó efecto NO se encoló NADA.
    expect(updates).toHaveLength(1);
    expect(enqueued).toEqual([]);
  });
});

describe('reconcileGeneration — sigue procesando en fal', () => {
  it('dentro del deadline por tipo → still_processing (no-op: NO encola, NO expira)', async () => {
    const { deps, updates, enqueued } = makeDeps({ state: 'processing', statusPayload: {} });
    const res = await reconcileGeneration(deps, submittedGen());
    expect(res.outcome).toBe('still_processing');
    expect(updates).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it('colgada MÁS que el deadline de imagen → expired (failed), NUNCA re-submit', async () => {
    // startedAt = T0; now = T0 + 11 min > deadline imagen (10 min).
    const now = nowAt(new Date(T0.getTime() + 11 * 60_000));
    const { deps, updates, enqueued } = makeDeps({ state: 'processing', statusPayload: {} }, now);
    const res = await reconcileGeneration(deps, submittedGen());
    expect(res.outcome).toBe('expired');
    expect(updates[0]!.patch.status).toBe('failed');
    expect(enqueued).toEqual([]);
  });

  it('el deadline es POR TIPO: una generación de vídeo aguanta más que una de imagen en el mismo punto', async () => {
    // now = T0 + 11 min. Imagen (deadline 10 min) EXPIRA; vídeo (deadline 30 min) sigue processing.
    const now = nowAt(new Date(T0.getTime() + 11 * 60_000));
    const image = makeDeps({ state: 'processing', statusPayload: {} }, now);
    expect((await reconcileGeneration(image.deps, submittedGen({ kind: 'image' }))).outcome).toBe(
      'expired',
    );
    const video = makeDeps({ state: 'processing', statusPayload: {} }, now);
    expect((await reconcileGeneration(video.deps, submittedGen({ kind: 'video' }))).outcome).toBe(
      'still_processing',
    );
  });
});

describe('reconcileGeneration — fal reportó FAILED', () => {
  it('un FAILED terminal de fal expira la fila INMEDIATAMENTE (sin esperar deadline), sin re-submit', async () => {
    // now = T0 (recién empezada, muy dentro del deadline). Aun así, un fal FAILED es terminal → failed.
    const { deps, updates, enqueued } = makeDeps({
      state: 'failed',
      falStatus: 'FAILED',
      statusPayload: { status: 'FAILED' },
    });
    const res = await reconcileGeneration(deps, submittedGen());
    expect(res.outcome).toBe('expired');
    expect(updates[0]!.patch.status).toBe('failed');
    expect(updates[0]!.patch.falStatusPayload).toEqual({ status: 'FAILED' });
    expect(enqueued).toEqual([]);
  });
});

describe('reconcileGeneration — submitting sin request_id (crash entre INSERT y submit)', () => {
  it('dentro de la edad → noop (NO se puede pollear ni re-submitir con seguridad)', async () => {
    const { deps, updates, checkStatus } = makeDeps({ state: 'processing', statusPayload: {} });
    const gen = submittedGen({
      status: 'submitting',
      falRequestId: null,
      statusUrl: null,
      responseUrl: null,
    });
    const res = await reconcileGeneration(deps, gen);
    expect(res.outcome).toBe('noop');
    expect(updates).toEqual([]);
    // NO se pollea (no hay URL) ni se re-submitea (no hay dep de submit).
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it('superada la edad de submitting → expired (failed), NUNCA auto-resubmit', async () => {
    // createdAt = T0; now = T0 + 3 min > deadline submitting (2 min).
    const now = nowAt(new Date(T0.getTime() + 3 * 60_000));
    const { deps, updates, enqueued, checkStatus } = makeDeps(
      { state: 'processing', statusPayload: {} },
      now,
    );
    const gen = submittedGen({
      status: 'submitting',
      falRequestId: null,
      statusUrl: null,
      responseUrl: null,
    });
    const res = await reconcileGeneration(deps, gen);
    expect(res.outcome).toBe('expired');
    expect(updates[0]!.patch.status).toBe('failed');
    expect(enqueued).toEqual([]);
    expect(checkStatus).not.toHaveBeenCalled();
  });
});

describe('reconcileGeneration — estados TERMINALES → noop', () => {
  it.each(['completed', 'failed', 'cancelled'])(
    'un %s no pollea ni escribe nada',
    async (status) => {
      const { deps, updates, enqueued, checkStatus } = makeDeps({
        state: 'processing',
        statusPayload: {},
      });
      const res = await reconcileGeneration(deps, submittedGen({ status }));
      expect(res.outcome).toBe('noop');
      expect(updates).toEqual([]);
      expect(enqueued).toEqual([]);
      expect(checkStatus).not.toHaveBeenCalled();
    },
  );
});

describe('reconcileGeneration — in_progress: recuperación del agujero negro (T4.3 fix)', () => {
  it('DENTRO del deadline de descarga → noop (el consumer trabaja): NO pollea, NO re-encola', async () => {
    // updatedAt = T0, now = T0 → 0 ms en in_progress ≤ inProgressMs (20 min). No-op.
    const { deps, updates, enqueued, checkStatus } = makeDeps({
      state: 'processing',
      statusPayload: {},
    });
    const res = await reconcileGeneration(deps, submittedGen({ status: 'in_progress' }));
    expect(res.outcome).toBe('noop');
    expect(updates).toEqual([]);
    expect(enqueued).toEqual([]);
    // NO se pollea fal para una fila in_progress (la sub-lógica es por deadline, no por poll).
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it('PASADO el deadline de descarga (descarga perdida) → RE-ENCOLA con write guardado que refresca updatedAt', async () => {
    // updatedAt = T0, now = T0 + 21 min > inProgressMs (20 min), pero < maxAge (2 h). Re-encola.
    const now = nowAt(new Date(T0.getTime() + 21 * 60_000));
    const { deps, updates, enqueued } = makeDeps({ state: 'processing', statusPayload: {} }, now);
    const res = await reconcileGeneration(deps, submittedGen({ status: 'in_progress' }));
    expect(res.outcome).toBe('re_enqueued_download');
    // El write es un no-op semántico (status='in_progress') cuyo efecto es refrescar updatedAt (backoff).
    expect(updates[0]!.patch.status).toBe('in_progress');
    expect(enqueued).toEqual(['01SUBMITTED0000000000000000']);
  });

  it('PASADO el tope terminal (descarga irrecuperable, p.ej. URL expirada) → failed, corta el goteo', async () => {
    // createdAt = T0, now = T0 + 3 h > inProgressMaxAgeMs (2 h). Failed terminal, NO re-encola.
    const now = nowAt(new Date(T0.getTime() + 3 * 60 * 60_000));
    const { deps, updates, enqueued } = makeDeps({ state: 'processing', statusPayload: {} }, now);
    const res = await reconcileGeneration(deps, submittedGen({ status: 'in_progress' }));
    expect(res.outcome).toBe('expired');
    expect(updates[0]!.patch.status).toBe('failed');
    expect(enqueued).toEqual([]);
  });

  it('CARRERA: si el claim de in_progress no toma efecto (completer ganó) → noop, NO re-encola', async () => {
    const now = nowAt(new Date(T0.getTime() + 21 * 60_000));
    const enqueued: string[] = [];
    const res = await reconcileGeneration(
      {
        checkStatus: () => Promise.resolve({ state: 'processing', statusPayload: {} }),
        updateGeneration: () => Promise.resolve(false), // el completer ya la sacó de in_progress
        enqueueDownload: (id) => {
          enqueued.push(id);
          return Promise.resolve();
        },
        now,
        logger: silent,
      },
      submittedGen({ status: 'in_progress' }),
    );
    expect(res.outcome).toBe('noop');
    expect(enqueued).toEqual([]);
  });
});

describe('reconcileGeneration — taxonomía de errores de fal (principio 9: no colapsar ramas)', () => {
  it('un FalProviderError transitorio (429/timeout) dentro del deadline → noop (reintenta el próximo tick)', async () => {
    const { deps, updates, enqueued } = makeDeps(() =>
      Promise.reject(new FalProviderError('fal 503', { status: 503 })),
    );
    const res = await reconcileGeneration(deps, submittedGen());
    expect(res.outcome).toBe('noop');
    expect(updates).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it('un FalProviderError transitorio PASADO el deadline → expired (failed)', async () => {
    const now = nowAt(new Date(T0.getTime() + 11 * 60_000));
    const { deps, updates } = makeDeps(
      () => Promise.reject(new FalProviderError('fal 503', { status: 503 })),
      now,
    );
    const res = await reconcileGeneration(deps, submittedGen());
    expect(res.outcome).toBe('expired');
    expect(updates[0]!.patch.status).toBe('failed');
  });

  it('un FalResponseError (contrato roto) SE PROPAGA — NO se colapsa en un noop silencioso', async () => {
    const { deps } = makeDeps(() => Promise.reject(new FalResponseError('status desconocido')));
    await expect(reconcileGeneration(deps, submittedGen())).rejects.toBeInstanceOf(
      FalResponseError,
    );
  });
});
