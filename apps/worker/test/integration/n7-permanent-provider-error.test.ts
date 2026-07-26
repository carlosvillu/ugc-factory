// PRESUPUESTO DE SUBMITS ante un FALLO PERMANENTE DE PROVEEDOR a nivel de STEP (T5.16, MONEY POINT). Es
// el gemelo money-negativo de `n7-retry-budget.test.ts`: aquel prueba que el loser de dedup SOBREVIVE 80
// derrotas para deduplicar; ESTE prueba que un 403 «saldo agotado» NO consume ese presupuesto — muere en
// UN submit.
//
// EL BUG QUE PROTEGE (run de fase real): N7b (voiceover) re-submiteó 80 veces un `fal submit falló con
// 403: "User is locked. Reason: Exhausted balance."`. Cada submit se FACTURA (fal cobra el ENVÍO, no el
// éxito). La raíz: `runGenerationStep` dejaba subir TODO `FalProviderError` como retryable, agrupando el
// 403 permanente (saldo agotado, credencial revocada) con el timeout transitorio. El fix clasifica por
// status: 401/403/422 → `PermanentStepError` → `failed` terminal SIN retry.
//
// POR QUÉ MIDE SUBMITS Y NO retry_count (lección T5.14): `retry_count ≤ max_retries` es INFALSIFICABLE
// (max=80, el gate ya lo respeta) y NO distingue «murió en 1» de «agotó 80». La métrica que MUERDE es el
// nº de veces que el executor llegó a SUBMITEAR (fal cobra por submit). El fake cuenta los submits DENTRO
// del `fn` que envuelve `runGenerationStep` — la línea EXACTA donde un N7 real paga.
//
// POR QUÉ RECORRE EL CONSUMER REAL (no un seam cómodo): el camino money es
// executor→`runGenerationStep`→`step-execute.ts`. Fijar el contador a mano en un punto intermedio probaría
// un mundo que no es el de producción. Este test levanta el consumer real (`startWorkerWith`) y clasifica
// por el `runGenerationStep` real; lo ÚNICO simulado es la respuesta de fal (el `FalProviderError`).
//
// EL CONTRASTE QUE LO HACE MORDER: el nodo se siembra con `maxRetries: N7_MAX_RETRIES` (80) — el MISMO
// cableado del N7b real. Sin el fix, un 403 daría ~81 submits (1 + 80 retries); con el fix, 1. El test
// asserta 1. (Si se sembrara con el default 3, el test pasaría en 1 submit pero NO probaría nada del bug:
// la clave es el contraste 1-vs-81 que solo el presupuesto de 80 produce.)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRun, N7_MAX_RETRIES } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { FalProviderError } from '@ugc/core/generation';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';

import { seedProject, startWorkerWith, stopBossAndWait, waitFor } from '../helpers';
import { runGenerationStep } from '../../src/executors/_shared';

// Backoff diminuto (producción = 30 s): el 403 permanente NO usa backoff (retry inmediato de failStep si
// lo hubiera), pero el control negativo (429 retryable) sí recorre el ciclo failStep→retry; con backoff
// pequeño no espera minutos reales. Recorre el MISMO camino (`startAfter` de pg-boss), no uno simulado.
const TEST_BACKOFF_MS = 50;

let tdb: TestDatabase;

async function fetchStep(
  runId: string,
): Promise<{ status: string; retryCount: number; error: unknown } | undefined> {
  const { rows } = await tdb.pool.query<{ status: string; retry_count: string; error: unknown }>(
    'SELECT status, retry_count, error FROM step_run WHERE run_id = $1 ORDER BY id LIMIT 1',
    [runId],
  );
  const r = rows[0];
  return r ? { status: r.status, retryCount: Number(r.retry_count), error: r.error } : undefined;
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:n7-permanent-provider-error' });
  // Materializa el schema de pg-boss para que el DELETE del beforeEach no falle (ver n7-retry-budget).
  const seedBoss = new PgBoss({ connectionString: tdb.connectionString, max: 2 });
  seedBoss.on('error', () => undefined);
  await seedBoss.start();
  await stopBossAndWait(seedBoss);
});

afterAll(async () => {
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE step_run, pipeline_run, project CASCADE');
  await tdb.pool.query('DELETE FROM pgboss.job WHERE name = $1', [stepExecuteJob.name]);
});

let harnessCleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  if (harnessCleanup !== undefined) {
    await harnessCleanup();
    harnessCleanup = undefined;
  }
});

/**
 * Un executor N7 "fake" que ejerce el camino de submit REAL: envuelve la llamada a fal en
 * `runGenerationStep` (el clasificador real). El `fn` interior SIMULA la respuesta de fal lanzando un
 * `FalProviderError` con el status dado, y cuenta cada intento de submit — que es lo que fal factura.
 */
function providerErrorExecutor(status: number | undefined): {
  executor: StepExecutor;
  submits: () => number;
} {
  let submits = 0;
  const executor: StepExecutor = async () =>
    runGenerationStep(async () => {
      // ── ESTA es la línea que un N7 real PAGA: el submit a fal. El contador vive AQUÍ (no al entrar al
      //    executor) para que cuente submits honestos, no un proxy 1:1 del nº de ejecuciones.
      submits += 1;
      await Promise.resolve();
      const label =
        status === undefined
          ? 'timeout/red (sin status)'
          : `fal submit falló con ${String(status)}`;
      throw new FalProviderError(`${label}: User is locked. Reason: Exhausted balance.`, {
        ...(status !== undefined ? { status } : {}),
      });
    });
  return { executor, submits: () => submits };
}

/** Un executor que falla `losesBeforeWin` veces con un `FalProviderError` transitorio (retryable) y luego
 *  triunfa — el control negativo bidireccional: si el fix fuera DEMASIADO ANCHO (todo FalProviderError →
 *  permanente), este step iría a `failed` en 1 submit en vez de reintentar y triunfar. */
function transientThenSucceedExecutor(
  status: number | undefined,
  losesBeforeWin: number,
): { executor: StepExecutor; submits: () => number } {
  let submits = 0;
  const executor: StepExecutor = async ({ collectOutput }) => {
    await runGenerationStep(async () => {
      submits += 1;
      if (submits <= losesBeforeWin) {
        await Promise.resolve();
        throw new FalProviderError('fal respondió transitorio', {
          ...(status !== undefined ? { status } : {}),
        });
      }
      // Ya "pasó" el transitorio → el submit siguiente iría bien; no lanzamos.
      await Promise.resolve();
    });
    collectOutput?.({ ok: true, afterTransients: submits - 1 });
  };
  return { executor, submits: () => submits };
}

/**
 * Levanta el consumer real con `executor` cableado como N7b y siembra un run de UN nodo N7b. Colapsa el
 * setup triplicado de los tres casos: arranca `startWorkerWith` (registrando su `cleanup` en
 * `harnessCleanup` para el `afterEach`), siembra el proyecto y crea el run.
 *
 * EL CABLEADO QUE HACE MORDER EL TEST (única fuente): el nodo se siembra con `maxRetries: N7_MAX_RETRIES`
 * (80) — el MISMO presupuesto del N7b real. Sin el fix, un 403 consumiría las 80 vueltas (~81 submits
 * facturados); con el fix, muere en 1. Sembrar el default (3) escondería el bug: el contraste 1-vs-81 es
 * la prueba.
 */
async function launchN7bWith(executor: StepExecutor): Promise<{ runId: string }> {
  const { deps, cleanup } = await startWorkerWith(
    tdb,
    { N7b: executor },
    { retryBackoffMs: TEST_BACKOFF_MS },
  );
  harnessCleanup = cleanup;

  const projectId = await seedProject(tdb);
  const { runId } = await createRun(deps, {
    projectId,
    nodes: [
      {
        key: 'N7b',
        nodeKey: 'N7b',
        variantId: 'v1',
        dependsOn: [],
        config: {},
        maxRetries: N7_MAX_RETRIES,
      },
    ],
  });
  return { runId };
}

describe('fallo PERMANENTE de proveedor (403/401/422) a nivel de step: muere en 1 submit (T5.16)', () => {
  it('un 403 "saldo agotado" con maxRetries=N7_MAX_RETRIES → failed terminal en EXACTAMENTE 1 submit (no ~81)', async () => {
    const { executor, submits } = providerErrorExecutor(403);
    const { runId } = await launchN7bWith(executor);

    // El 403 clasificado como permanente → `failed` terminal directo (NO agota los 80 retries).
    await waitFor(
      async () => (await fetchStep(runId))?.status === 'failed',
      30_000,
      'N7b failed terminal por 403 permanente',
      50,
    );

    const step = await fetchStep(runId);
    expect(step?.status).toBe('failed');
    // LA MÉTRICA MONEY: exactamente 1 submit. NO ~81. Este assert es el que muerde.
    expect(submits()).toBe(1);
    // Terminal SIN retry: el permanente NO pasa por failStep (que gatearía retry_count), va por
    // transition('fail', {permanent:true}). retry_count queda en 0.
    expect(step?.retryCount).toBe(0);
    // Huella DIRECTA de la rama permanente del consumer (step-execute.ts): `error.permanent === true`.
    // Discrimina esta muerte de un `failed` por agotar retries (que NO lleva `permanent`).
    const err = step?.error as { message?: string; permanent?: boolean } | null;
    expect(err?.permanent).toBe(true);
    // El mensaje persistido es ACCIONABLE (la cláusula "accionable" de la Entrega): nombra el fallo
    // permanente de proveedor y apunta al humano a Ajustes → fal.
    expect(err?.message).toMatch(/PERMANENTE del proveedor/);
    expect(err?.message).toMatch(/Ajustes → fal/);
    // El mensaje ORIGINAL de fal sobrevive dentro del accionable (evidencia para el visor de logs, T1.16).
    expect(err?.message).toMatch(/Exhausted balance/);
  }, 60_000);

  it.each([401, 422])(
    'un %i (credencial revocada / input inválido) también muere en 1 submit (permanente)',
    async (status) => {
      const { executor, submits } = providerErrorExecutor(status);
      const { runId } = await launchN7bWith(executor);

      await waitFor(
        async () => (await fetchStep(runId))?.status === 'failed',
        30_000,
        `N7b failed terminal por ${String(status)} permanente`,
        50,
      );

      const step = await fetchStep(runId);
      expect(step?.status).toBe('failed');
      expect(submits()).toBe(1);
      expect(step?.retryCount).toBe(0);
      expect((step?.error as { permanent?: boolean } | null)?.permanent).toBe(true);
    },
    60_000,
  );

  // ── CONTROL NEGATIVO BIDIRECCIONAL: el fix NO debe pasarse de ANCHO ─────────────────────────────────
  // Si `runGenerationStep` colapsara TODO `FalProviderError` en permanente, un 429/timeout (transitorio de
  // verdad) moriría en 1 submit en vez de reintentar y triunfar → ESTE test se pondría ROJO. Es el que
  // impide "arreglar" el bug del 403 rompiendo la retryabilidad legítima del 429.
  const transientCases: { label: string; status: number | undefined }[] = [
    { label: '429 (rate limit)', status: 429 },
    { label: 'timeout/red (status undefined)', status: undefined },
  ];
  it.each(transientCases)(
    'CONTROL NEGATIVO — un FalProviderError $label SIGUE retryable: reintenta y triunfa (>1 submit, NO permanente)',
    async ({ status }) => {
      const LOSES = 2; // pierde 2 veces (transitorio), triunfa a la 3ª. <80 → el presupuesto sobra.
      const { executor, submits } = transientThenSucceedExecutor(status, LOSES);
      const { runId } = await launchN7bWith(executor);

      // El transitorio se reintenta hasta que "pasa" → succeeded (NO failed permanente en 1 submit).
      await waitFor(
        async () => (await fetchStep(runId))?.status === 'succeeded',
        30_000,
        'N7b succeeded tras reintentar un transitorio',
        50,
      );

      const step = await fetchStep(runId);
      expect(step?.status).toBe('succeeded');
      // Reintentó: MÁS de 1 submit (2 derrotas + 1 acierto). Si el fix fuera demasiado ancho, sería 1 y
      // `failed` — este assert lo caza.
      expect(submits()).toBe(LOSES + 1);
      expect(step?.retryCount).toBe(LOSES);
    },
    60_000,
  );
});
