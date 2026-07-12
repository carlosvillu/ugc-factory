// N3 ES IDEMPOTENTE POR ENTRADA — Y ESTE TEST CUIDA DINERO, no una propiedad estética.
//
// EL BUG (lo cazó el code-review de T1.10b). N3 paga ~$0,20 de Sonnet 5 y DESPUÉS persiste el
// brief. Si esa persistencia falla por algo TRANSITORIO —un deadlock contra el advisory lock del
// bump, un timeout, una conexión que cae DESPUÉS de que el commit haya prosperado en el
// servidor—, el step se va a `failStep` → gate de retry → y N3 se re-ejecuta ENTERO,
// `runSynthesizeBrief` incluida: OTROS ~$0,20 por un INSERT que falló, con el brief ya
// sintetizado y el dinero ya en el ledger. Tres vueltas ≈ $0,60 quemados. Y encima cada vuelta
// dejaba OTRA fila `product_brief` (v2, v3…) marcada `edited_by_user:false` — "versiones de la
// IA" que el usuario nunca pidió y que nada distingue de la buena.
//
// LA DEFENSA. Antes de llamar a Anthropic, N3 pregunta "¿ya produje YO mi brief?" por
// `origin_step_run_id` (un retry CONSERVA el `step_run.id`: `failStep` reusa la fila y solo
// incrementa `retry_count`). Si lo encuentra, lo REUSA sin pasar por caja.
//
// CÓMO SE PRUEBA. Se ejecuta el executor N3 REAL dos veces CON EL MISMO `stepId` — que es
// exactamente lo que le pasa a un step reintentado— contra Postgres real, y se cuenta cuántas
// veces se llama a Anthropic. La segunda vuelta NO debe llamar y NO debe crear otra fila. Un
// `fetch` instrumentado hace de contador; el brief que devuelve es el FAKE canónico, el mismo que
// emite el productor real (packages/test-utils/fake-apis.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveSecretsKey, encryptSecret } from '@ugc/core/secrets';
import type { ExecutorDep } from '@ugc/core/orchestrator';
import type { N1Output } from '@ugc/core/contracts';
import {
  createTestDatabase,
  makeProject,
  makeRawContent,
  makeUrlAnalysis,
  startFakeExternalApis,
  type FakeExternalApis,
  type TestDatabase,
} from '@ugc/test-utils';
import { createDbPool, seedSecretIfAbsent } from '@ugc/db';
import { project, urlAnalysis } from '@ugc/db/schema';
import { newUlid } from '@ugc/core/contracts';
import type { StorageAdapter } from '@ugc/core';
import { makeN3Executor } from '../../src/executors/analysis';

let tdb: TestDatabase;
let fakes: FakeExternalApis;

/** Storage que nadie usa en N3 (no escribe assets): fallar si se toca es mejor que fingir. */
const unusedStorage = {
  put: () => Promise.reject(new Error('N3 no debería tocar el storage')),
  get: () => Promise.reject(new Error('N3 no debería tocar el storage')),
} as unknown as StorageAdapter;

const secretsKey = deriveSecretsKey('0'.repeat(64));

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:n3-idempotency' });
  fakes = await startFakeExternalApis();
});

afterAll(async () => {
  await fakes.close();
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE cost_entry, product_brief, url_analysis, project CASCADE');
});

/** Un proyecto + un `url_analysis` con contenido real: lo que N1 le entrega a N3. */
async function seedAnalysis(): Promise<N1Output> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  if (!p) throw new Error('seedAnalysis: sin proyecto');
  // El RawContent canónico de una URL scrapeada (el mismo que emite el productor real). Se usa
  // el perfil `url` a propósito: es el que activa el cross-check de precio de T1.9, así que el
  // brief REUSADO se revalida contra el contenido real y no contra una ficción cómoda.
  const raw = makeRawContent();
  const [a] = await tdb.db
    .insert(urlAnalysis)
    .values(
      makeUrlAnalysis({
        projectId: p.id,
        source: 'url',
        rawContent: raw,
        contentHash: `hash-${newUlid()}`,
      }),
    )
    .returning();
  if (!a) throw new Error('seedAnalysis: sin análisis');
  return { analysisId: a.id, projectId: p.id, raw };
}

describe('N3 · idempotencia por step (T1.10b): un reintento NO vuelve a pagar la síntesis', () => {
  it('reejecutar N3 con el MISMO stepId reusa el brief ya pagado (0 llamadas nuevas, 0 filas nuevas)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await seedSecretIfAbsent(db, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
      const n1 = await seedAnalysis();

      // El CONTADOR DE LA CAJA: cada POST a /v1/messages es una llamada PAGADA a Sonnet 5.
      let llamadasAnthropic = 0;
      const countingFetch: typeof globalThis.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes('/v1/messages')) llamadasAnthropic += 1;
        return globalThis.fetch(input, init);
      };

      const n3 = makeN3Executor({
        db,
        storage: unusedStorage,
        secretsKey,
        fetch: countingFetch,
        anthropicBaseUrl: fakes.anthropicBaseUrl,
      });

      // El MISMO stepId en las dos vueltas: es lo que hace `failStep` (failed→queued sobre la
      // MISMA fila, `retry_count++`). Un RE-RUN del pipeline, en cambio, crearía steps nuevos —
      // y ese sí debe volver a sintetizar. El id del step separa exactamente esos dos casos.
      const stepId = newUlid();
      const deps: ExecutorDep[] = [
        { stepId: newUlid(), nodeKey: 'N1', status: 'succeeded', outputRefs: n1 },
      ];
      const outputs: unknown[] = [];
      const ctx = {
        config: { targetLanguage: 'es' },
        runId: newUlid(),
        stepId,
        deps,
        collectOutput: (refs: unknown) => outputs.push(refs),
      };

      await n3(ctx);
      expect(llamadasAnthropic).toBe(1); // primera vuelta: se sintetiza y se paga

      // SEGUNDA VUELTA = el reintento. Antes del fix, esto volvía a llamar a Sonnet 5.
      await n3(ctx);

      expect(llamadasAnthropic).toBe(1); // ← LA PROPIEDAD: el retry NO pasa por caja
      const { rows } = await tdb.pool.query<{ count: string }>(
        'SELECT count(*) FROM product_brief',
      );
      // Y NO deja una segunda "versión de la IA" que nadie pidió (el UNIQUE parcial
      // `product_brief_origin_step_key` lo hace además IMPOSIBLE, no solo improbable).
      expect(Number(rows[0]?.count)).toBe(1);

      // El artefacto de la segunda vuelta apunta al MISMO brief: el step reintentado cierra con
      // el brief que ya se pagó, no con un hueco.
      const [primero, segundo] = outputs as { briefId: string }[];
      expect(segundo?.briefId).toBe(primero?.briefId);
    } finally {
      await pool.end();
    }
  }, 30_000);
});
