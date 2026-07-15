// N5 · GUIONIZACIÓN (T2.6), la parte DETERMINISTA de su verificación (regla de trabajo 8: vive en
// `pnpm gate`). El executor REAL de N5 contra Postgres real + el Anthropic FALSO (fake-apis: cero
// red real, cero gasto). Cubre lo que el unit de core (que para en `ScriptWriterResult`) y el test
// del servicio (que para en el `cost_entry`) no cubren: la PERSISTENCIA de `ad_script` v1 con sus
// flags FTC, el emparejamiento guion↔variante por `filenameCode`, y la IDEMPOTENCIA DE DINERO.
//
// Igual que N3, esto CUIDA DINERO: N5 paga Sonnet 5, y un retry (mismo `step_run.id`) NO puede
// re-pagar. Se ejecuta el executor dos veces con el MISMO stepId y se cuenta que la 2.ª vuelta no
// llama a Anthropic ni crea filas nuevas.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveSecretsKey, encryptSecret } from '@ugc/core/secrets';
import { newUlid } from '@ugc/core/contracts';
import type { BatchConfig, GuardrailFlag, N5Output } from '@ugc/core/contracts';
import { planBatch } from '@ugc/core/strategy';
import { SEED_LIBRARY, validateSeeds } from '@ugc/core/library';
import {
  createTestDatabase,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  startFakeExternalApis,
  type FakeExternalApis,
  type TestDatabase,
} from '@ugc/test-utils';
import {
  createBatchWithVariants,
  createDbPool,
  listBatchVariants,
  listPlanningInputs,
  seedLibrary,
  seedSecretIfAbsent,
} from '@ugc/db';
import { persona, productBrief, project, urlAnalysis } from '@ugc/db/schema';
import { makeN5Executor } from '../../src/executors/write-scripts';

let tdb: TestDatabase;
let fakes: FakeExternalApis;

const secretsKey = deriveSecretsKey('0'.repeat(64));

const BRIEF = makeBrief();
// Un lote PEQUEÑO: 2 ángulos × 1 hook × 1 idioma = 2 variantes (2 grupos ⇒ 2 llamadas). Suficiente
// para probar la persistencia y el emparejamiento sin gastar tiempo de suite.
const CONFIG: BatchConfig = {
  angleIndices: [0, 1],
  hooksPerAngle: 1,
  objective: 'hook_test',
  tier: 'test',
  languages: ['es'],
  personaMode: 'rotate',
};

const LUCIA = {
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female' as const,
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural',
  setting: 'baño luminoso',
  personality: 'cercana',
};

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:n5' });
  fakes = await startFakeExternalApis();
  const validation = validateSeeds(SEED_LIBRARY);
  if (!validation.library) throw new Error('la librería real no valida');
  await seedLibrary(tdb.db, validation.library);
  await tdb.db.insert(persona).values(LUCIA);
});

afterAll(async () => {
  await fakes.close();
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE ad_script, ad_variant, ad_batch, cost_entry CASCADE');
});

/** Siembra proyecto + análisis + brief, y crea un lote REAL (matriz compuesta con el discriminante,
 *  como CP2). Devuelve el batchId. */
async function seedBatch(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();

  const { libraryHooks, personas, recipe } = await listPlanningInputs(tdb.db, CONFIG.tier);
  const args = { brief: BRIEF, config: CONFIG, libraryHooks, personas, recipe: recipe! };
  const preview = planBatch(args);
  const created = await createBatchWithVariants(tdb.db, {
    projectId: p!.id,
    briefId: brief!.id,
    tier: CONFIG.tier,
    objective: CONFIG.objective,
    languages: CONFIG.languages,
    costEstimatedCents: preview.estimate.total.maxCents,
    composePlan: (batchId) => planBatch({ ...args, batchDiscriminator: batchId }).plan,
  });
  return created.batch.id;
}

function makeExecutorWith(
  fetch: typeof globalThis.fetch,
  db: ReturnType<typeof createDbPool>['db'],
) {
  return makeN5Executor({ db, secretsKey, fetch, anthropicBaseUrl: fakes.anthropicBaseUrl });
}

describe('N5 executor (T2.6): escribe ad_script v1 con flags y persiste el lote', () => {
  it('escribe un ad_script v1 por variante, linteado, y deja el artefacto ligero', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await seedSecretIfAbsent(db, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
      const batchId = await seedBatch();

      const outputs: unknown[] = [];
      const ctx = {
        config: { batchId },
        runId: newUlid(),
        stepId: newUlid(),
        deps: [],
        collectOutput: (refs: unknown) => outputs.push(refs),
      };
      await makeExecutorWith(globalThis.fetch, db)(ctx);

      // Una fila ad_script v1 por variante (2), todas edited_by_user=false y con guardrail_flags NO
      // null (linteado desde el arranque — el bloqueo de CP3 no distingue v1 de v2).
      const { rows: scripts } = await tdb.pool.query<{
        version: number;
        edited_by_user: boolean;
        guardrail_flags: unknown;
        origin_step_run_id: string | null;
      }>('SELECT version, edited_by_user, guardrail_flags, origin_step_run_id FROM ad_script');
      expect(scripts).toHaveLength(2);
      expect(scripts.every((s) => s.version === 1)).toBe(true);
      expect(scripts.every((s) => !s.edited_by_user)).toBe(true);
      expect(scripts.every((s) => Array.isArray(s.guardrail_flags))).toBe(true);
      expect(scripts.every((s) => s.origin_step_run_id === ctx.stepId)).toBe(true);

      // El executor NO toca ad_variant.status: siguen `planned` (la transición a `scripted` es CP3).
      const { rows: variants } = await tdb.pool.query<{ status: string }>(
        'SELECT status FROM ad_variant',
      );
      expect(variants.every((v) => v.status === 'planned')).toBe(true);

      // El artefacto ligero: batchId + una ref por guion (con blocked derivado de sus flags).
      const artifact = outputs[0] as N5Output;
      expect(artifact.batchId).toBe(batchId);
      expect(artifact.scriptRefs).toHaveLength(2);
      expect(artifact.status).toBe('scripted');
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('idempotencia de dinero: un retry (mismo stepId) NO re-paga ni crea filas nuevas', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await seedSecretIfAbsent(db, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
      const batchId = await seedBatch();

      let anthropicCalls = 0;
      const countingFetch: typeof globalThis.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes('/v1/messages')) anthropicCalls += 1;
        return globalThis.fetch(input, init);
      };

      const stepId = newUlid();
      const outputs: unknown[] = [];
      const ctx = {
        config: { batchId },
        runId: newUlid(),
        stepId,
        deps: [],
        collectOutput: (refs: unknown) => outputs.push(refs),
      };
      const exec = makeExecutorWith(countingFetch, db);

      await exec(ctx);
      const callsAfterFirst = anthropicCalls;
      expect(callsAfterFirst).toBeGreaterThan(0); // 2 grupos ⇒ ≥1 llamada de pago

      // SEGUNDA VUELTA = el reintento (mismo stepId). NO debe volver a llamar a Sonnet 5.
      await exec(ctx);
      expect(anthropicCalls).toBe(callsAfterFirst); // ← la propiedad: el retry NO pasa por caja

      // Y NO deja filas de más: siguen siendo 2 (el índice de origen NO es unique, pero la relectura
      // por origen reusa; nada re-inserta).
      const { rows } = await tdb.pool.query<{ count: string }>('SELECT count(*) FROM ad_script');
      expect(Number(rows[0]?.count)).toBe(2);

      // El artefacto de la 2.ª vuelta apunta al mismo lote y trae las mismas refs (status reused).
      const second = outputs[1] as N5Output;
      expect(second.status).toBe('reused');
      expect(second.scriptRefs).toHaveLength(2);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('empareja cada guion con su variante por filenameCode (todas las variantes reciben guion)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await seedSecretIfAbsent(db, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
      const batchId = await seedBatch();
      const ctx = {
        config: { batchId },
        runId: newUlid(),
        stepId: newUlid(),
        deps: [],
        collectOutput: () => undefined,
      };
      await makeExecutorWith(globalThis.fetch, db)(ctx);

      // Cada variante del lote tiene EXACTAMENTE un guion: ninguna se quedó scriptless (que nunca
      // llegaría a `scripted`, rompiendo la Verificación de las 6 variantes).
      const variants = await listBatchVariants(tdb.db, batchId);
      for (const v of variants) {
        const { rows } = await tdb.pool.query<{ count: string }>(
          'SELECT count(*) FROM ad_script WHERE variant_id = $1',
          [v.id],
        );
        expect(Number(rows[0]?.count)).toBe(1);
      }
      // Control: los flags son un array (linteado), no null.
      const { rows: flags } = await tdb.pool.query<{ guardrail_flags: GuardrailFlag[] }>(
        'SELECT guardrail_flags FROM ad_script',
      );
      expect(flags.every((f) => Array.isArray(f.guardrail_flags))).toBe(true);
    } finally {
      await pool.end();
    }
  }, 30_000);
});
