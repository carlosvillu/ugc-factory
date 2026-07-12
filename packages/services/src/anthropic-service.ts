// Plomería COMPARTIDA de los pasos de Anthropic en `@ugc/services` (T1.8): leer la key de
// secretos y registrar el `cost_entry`. La consumen el VisualAnalyzer (T1.7, Haiku) y el
// BriefSynthesizer (T1.8, Sonnet 5), y la consumirá todo paso de IA de Anthropic que venga.
// (Nació en la capa server de web; se movió al paquete en T1.10a, cuando el worker pasó a
// ejecutar estos mismos pasos desde sus executors.)
//
// POR QUÉ EXISTE: el invariante de dinero —tras una llamada de pago con `usage` SIEMPRE hay
// `cost_entry`— es demasiado importante para vivir replicado en cada servicio. T1.8 extrajo el
// cliente (core) y la tabla de precios; esto extrae la capa que de verdad se repetía.
//
// NO se fusiona con `firecrawl-ingest.ts`: Firecrawl factura CRÉDITOS con un `provider` distinto y
// un importe sub-céntimo. Es otro dominio de facturación, y meterlo aquí sería la
// sobre-generalización contraria.
import type { AnthropicUsage } from '@ugc/core/analyze';
import { decryptSecret, type SecretBlob } from '@ugc/core/secrets';
import { getSecretBlob, recordCost, type DbClient } from '@ugc/db';

import { anthropicCostOf } from './anthropic-pricing';

/**
 * Lee y descifra la API key de Anthropic (secretos T0.14). Lanza si no hay key: sin key no hay
 * paso de IA, y a diferencia de Firecrawl no existe fallback. `caller` solo da contexto al error.
 */
export async function loadAnthropicKey(
  db: DbClient,
  secretsKey: Buffer,
  caller: string,
): Promise<string> {
  const blob = await getSecretBlob(db, 'anthropic');
  if (blob === undefined || blob === null) {
    throw new Error(`${caller}: no hay API key de Anthropic configurada (T0.14)`);
  }
  return decryptSecret(blob as SecretBlob, secretsKey);
}

/**
 * Registra el `cost_entry` de una llamada a Anthropic y devuelve el warning si el modelo no tenía
 * precio (null si todo normal). El caller lo añade a sus warnings observables.
 *
 * EL INVARIANTE VIVE AQUÍ: esta función NUNCA lanza por un precio desconocido. Un throw ocurriría
 * DESPUÉS de que la llamada de pago ya se hizo → `recordCost` no se ejecutaría y el gasto real
 * quedaría sin fila en `/spend` (rompe la disciplina record-first de T1.4). Perder el importe es
 * malo; perder el registro entero de un gasto real es peor e irrecuperable — `quantity` (tokens)
 * sigue siendo la verdad granular del ledger (T0.12) pase lo que pase.
 */
export async function recordAnthropicCost(
  db: DbClient,
  args: {
    model: string;
    usage: AnthropicUsage;
    projectId: string;
    /**
     * El step del pipeline que originó este gasto (T1.10b). OPCIONAL a propósito: los servicios
     * también se invocan FUERA de un run (p. ej. `PATCH /api/briefs/:id` edita un brief sin run
     * activo) y ahí no hay step al que atribuir el cargo — la columna queda NULL, que es la
     * verdad, no un hueco.
     *
     * Con él, `cost_entry.step_run_id` deja de ser siempre NULL y el orquestador puede hacer el
     * rollup a `step_run.cost_actual` (`rollupStepCost`) — el KPI "coste real" del canvas, que
     * hasta T1.10b mostraba $0,00 con dinero realmente gastado.
     */
    stepRunId?: string;
  },
): Promise<string | null> {
  const cost = anthropicCostOf(args.model, args.usage);
  await recordCost(db, {
    provider: 'anthropic',
    amountCents: cost.cents,
    quantity: cost.billedTokens,
    unit: 'tokens',
    projectId: args.projectId,
    stepRunId: args.stepRunId,
  });
  return cost.warning;
}
