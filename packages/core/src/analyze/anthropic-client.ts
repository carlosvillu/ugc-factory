// Cliente Anthropic COMPARTIDO por los dos pasos de IA del análisis (T1.7 VisualAnalyzer con
// Haiku 4.5, T1.8 BriefSynthesizer con Sonnet 5). Extraído en T1.8 de `visual-analyzer.ts`, que
// lo llevaba embebido: duplicarlo habría dejado dos construcciones del cliente y dos mapeos de
// `usage` derivando por su cuenta.
//
// Qué vive AQUÍ (core, red/CPU): construir el cliente y normalizar el `usage` de la respuesta.
// Qué NO: el precio en céntimos y el `cost_entry` (eso es I/O de datos → capa servicio de web,
// architecture §1). La `apiKey` llega EN CLARO (el caller la descifra de secretos T0.14).
import Anthropic from '@anthropic-ai/sdk';

/** Timeout duro por defecto de una llamada (ms). Una request colgada dejaría el paso sin señal;
 *  el SDK ya reintenta 429/5xx internamente (maxRetries=2). */
export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 60_000;

/** Deps comunes de todo cliente Anthropic de core. Espeja `FirecrawlDeps` (T1.4): `apiKey` en
 *  claro, `fetch`/`baseURL` inyectables para msw en tests, `timeoutMs` override. */
export interface AnthropicDeps {
  apiKey: string;
  /** `fetch` inyectable. El SDK lo captura AL CONSTRUIR el cliente; por eso el cliente se
   *  construye EN CADA llamada (no al hacer la factory), para que msw —que reemplaza el global
   *  tras construir la factory— intercepte (mismo razonamiento perezoso que T1.3/T1.4). */
  fetch?: typeof globalThis.fetch;
  /** Override del base URL de la API (tests legibles con msw). */
  baseURL?: string;
  timeoutMs?: number;
}

/** Uso de tokens de una llamada, tal cual lo reporta `response.usage`. El caller (servicio de
 *  web) lo convierte a `cost_entry`. Los 4 campos que importan para el coste con prompt caching
 *  (skill claude-api, usage §): los `cache_*` pueden venir null en el tipo del SDK y se colapsan
 *  a 0 aquí para mantener el contrato entero. */
export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Construye el cliente. SIEMPRE en la llamada, nunca en la factory: el SDK captura `fetch` al
 * construir y msw reemplaza el global DESPUÉS de que la factory exista.
 */
export function makeAnthropicClient(deps: AnthropicDeps): Anthropic {
  return new Anthropic({
    apiKey: deps.apiKey,
    ...(deps.baseURL !== undefined ? { baseURL: deps.baseURL } : {}),
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    timeout: deps.timeoutMs ?? DEFAULT_ANTHROPIC_TIMEOUT_MS,
  });
}

/** Forma mínima del `usage` de la Messages API (lo que necesitamos de él). */
interface RawUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Normaliza `response.usage` al contrato `AnthropicUsage` (nulls → 0). */
export function toAnthropicUsage(usage: RawUsage): AnthropicUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}

/** Suma el consumo de dos llamadas. Las dos se pagaron: el total es lo que va al ledger. Vive aquí
 *  (junto a `AnthropicUsage`) porque lo comparten todos los nodos que hacen ≥1 llamada con reintento
 *  — N3 (`brief-synthesizer`) y N5 (`script-writer`). */
export function sumAnthropicUsage(
  a: AnthropicUsage | null,
  b: AnthropicUsage | null,
): AnthropicUsage | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}
