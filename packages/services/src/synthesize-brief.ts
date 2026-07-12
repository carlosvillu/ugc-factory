// Servicio de síntesis del brief (T1.8, N3): la superficie INVOCABLE que ejecuta el paso P4 y
// persiste su coste. Orquesta core (`makeBriefSynthesizer` — solo red/CPU: la llamada a Sonnet 5,
// el truncado y el parse) + la capa db (leer la key descifrada de secretos T0.14, registrar el
// `cost_entry`). Vive en `@ugc/services` (T1.10a): cablea, no contiene lógica de negocio. Lo
// consume el executor del nodo N3 del worker. Espeja `visual-analyze.ts` (T1.7) y
// `firecrawl-ingest.ts` (T1.4).
//
// COST_ENTRY (record-first, disciplina de T1.4): tras la llamada se registra el gasto desde
// `usage`. provider='anthropic', unit='tokens'. Se registra INCLUSO en refusal/parse_error (se
// pagaron los tokens); el precio lo pone la tabla COMPARTIDA `anthropic-pricing.ts`, que es
// CONSCIENTE DE LA CACHÉ (cache_read a 0,1×): a partir de la 2ª síntesis la mayor parte del input
// llega cacheado, y facturarlo a precio completo sobre-reportaría el gasto en `/spend`.
import {
  makeBriefSynthesizer,
  BRIEF_SYNTHESIZER_MODEL,
  type AnthropicUsage,
} from '@ugc/core/analyze';
import type { ProductBrief, RawContent, VisualAnalysis } from '@ugc/core/contracts';
import type { DbClient } from '@ugc/db';

import { loadAnthropicKey, recordAnthropicCost } from './anthropic-service';

/** Timeout de la síntesis (ms). Un ProductBrief entero con Sonnet 5 puede tardar bastante más que
 *  una clasificación de imágenes: 180 s es holgado y sigue acotando un cuelgue. */
const SYNTHESIS_TIMEOUT_MS = 180_000;

export interface SynthesizeBriefDeps {
  db: DbClient;
  /** Clave descifrante de secretos (T0.14) — derivada de la master key en el caller. */
  secretsKey: Buffer;
  /** `fetch` inyectable (msw en tests); default global en producción (lo captura el SDK). */
  fetch?: typeof globalThis.fetch;
  /** Override del base URL de la API de Anthropic (tests legibles con msw). */
  anthropicBaseUrl?: string;
  timeoutMs?: number;
}

export interface SynthesizeBriefInput {
  projectId: string;
  /** El RawContent del análisis (T1.4 url / T1.6 manual, con el mini-crawl de T1.5 apendado). */
  raw: RawContent;
  /** El VisualAnalysis de N3 (T1.7). null si el paso de visión se saltó (sin imágenes). */
  visualAnalysis?: VisualAnalysis | null;
  /** Idioma de ANÁLISIS (Entrega de T1.8: "en el idioma de análisis"). */
  targetLanguage: string;
  /** Marca ISO-8601 de la extracción. Inyectable para determinismo en tests. */
  extractedAt?: string;
  /** El step que originó el gasto (T1.10b): atribuye el `cost_entry` a `step_run_id`. OPCIONAL
   *  — el servicio también se invoca fuera de un run (ahí la columna queda NULL, correcto). */
  stepRunId?: string;
}

export interface SynthesizeBriefResult {
  /** El brief validado, o null si hubo refusal / parse_error (el flujo NO crashea). */
  brief: ProductBrief | null;
  status: string;
  usage: AnthropicUsage | null;
  warnings: string[];
}

/**
 * Ejecuta la síntesis N3 y persiste su coste. SIEMPRE devuelve un resultado (el sintetizador
 * nunca lanza por refusal ni por respuesta inválida: estado tipado). La validación DETERMINISTA
 * de negocio (precio N1==N3, hero image, hooks ≤12 palabras, suggested_assets ⊆ assets.images) es
 * T1.9 — NO se hace aquí.
 */
export async function runSynthesizeBrief(
  deps: SynthesizeBriefDeps,
  input: SynthesizeBriefInput,
): Promise<SynthesizeBriefResult> {
  const { db, secretsKey } = deps;
  const apiKey = await loadAnthropicKey(db, secretsKey, 'synthesize-brief');

  const synthesizer = makeBriefSynthesizer({
    apiKey,
    fetch: deps.fetch,
    baseURL: deps.anthropicBaseUrl,
    timeoutMs: deps.timeoutMs ?? SYNTHESIS_TIMEOUT_MS,
  });

  const result = await synthesizer.synthesize({
    raw: input.raw,
    visualAnalysis: input.visualAnalysis ?? null,
    targetLanguage: input.targetLanguage,
    extractedAt: input.extractedAt ?? new Date().toISOString(),
  });

  // cost_entry: SOLO si hubo llamada con usage medible. En refusal/parse_error CON usage SÍ se
  // registra (se pagaron los tokens; record-first). El invariante "tras una llamada de pago SIEMPRE
  // hay cost_entry" lo garantiza `recordAnthropicCost`, que nunca lanza (plomería compartida con
  // T1.7 — un throw aquí perdería la fila de un gasto YA realizado).
  const warnings = [...result.warnings];
  if (result.usage) {
    const warning = await recordAnthropicCost(db, {
      model: BRIEF_SYNTHESIZER_MODEL,
      usage: result.usage,
      projectId: input.projectId,
      stepRunId: input.stepRunId,
    });
    if (warning) warnings.push(warning);
  }

  return {
    brief: result.brief,
    status: result.status,
    usage: result.usage,
    warnings,
  };
}
