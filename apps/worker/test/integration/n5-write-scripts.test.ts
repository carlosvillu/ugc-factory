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
import { PermanentStepError } from '@ugc/core/orchestrator';
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

// ── T5.11 · LOTE PARCIAL ≠ ÉXITO ────────────────────────────────────────────────────────────────
// El defecto REAL (run de T5.9, 2026-07-25): el saldo de Anthropic se agotó a mitad de N5 ⇒ el
// servicio devolvió `api_error` con 5 de 12 guiones escritos y el executor emitió su artefacto como
// si nada ⇒ `step_run` en `waiting_approval` con `error = NULL` y CP3 ofreciendo aprobar un lote
// truncado (que dispara generación de PAGO). Aquí se REPRODUCE inyectando el fallo del proveedor con
// el doble ($0: el 2.º grupo recibe un 429 del `fetch` de test, no de la API real) y se asserta que:
//   1. el executor LANZA (⇒ el consumer lleva el step a `failed`, no a `waiting_approval`),
//   2. el fallo es PERMANENTE (no se reintenta automáticamente contra un saldo agotado),
//   3. el mensaje distingue POR TIPO el fallo del PROVEEDOR y trae el recuento real (k/n),
//   4. los guiones ya escritos y PAGADOS se CONSERVAN (el retry los reusa sin re-pagar),
//   5. y la rama de REUSO también gatea: un retry sobre el lote truncado NO declara éxito.
describe('N5 executor (T5.11): un lote parcial NUNCA se presenta como éxito', () => {
  /** `fetch` que deja pasar la 1.ª llamada a Anthropic y responde 429 (rate limit / saldo) a partir
   *  de la 2.ª: el guionista traduce un `APIError` a estado `api_error` (script-writer.ts), que es
   *  EXACTAMENTE el diagnóstico del run real. Un body malformado daría `parse_error` — otro
   *  diagnóstico, otro camino: no serviría para reproducir este bug. */
  function fetchFailingAfterFirstCall(): { fetch: typeof globalThis.fetch; calls: () => number } {
    let calls = 0;
    const f: typeof globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('/v1/messages')) {
        calls += 1;
        if (calls > 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                type: 'error',
                error: { type: 'rate_limit_error', message: 'credit balance is too low' },
              }),
              { status: 429, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
      }
      return globalThis.fetch(input, init);
    };
    return { fetch: f, calls: () => calls };
  }

  it('el proveedor falla a mitad: el step FALLA (permanente, causa tipada) y NO pausa en CP3', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await seedSecretIfAbsent(db, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
      const batchId = await seedBatch();

      const { fetch: failing } = fetchFailingAfterFirstCall();
      const stepId = newUlid();
      const outputs: unknown[] = [];
      const ctx = {
        config: { batchId },
        runId: newUlid(),
        stepId,
        deps: [],
        collectOutput: (refs: unknown) => outputs.push(refs),
      };

      // 1+2+3. Se captura LA PRIMERA rejection (la de la rama de ESCRITURA — una segunda llamada
      // entraría por el reuso y probaría otro mensaje): PERMANENTE, con el recuento REAL y con el
      // fallo clasificado como del PROVEEDOR (`api_error`), no como uno de contenido. Esa distinción
      // es el invariante duro de la tarea: son diagnósticos OPUESTOS.
      const err = await makeExecutorWith(failing, db)(ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PermanentStepError);
      expect((err as Error).message).toMatch(/1\/2 guiones escritos/);
      expect((err as Error).message).toMatch(/PROVEEDOR \(api_error/);

      // La propiedad que gobierna el bug: NO se emitió artefacto ⇒ el step no puede quedar en
      // `waiting_approval` con `error = NULL` (el consumer solo pausa un step que RETORNA).
      expect(outputs).toHaveLength(0);

      // 4. Los guiones ya escritos (pagados) se CONSERVAN: el retry manual los reusa sin re-pagar.
      const { rows } = await tdb.pool.query<{ count: string }>('SELECT count(*) FROM ad_script');
      expect(Number(rows[0]?.count)).toBe(1);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('el retry COMPLETA el lote truncado (top-up): 2/2 sin re-pagar el guion que ya estaba', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await seedSecretIfAbsent(db, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
      const batchId = await seedBatch();

      // `retryStep` (failed→queued) CONSERVA el `step_run.id` ⇒ el retry entra por la rama de reuso
      // con las filas parciales delante. La Entrega de T5.11 nombra ESE retry como el camino de
      // vuelta: si el reuso se limitara a fallar, el lote quedaría en un callejón sin salida (nunca
      // completable por ningún camino del producto) y las 5 filas pagadas serían justo lo que lo
      // bloquea. Debe COMPLETARSE, y sin re-pagar lo que ya está escrito.
      const { fetch: failing } = fetchFailingAfterFirstCall();
      const stepId = newUlid();
      const ctx = {
        config: { batchId },
        runId: newUlid(),
        stepId,
        deps: [],
        collectOutput: () => undefined,
      };
      await expect(makeExecutorWith(failing, db)(ctx)).rejects.toBeInstanceOf(PermanentStepError);
      const truncated = await tdb.pool.query<{ count: string }>('SELECT count(*) FROM ad_script');
      expect(Number(truncated.rows[0]?.count)).toBe(1); // el lote quedó a medias, como en el run real

      // EL RETRY con el proveedor ya SANO. Se cuentan las llamadas: debe pedir SOLO el grupo que
      // falta (1), no re-escribir el lote entero — pagar dos veces por un guion ya pagado para
      // arreglar un bug de dinero sería contradecir la tarea.
      let calls = 0;
      const countingFetch: typeof globalThis.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes('/v1/messages')) calls += 1;
        return globalThis.fetch(input, init);
      };
      const outputs: unknown[] = [];
      const retryCtx = { ...ctx, collectOutput: (refs: unknown) => outputs.push(refs) };
      await makeExecutorWith(countingFetch, db)(retryCtx);

      expect(calls).toBe(1); // 1 grupo pendiente = 1 llamada (el otro NO se re-pide)

      // El lote quedó COMPLETO: 2 filas, una por variante (ni duplicados ni huecos).
      const { rows } = await tdb.pool.query<{ count: string }>('SELECT count(*) FROM ad_script');
      expect(Number(rows[0]?.count)).toBe(2);
      const perVariant = await tdb.pool.query<{ count: string }>(
        'SELECT count(*) FROM ad_script GROUP BY variant_id',
      );
      expect(perVariant.rows.every((r) => Number(r.count) === 1)).toBe(true);
      expect(perVariant.rows).toHaveLength(2);

      // Y AHORA SÍ se emite el artefacto (el step puede pausar en CP3), con las 2 refs: la reusada
      // + la recién escrita.
      expect(outputs).toHaveLength(1);
      expect((outputs[0] as N5Output).scriptRefs).toHaveLength(2);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('un retry que VUELVE a fallar sigue sin abrir CP3 (el lote sigue truncado)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await seedSecretIfAbsent(db, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
      const batchId = await seedBatch();

      const stepId = newUlid();
      const outputs: unknown[] = [];
      const ctx = {
        config: { batchId },
        runId: newUlid(),
        stepId,
        deps: [],
        collectOutput: (refs: unknown) => outputs.push(refs),
      };
      await expect(
        makeExecutorWith(fetchFailingAfterFirstCall().fetch, db)(ctx),
      ).rejects.toBeInstanceOf(PermanentStepError);

      // El retry entra por el top-up, pide el grupo que falta y el proveedor SIGUE caído (429 desde
      // la 1.ª llamada de este intento): el lote sigue a 1/2 ⇒ el step vuelve a `failed`, NO abre CP3.
      const stillDown: typeof globalThis.fetch = (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes('/v1/messages')) {
          return Promise.resolve(
            new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error' } }), {
              status: 429,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return globalThis.fetch(input);
      };
      await expect(makeExecutorWith(stillDown, db)(ctx)).rejects.toThrow(/1\/2 guiones escritos/);
      expect(outputs).toHaveLength(0);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('over_budget con el lote COMPLETO SÍ llega a CP3 (el gate no lo confunde con un fallo)', async () => {
    // `over_budget` devuelve el lote ENTERO y está DISEÑADO para que el usuario recorte en CP3
    // (script-writer.ts: «el usuario lo recorta en CP3»). Gatearlo por TIPO sería una regresión nueva:
    // un lote completo pero largo dejaría de poder recortarse. Solo los estados del PROVEEDOR fallan.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await seedSecretIfAbsent(db, 'anthropic', encryptSecret('fake-anthropic-key', secretsKey));
      const batchId = await seedBatch();

      // El fake escribe guiones válidos; para forzar `over_budget` sin tocar el servicio se hincha la
      // narración de la respuesta hasta que ningún recorte cabe en la ventana. Se interceptan las
      // respuestas de Anthropic y se alargan sus narraciones (el writer las temporiza y ve el
      // desbordamiento) — el guion sigue siendo CONTRACTUALMENTE válido, solo largo.
      const inflating: typeof globalThis.fetch = async (input, init) => {
        const res = await globalThis.fetch(input, init);
        const url = input instanceof Request ? input.url : input.toString();
        if (!url.includes('/v1/messages')) return res;
        const body = (await res.json()) as { content: { type: string; text?: string }[] };
        for (const block of body.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            block.text = block.text.replace(
              /"narration"\s*:\s*"([^"]*)"/g,
              (_m, t: string) => `"narration":"${t} ${'palabra '.repeat(120).trim()}"`,
            );
          }
        }
        return new Response(JSON.stringify(body), {
          status: res.status,
          headers: { 'content-type': 'application/json' },
        });
      };

      const outputs: unknown[] = [];
      const ctx = {
        config: { batchId },
        runId: newUlid(),
        stepId: newUlid(),
        deps: [],
        collectOutput: (refs: unknown) => outputs.push(refs),
      };
      await makeExecutorWith(inflating, db)(ctx);

      // NO lanzó: el artefacto se emitió con estado `over_budget` y las 2 refs ⇒ CP3 abre y el
      // usuario puede recortar. (Si el gate mirara «status !== scripted», esto sería un `failed`.)
      expect(outputs).toHaveLength(1);
      expect((outputs[0] as N5Output).status).toBe('over_budget');
      expect((outputs[0] as N5Output).scriptRefs).toHaveLength(2);
    } finally {
      await pool.end();
    }
  }, 30_000);
});
