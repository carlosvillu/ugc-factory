// Pricing de Anthropic → `cost_entry` (T1.8). Extraído de `visual-analyze.ts` (T1.7), que lo
// llevaba embebido y hardcodeado a Haiku: con T1.8 hay DOS modelos (Haiku 4.5 para visión, Sonnet
// 5 para síntesis) y el coste debe ser POR MODELO. Duplicarlo habría dejado dos tablas de precios
// derivando por su cuenta — y el precio es lo que la Verificación mide en `/spend`.
//
// VIVE EN LA CAPA WEB, NO EN CORE: el precio y el `cost_entry` son I/O de datos (persistencia),
// la frontera prohibida de core (architecture §1). Core solo devuelve `AnthropicUsage` (tokens).
import type { AnthropicUsage } from '@ugc/core/analyze';

/** Precio de un modelo en DÓLARES por millón de tokens (skill claude-api, tabla de modelos). */
interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Tabla de precios por modelo. Los dos que el pipeline de análisis usa hoy. */
const PRICING: Record<string, ModelPricing> = {
  // Visión (T1.7 VisualAnalyzer).
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  // Síntesis (T1.8 BriefSynthesizer). Precio de lista; el intro ($2/$10 hasta 2026-08-31) es
  // MÁS BARATO — se factura el de lista para no INFRA-reportar nunca el gasto (conservador).
  'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
};

/** Multiplicadores del prompt caching (skill claude-api, prompt-caching §):
 *  escribir la caché cuesta 1,25× el input; leerla, 0,1×. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Coste de una llamada, CONSCIENTE DE LA CACHÉ, junto al aviso de si el modelo tenía precio.
 *
 * INVARIANTE DE DINERO (disciplina record-first de T1.4, regla de trabajo 5 del planning): tras una
 * llamada de pago con `usage` SIEMPRE tiene que haber `cost_entry`. Por eso un modelo AUSENTE de la
 * tabla NO lanza: si lanzase, la excepción subiría por el caller DESPUÉS de que la llamada de pago
 * ya se hizo, `recordCost` no llegaría a ejecutarse, y el resultado sería dinero gastado de verdad
 * con CERO filas en `/spend` — justo la desviación que el ledger existe para impedir. Un precio que
 * no conocemos degrada a $0 con un `warning` OBSERVABLE, y la fila se registra igualmente: la verdad
 * granular del ledger es `quantity` (tokens reales, T0.12), que sí es correcta pase lo que pase.
 * Perder el importe es malo; perder la fila entera es peor e irrecuperable.
 */
export interface AnthropicCost {
  usd: number;
  cents: number;
  /** Tokens facturables reales — SIEMPRE correcto, aunque el modelo no tenga precio. */
  billedTokens: number;
  /** Aviso si el modelo no está en la tabla (coste degradado a 0). null si todo normal. */
  warning: string | null;
}

/** Coste en DÓLARES (float) de una llamada, CONSCIENTE DE LA CACHÉ. Es la unidad con la que se
 *  razona el bound "<$0,15/brief" de la Verificación.
 *
 *  Por qué la caché IMPORTA aquí y no importaba en T1.7: el system del sintetizador se cachea de
 *  verdad (>4096 tokens, prefijo byte-estable), así que a partir de la 2ª llamada la MAYOR PARTE
 *  del input llega como `cache_read` — a 0,1×. Facturarlo a precio completo (como hacía T1.7, que
 *  nunca cacheaba y por tanto tenía cache_*=0) SOBRE-reportaría el gasto y podría hacer FALLAR el
 *  check de `/spend` sobre un brief que realmente cuesta menos.
 *
 *  Modelo sin precio → 0 (ver `AnthropicCost`: el gasto NUNCA tumba el registro). */
export function anthropicUsageToUsd(model: string, usage: AnthropicUsage): number {
  const pricing = PRICING[model];
  if (pricing === undefined) return 0;

  const inputUsd =
    (usage.inputTokens * pricing.inputPerMTok) / 1e6 +
    (usage.cacheCreationInputTokens * pricing.inputPerMTok * CACHE_WRITE_MULTIPLIER) / 1e6 +
    (usage.cacheReadInputTokens * pricing.inputPerMTok * CACHE_READ_MULTIPLIER) / 1e6;
  const outputUsd = (usage.outputTokens * pricing.outputPerMTok) / 1e6;
  return inputUsd + outputUsd;
}

/** `amount_cents` ENTERO del `cost_entry` (invariante duro del ledger: NUNCA float). La VERDAD
 *  granular vive en `quantity` (tokens). Se redondea al céntimo. */
export function anthropicUsageToCents(model: string, usage: AnthropicUsage): number {
  return Math.round(anthropicUsageToUsd(model, usage) * 100);
}

/**
 * Punto de entrada ÚNICO para el caller que va a registrar el `cost_entry`: devuelve todo lo que
 * `recordCost` necesita y NUNCA lanza. Si el modelo no tiene precio, `warning` lo dice y el importe
 * es 0, pero `billedTokens` sigue siendo la verdad — la fila se escribe igual.
 */
export function anthropicCostOf(model: string, usage: AnthropicUsage): AnthropicCost {
  const known = PRICING[model] !== undefined;
  return {
    usd: anthropicUsageToUsd(model, usage),
    cents: anthropicUsageToCents(model, usage),
    billedTokens: anthropicBilledTokens(usage),
    warning: known
      ? null
      : `anthropic-pricing: modelo SIN PRECIO en la tabla (${model}): el cost_entry se registra ` +
        'con amount_cents=0 y quantity=tokens reales. Anade su precio para no infra-reportar /spend.',
  };
}

/** `quantity` del cost_entry: TODOS los tokens facturables de la llamada (unit='tokens'). Incluye
 *  los de caché — se facturaron, aunque a otro precio. */
export function anthropicBilledTokens(usage: AnthropicUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  );
}
