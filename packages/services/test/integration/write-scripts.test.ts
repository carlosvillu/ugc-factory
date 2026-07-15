// Cadena COMPLETA de N5 (T2.4): el ScriptWriter llama a Sonnet 5 (HTTP mockeado con msw — CERO
// red real, cero gasto) → el servicio descifra la key de Anthropic (T0.14) y registra el
// `cost_entry` con el usage SUMADO de todas las llamadas del lote → se relee de la BD. Cierra el
// seam servicio→persistencia que el unit de core (que para en `ScriptWriterResult`) no cubre.
//
// EL INVARIANTE QUE PROTEGE: un lote de 12 guiones son VARIAS llamadas de pago (una por grupo, más
// reintentos). Si el servicio registrara solo el usage de la última, `/spend` mentiría por defecto
// justo en el paso más caro de F2.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProject, setSecretBlob } from '@ugc/db';
import { AdScriptSchema } from '@ugc/core/contracts';
import { composeMatrix } from '@ugc/core/strategy';
import { HOOK_LINE_SEEDS } from '@ugc/core/library';
import { deriveSecretsKey, encryptSecret } from '@ugc/core/secrets';
import {
  createTestDatabase,
  makeAngle,
  makeBrief,
  makeProject,
  server,
  type TestDatabase,
} from '@ugc/test-utils';

import { runWriteScripts } from '../../src/write-scripts';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const MESSAGES_ENDPOINT = `${ANTHROPIC_BASE}/v1/messages`;
const MASTER_KEY = 'test-master-key-for-write-scripts-suite';

let tdb: TestDatabase;
let secretsKey: Buffer;

const BRIEF = makeBrief({
  angles: [
    makeAngle({ name: 'El dolor de la piel tirante', framework: 'pain_point' }),
    makeAngle({ name: 'Lo que nadie te cuenta', framework: 'curiosity' }),
  ],
});

/** La matriz REAL de T2.2: 2 ángulos × 3 hooks × es+en = 12 variantes, objetivo `hook_test`
 *  (body y CTA compartidos por ángulo ⇒ 4 grupos ⇒ 4 llamadas de pago). */
const PLAN = composeMatrix({
  brief: BRIEF,
  libraryHooks: HOOK_LINE_SEEDS,
  angleCount: 2,
  hooksPerAngle: 3,
  languages: ['es', 'en'],
  objective: 'hook_test',
  tier: 'standard',
});

function draftResponse(nonce: number) {
  return {
    id: `msg_${String(nonce)}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          tone: 'cercano',
          hooks: [0, 1, 2].map((i) => ({
            seedIndex: i,
            narration: `Hook ${String(i)} llamada ${String(nonce)}`,
            visual: 'primer plano',
            camera: 'handheld',
            emotion: 'complicidad',
          })),
          body: [
            {
              narration: `Body ${String(nonce)} con el problema contado`,
              visual: 'plano medio',
              camera: 'panorámica lenta',
              emotion: 'confianza',
            },
          ],
          cta: [
            {
              narration: 'Link abajo',
              visual: 'producto en mano',
              camera: 'estática',
              emotion: 'entusiasmo',
            },
          ],
        }),
      },
    ],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 5_000,
      output_tokens: 800,
      cache_creation_input_tokens: nonce === 1 ? 4_000 : 0,
      cache_read_input_tokens: nonce === 1 ? 0 : 4_000,
    },
  };
}

async function seedProject(): Promise<string> {
  const project = await createProject(tdb.db, makeProject({ name: 'Chain T2.4' }));
  return project.id;
}

async function anthropicCostsFor(
  projectId: string,
): Promise<{ amount_cents: number; quantity: number | null; unit: string | null }[]> {
  const { rows } = await tdb.pool.query<{
    amount_cents: number;
    quantity: number | null;
    unit: string | null;
  }>(
    `select amount_cents, quantity, unit from cost_entry where provider = 'anthropic' and project_id = $1`,
    [projectId],
  );
  return rows;
}

beforeAll(async () => {
  tdb = await createTestDatabase();
  secretsKey = deriveSecretsKey(MASTER_KEY);
  await setSecretBlob(tdb.db, 'anthropic', encryptSecret('sk-ant-fake-for-tests', secretsKey));
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
});

describe('runWriteScripts — 12 guiones válidos + el cost_entry de TODAS las llamadas', () => {
  it('emite 12 AdScript que validan contra Zod y registra el usage SUMADO de los 4 grupos', async () => {
    const projectId = await seedProject();
    let calls = 0;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        calls += 1;
        return HttpResponse.json(draftResponse(calls));
      }),
    );

    const res = await runWriteScripts(
      { db: tdb.db, secretsKey, anthropicBaseUrl: ANTHROPIC_BASE },
      { projectId, plan: PLAN, brief: BRIEF },
    );

    expect(res.status).toBe('scripted');
    expect(res.scripts).toHaveLength(12);
    for (const script of res.scripts) {
      expect(AdScriptSchema.safeParse(script).success).toBe(true);
      // La cláusula determinista de la Verificación: est_seconds ≤ duración objetivo, en TODOS.
      expect(script.estSeconds).toBeLessThanOrEqual(PLAN.durationTargetSeconds);
    }
    // 4 grupos (2 ángulos × 2 idiomas), no 12: la economía del modo hook-testing.
    expect(calls).toBe(4);

    const entries = await anthropicCostsFor(projectId);
    // UNA fila con el total del lote: el usage viene ya sumado del guionista.
    expect(entries).toHaveLength(1);
    expect(entries[0]?.unit).toBe('tokens');
    // 4 × (5.000 in + 800 out) + 4.000 de escritura de caché + 3 × 4.000 de lectura.
    expect(entries[0]?.quantity).toBe(4 * 5_000 + 4 * 800 + 4_000 + 3 * 4_000);
    expect(Number.isInteger(entries[0]?.amount_cents)).toBe(true);
  });

  it('sin key de Anthropic no hay paso de IA: lanza con el caller en el mensaje', async () => {
    const projectId = await seedProject();
    await expect(
      runWriteScripts(
        { db: tdb.db, secretsKey: deriveSecretsKey('otra-master-key-distinta-de-la-buena') },
        { projectId, plan: PLAN, brief: BRIEF },
      ),
    ).rejects.toThrow();
  });
});
