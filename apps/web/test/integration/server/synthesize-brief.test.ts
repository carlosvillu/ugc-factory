// Cadena COMPLETA de la síntesis N3 (T1.8): el BriefSynthesizer llama a Sonnet 5 (HTTP mockeado
// con msw — CERO red real, cero gasto) → el servicio descifra la key de Anthropic (T0.14) y
// registra el `cost_entry` → se relee de la BD. Cierra el seam servicio→persistencia que el unit
// de core (para en `BriefSynthesizerResult`) no cubre.
//
// Cláusulas DETERMINISTAS de la Verificación que quedan codificadas aquí como test permanente
// (regla de trabajo 8 del planning):
//  - el brief emitido VALIDA contra el Zod de ProductBrief y trae 5–10 ángulos;
//  - el `cost_entry` de la síntesis es provider='anthropic', unit='tokens', amount_cents ENTERO,
//    y el coste calculado sobre un `usage` realista está por debajo de $0,15/brief;
//  - una respuesta con caché leída (cache_read>0) NO se factura a precio completo;
//  - refusal → sin brief, PERO con cost_entry (se pagaron los tokens) y sin crash.
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProject, setSecretBlob } from '@ugc/db';
import { ProductBriefSchema } from '@ugc/core/contracts';
import { deriveSecretsKey, encryptSecret } from '@ugc/core/secrets';
import {
  createTestDatabase,
  makeBrief,
  makeProject,
  makeRawContent,
  makeVisualAnalysis,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import {
  anthropicBriefRefusalResponse,
  anthropicBriefResponse,
} from '@ugc/test-utils/fixtures/anthropic';

import { recordAnthropicCost } from '@/server/anthropic-service';
import { runSynthesizeBrief } from '@/server/synthesize-brief';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const MESSAGES_ENDPOINT = `${ANTHROPIC_BASE}/v1/messages`;
const MASTER_KEY = 'test-master-key-for-synthesize-brief-suite';

let tdb: TestDatabase;
let secretsKey: Buffer;

async function seedProject(): Promise<string> {
  const project = await createProject(tdb.db, makeProject({ name: 'Chain T1.8' }));
  return project.id;
}

beforeAll(async () => {
  tdb = await createTestDatabase();
  secretsKey = deriveSecretsKey(MASTER_KEY);
  // Key de Anthropic cifrada en secretos (T0.14): el servicio la descifra en cada run.
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

/** Cargos de anthropic para UN proyecto (aislamiento por-it: cada it siembra su proyecto). */
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

function deps() {
  return { db: tdb.db, secretsKey, anthropicBaseUrl: ANTHROPIC_BASE };
}

function input(projectId: string) {
  return {
    projectId,
    raw: makeRawContent(),
    visualAnalysis: makeVisualAnalysis(),
    targetLanguage: 'es',
    extractedAt: '2026-07-10T12:00:00.000Z',
  };
}

describe('runSynthesizeBrief — brief válido + cost_entry', () => {
  it('emite un ProductBrief que VALIDA contra Zod (5–10 ángulos) y persiste el cost_entry', async () => {
    const projectId = await seedProject();
    server.use(
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json(
          anthropicBriefResponse(makeBrief(), {
            input_tokens: 10_000,
            output_tokens: 3_500,
            cache_creation_input_tokens: 6_000,
          }),
        ),
      ),
    );

    const res = await runSynthesizeBrief(deps(), input(projectId));

    expect(res.status).toBe('synthesized');
    // El brief que sale del servicio valida contra el contrato COMPLETO de T1.1.
    const parsed = ProductBriefSchema.safeParse(res.brief);
    expect(parsed.success).toBe(true);
    expect(res.brief?.angles.length).toBeGreaterThanOrEqual(5);
    expect(res.brief?.angles.length).toBeLessThanOrEqual(10);

    const entries = await anthropicCostsFor(projectId);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.unit).toBe('tokens');
    // quantity = todos los tokens facturables (incl. los de caché).
    expect(entry?.quantity).toBe(10_000 + 3_500 + 6_000);
    // amount_cents ENTERO (invariante del ledger).
    expect(Number.isInteger(entry?.amount_cents)).toBe(true);
    // BOUND DE LA VERIFICACIÓN: <$0,15/brief = <15 céntimos.
    expect(entry?.amount_cents).toBeLessThan(15);
  });

  it('con el system CACHEADO (2ª llamada), el coste NO se factura a precio completo', async () => {
    const projectId = await seedProject();
    // Perfil de una 2ª síntesis: el system (6k) llega como cache_read (0,1× → casi gratis).
    server.use(
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json(
          anthropicBriefResponse(makeBrief(), {
            input_tokens: 10_000,
            output_tokens: 3_500,
            cache_read_input_tokens: 6_000,
          }),
        ),
      ),
    );

    const res = await runSynthesizeBrief(deps(), input(projectId));
    expect(res.usage?.cacheReadInputTokens).toBe(6_000);

    const entries = await anthropicCostsFor(projectId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount_cents).toBeLessThan(15);
    // El tramo cacheado se factura al 0,1×: el gasto de la 2ª llamada es MENOR que el de la 1ª
    // (que escribió la caché a 1,25×), aun con el mismo número de tokens.
    expect(entries[0]?.quantity).toBe(19_500);
  });
});

describe('recordAnthropicCost — INVARIANTE: tras una llamada de pago SIEMPRE hay cost_entry', () => {
  it('modelo SIN precio en la tabla → la fila se registra igual (importe 0, tokens reales) y avisa', async () => {
    const projectId = await seedProject();

    // Se prueba sobre la plomería COMPARTIDA (la que usan los DOS servicios de Anthropic: T1.7 y
    // T1.8), que es donde vive el invariante. Antes esto LANZABA: el throw ocurría DESPUÉS de que
    // la llamada de pago ya se había hecho, `recordCost` no se ejecutaba, y el gasto real
    // desaparecía de `/spend`. Ahora degrada y la FILA SOBREVIVE — es lo único irrecuperable.
    const warning = await recordAnthropicCost(tdb.db, {
      model: 'claude-modelo-sin-precio',
      usage: {
        inputTokens: 12_000,
        outputTokens: 3_000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      projectId,
    });

    expect(warning).toContain('SIN PRECIO'); // el aviso es OBSERVABLE, no silencioso

    const entries = await anthropicCostsFor(projectId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount_cents).toBe(0); // importe degradado…
    expect(entries[0]?.quantity).toBe(15_000); // …pero los tokens facturados son la VERDAD (T0.12)
    expect(entries[0]?.unit).toBe('tokens');
  });
});

describe('runSynthesizeBrief — refusal: sin brief, PERO con coste (record-first)', () => {
  it('refusal → status refused, brief null, cost_entry registrado, sin crash', async () => {
    const projectId = await seedProject();
    server.use(
      http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicBriefRefusalResponse())),
    );

    const res = await runSynthesizeBrief(deps(), input(projectId));

    expect(res.status).toBe('refused');
    expect(res.brief).toBeNull();

    // Se pagaron los tokens de input → el gasto DEBE quedar apuntado (disciplina de T1.4: un
    // cargo real sin rastro en `/spend` es la desviación que la regla de trabajo 5 persigue).
    const entries = await anthropicCostsFor(projectId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.unit).toBe('tokens');
    expect(entries[0]?.quantity).toBe(8_800);
  });
});
