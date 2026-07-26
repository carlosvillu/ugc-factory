// EL `detail` DEL ERROR DE FAL LLEGA A `step_run.error` (T5.17, MONEY POINT / observabilidad de dinero —
// regla 5a). Es el gemelo de `n7-permanent-provider-error.test.ts`: aquel prueba que un 403 muere en 1
// submit (no re-paga); ESTE prueba que la CAUSA de ese 403 («User is locked. Reason: Exhausted balance.»)
// sobrevive en la evidencia que el producto guarda, en vez de colapsar en un genérico «403: Forbidden».
//
// EL BUG QUE PROTEGE (smoke-test de generación real 2026-07-26): un clip de b-roll N7d falló con 403; el
// step quedó `failed` con `error.message = "fal submit falló con 403: Forbidden"` y NADA MÁS. El SDK de fal
// lanza `ApiError { status, body }` donde `body = {"detail":"User is locked. Reason: Exhausted balance."}`,
// pero `toProviderError` leía SOLO `status` y descartaba `body` → la causa quedó INDIAGNOSTICABLE. El
// mensaje que T5.16 emite al operador le pide DISCRIMINAR (saldo/credencial/input) pero el producto tiraba
// la única pista que lo permite.
//
// POR QUÉ RECORRE EL CAMINO REAL DE PUNTA A PUNTA (no un seam que fije el error a mano — antipatrón T1.13):
// el executor construye un `FalClient` REAL con `fetch` inyectado que devuelve un 403 con el body de causa.
// La cadena que se ejercita es la de PRODUCCIÓN: SDK `@fal-ai/client` parsea la respuesta → `ApiError` con
// `body` REAL → `submit()` llama a `toProviderError` REAL (el punto que el fix toca) → `runGenerationStep`
// clasifica → `step-execute.ts` persiste en `step_run.error`. NADA está hand-fixed: si se revierte la
// captura de `body` en `toProviderError`, el `detail` DESAPARECE del jsonb y este test se pone ROJO en el
// assert de persistencia — control negativo de un solo punto, el que nombra la Verificación.
//
// EL FIXTURE NO ES VERDE-DECORATIVO (antipatrón T1.9): el body NO trae `.message`, así que el SDK produce
// `message = statusText = "Forbidden"` (response.js: `body.message || statusText`) — EXACTAMENTE el síntoma
// observado. El detalle SOLO puede llegar por el nuevo campo `detail`; si se filtrara por el message, el
// control negativo pasaría en silencio. El test lo verifica: el message del step NO contiene «Exhausted
// balance», pero el `detail` SÍ.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRun, N7_MAX_RETRIES } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { makeFalClient } from '@ugc/core/generation';
import { stepExecuteJob } from '@ugc/core/jobs';
import { createTestDatabase } from '@ugc/test-utils';
import type { TestDatabase } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';

import { seedProject, startWorkerWith, stopBossAndWait, waitFor } from '../helpers';
import { runGenerationStep } from '../../src/executors/_shared';

const TEST_BACKOFF_MS = 50;
const ENDPOINT = 'fal-ai/flux-2';
// El detalle de causa EXACTO del bug real: es lo que el operador debe poder leer en la evidencia.
const FAL_BALANCE_DETAIL = 'User is locked. Reason: Exhausted balance.';
const FAL_RATE_LIMIT_DETAIL = 'Rate limit exceeded';

let tdb: TestDatabase;

async function fetchStep(runId: string): Promise<{ status: string; error: unknown } | undefined> {
  const { rows } = await tdb.pool.query<{ status: string; error: unknown }>(
    'SELECT status, error FROM step_run WHERE run_id = $1 ORDER BY id LIMIT 1',
    [runId],
  );
  const r = rows[0];
  return r ? { status: r.status, error: r.error } : undefined;
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:n7-provider-error-detail' });
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
 * Un executor N7 que SUBMITEA a un `FalClient` REAL cuyo `fetch` inyectado devuelve `status` con un body de
 * causa `{"detail": ...}`. Recorre el SDK real → `ApiError` con body → `toProviderError` real →
 * `runGenerationStep`. NADA hand-fixed: el `detail` que se persiste nace del body que el SDK parsea. El
 * contador de `fetch` cuenta lo que fal factura (el submit HTTP).
 *
 * `statusText` sin body `.message` → el SDK pone `message = statusText` (el síntoma real: «403: Forbidden»);
 * la causa SOLO viaja por `body.detail`. Sirve para AMBAS ramas del consumer (step-execute.ts): un 403 va a
 * la rama PERMANENTE (`PermanentStepError`), un 429 sigue RETRYABLE y persiste su error por la otra rama al
 * agotar `maxRetries`.
 */
function providerErrorExecutor(
  status: number,
  statusText: string,
  detail: string,
): { executor: StepExecutor; submits: () => number } {
  let submits = 0;
  const falFetch: typeof globalThis.fetch = () => {
    submits += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ detail }), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const fal = makeFalClient({
    credentials: 'test-fal-key-not-a-secret',
    fetch: falFetch,
    sleep: () => Promise.resolve(),
    pollIntervalMs: 0,
    maxRetries: 0,
  });
  const executor: StepExecutor = async () => {
    // El submit SIEMPRE lanza (fetch inyectado → status de error); nunca devuelve. Se descarta el resultado
    // para encajar en `StepExecutor` (Promise<void>) — lo que importa es que el throw recorra `toProviderError`.
    await runGenerationStep(() => fal.submit(ENDPOINT, { prompt: 'x' }));
  };
  return { executor, submits: () => submits };
}

async function launchN7bWith(
  executor: StepExecutor,
  maxRetries: number,
): Promise<{ runId: string }> {
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
        maxRetries,
      },
    ],
  });
  return { runId };
}

interface PersistedStepError {
  message?: string;
  permanent?: boolean;
  status?: number;
  detail?: string;
}

describe('el `detail` del error de fal llega a step_run.error (T5.17, diagnóstico de causa)', () => {
  it('RAMA PERMANENTE — un 403 «saldo agotado» → step_run.error CONTIENE el detail de causa, no solo "403: Forbidden"', async () => {
    const { executor, submits } = providerErrorExecutor(403, 'Forbidden', FAL_BALANCE_DETAIL);
    // maxRetries alto (el cableado del N7b real): el contraste 1-vs-81 re-prueba que T5.16 no regresó.
    const { runId } = await launchN7bWith(executor, N7_MAX_RETRIES);

    await waitFor(
      async () => (await fetchStep(runId))?.status === 'failed',
      30_000,
      'N7b failed terminal por 403 permanente',
      50,
    );

    const step = await fetchStep(runId);
    expect(step?.status).toBe('failed');
    // T5.16 no regresó: el 403 permanente muere en 1 submit facturado (no ~81).
    expect(submits()).toBe(1);

    const err = step?.error as PersistedStepError | null;
    // La huella de la rama permanente del consumer sigue presente.
    expect(err?.permanent).toBe(true);
    // T5.17 — EL ASSERT QUE MUERDE: el detail de causa está persistido en `step_run.error`, SEPARADO del
    // message. El operador lee «Exhausted balance» de la evidencia que el producto guarda, no de un probe
    // externo. Sin el fix (revert de `toProviderError`), este campo es undefined → ROJO.
    expect(err?.detail).toBeDefined();
    expect(err?.detail).toContain('Exhausted balance');
    // El status HTTP también viaja separado (Entrega: junto a message/permanent/status).
    expect(err?.status).toBe(403);
    // El message del SDK por sí solo era «Forbidden» (statusText) — el síntoma del bug. Ahora el mensaje
    // accionable de `_shared.ts` RE-INCLUYE la causa («Causa (fal): …») para el visor de logs (T1.16), así
    // que el operador la ve tanto en `detail` como en el message. Ambos deben nombrar la causa.
    expect(err?.message).toMatch(/403: Forbidden/);
    // bridge a T1.16 (el visor de logs solo lee message), NO comportamiento de feature: cuando la UI lea
    // `detail` structured, este assert se relaja.
    expect(err?.message).toContain('Exhausted balance');
  }, 60_000);

  it('RAMA RETRYABLE — un 429 que AGOTA maxRetries → failed terminal con el detail persistido (misma clase de bug)', async () => {
    // Un 429 NO se reclasifica como permanente (T5.16: sigue retryable). Con `maxRetries: 1` agota rápido y
    // cae a `failed` terminal por la OTRA rama del consumer (`step-execute.ts:failStep`, no la permanente).
    // El detail debe sobrevivir IGUAL: es el mismo defecto de observabilidad de dinero para el 429.
    const { executor, submits } = providerErrorExecutor(
      429,
      'Too Many Requests',
      FAL_RATE_LIMIT_DETAIL,
    );
    const { runId } = await launchN7bWith(executor, 1);

    await waitFor(
      async () => (await fetchStep(runId))?.status === 'failed',
      30_000,
      'N7b failed terminal tras agotar retries de un 429',
      50,
    );

    const step = await fetchStep(runId);
    expect(step?.status).toBe('failed');
    // Reintentó: MÁS de 1 submit (el 429 NO es permanente → recorrió la rama retryable de failStep hasta
    // agotar retries). El nº exacto lo gobierna T5.16/n7-retry-budget; aquí basta el contraste con el 403
    // (que muere en 1): si el fix fuera demasiado ancho y colapsara el 429 en permanente, sería 1 submit.
    expect(submits()).toBeGreaterThan(1);

    const err = step?.error as PersistedStepError | null;
    // NO permanente: la clasificación de T5.16 no se pasó de ancha (429 sigue retryable). El error
    // persistido de la rama retryable NO lleva `permanent`.
    expect(err?.permanent).toBeUndefined();
    // T5.17 — el detail y el status del 429 llegan a `step_run.error` por la rama retryable también.
    expect(err?.status).toBe(429);
    expect(err?.detail).toBeDefined();
    expect(err?.detail).toContain('Rate limit exceeded');
    expect(err?.message).toMatch(/429/);
  }, 60_000);
});
