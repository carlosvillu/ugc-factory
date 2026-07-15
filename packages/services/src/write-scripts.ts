// Servicio de escritura de guiones (T2.4, N5): la superficie INVOCABLE que ejecuta el
// ScriptWriter y persiste su COSTE. Orquesta core (`makeScriptWriter` — solo red/CPU: las
// llamadas a Sonnet 5, el parse, el timing) + la capa db (leer la key descifrada de secretos
// T0.14, registrar el `cost_entry`). Espeja `synthesize-brief.ts` (T1.8, N3) línea por línea: N5
// es el mismo TIPO de pieza que N3.
//
// QUÉ **NO** HACE: persistir las filas de `ad_script`. Igual que N3 devuelve el `ProductBrief` sin
// escribirlo (lo escribe el efecto de dominio del checkpoint), N5 devuelve los `AdScript[]` y
// quien los persista —el panel de CP3 (T2.6), que es quien tiene los `ad_variant.id` delante y el
// versionado (`version`, `edited_by_user`)— los escribirá. Un servicio que escribiera filas aquí
// tendría que inventarse el emparejamiento variante↔guion, y ya existe: `filenameCode`.
//
// COST_ENTRY (record-first, disciplina de T1.4): tras las llamadas se registra el gasto desde
// `usage`. provider='anthropic', unit='tokens'. Se registra INCLUSO en refusal/parse_error (se
// pagaron los tokens). El `usage` que llega ya viene SUMADO de todas las llamadas del lote
// (una por grupo + reintentos) — el ledger cuenta TODO lo gastado, no lo que salió bien.
import type { ProductBrief, BatchPlan, AdScript } from '@ugc/core/contracts';
import { makeScriptWriter, SCRIPT_WRITER_MODEL } from '@ugc/core/scripting';
import type { AnthropicUsage } from '@ugc/core/analyze';
import type { DbClient } from '@ugc/db';

import { loadAnthropicKey, recordAnthropicCost } from './anthropic-service';

/** Timeout por LLAMADA (ms). Un grupo de hook-testing emite 1 body + 1 cta + N hooks: menos
 *  salida que un ProductBrief entero, pero holgado igual — el coste de un timeout corto es una
 *  llamada pagada y tirada. */
const SCRIPT_TIMEOUT_MS = 120_000;

export interface WriteScriptsDeps {
  db: DbClient;
  /** Clave descifrante de secretos (T0.14) — derivada de la master key en el caller. */
  secretsKey: Buffer;
  /** `fetch` inyectable (msw en tests); default global en producción (lo captura el SDK). */
  fetch?: typeof globalThis.fetch;
  /** Override del base URL de la API de Anthropic (tests legibles con msw). */
  anthropicBaseUrl?: string;
  timeoutMs?: number;
}

export interface WriteScriptsServiceInput {
  projectId: string;
  /** El plan de N4 (T2.2), tal cual se persistió en `ad_batch.matrix`. */
  plan: BatchPlan;
  /** El brief que originó el plan (T1.8), en el idioma del ANÁLISIS — no necesariamente el de las
   *  variantes: el idioma destino de cada guion lo manda `PlannedVariant.language` (§17). */
  brief: ProductBrief;
  /** El step que originó el gasto (T1.10b): atribuye el `cost_entry` a `step_run_id`. Opcional. */
  stepRunId?: string;
}

export interface WriteScriptsResult {
  /** Un guion por variante del plan (vacío si todo falló; parcial si falló un grupo). */
  scripts: AdScript[];
  status: string;
  usage: AnthropicUsage | null;
  warnings: string[];
}

/**
 * Escribe los guiones del lote y registra su coste. SIEMPRE devuelve un resultado (el guionista
 * nunca lanza por refusal ni por respuesta inválida: estado tipado). Los guardrails FTC y el
 * linter de claims (§15) son T2.5 — no se hacen aquí.
 */
export async function runWriteScripts(
  deps: WriteScriptsDeps,
  input: WriteScriptsServiceInput,
): Promise<WriteScriptsResult> {
  const { db, secretsKey } = deps;
  const apiKey = await loadAnthropicKey(db, secretsKey, 'write-scripts');

  const writer = makeScriptWriter({
    apiKey,
    fetch: deps.fetch,
    baseURL: deps.anthropicBaseUrl,
    timeoutMs: deps.timeoutMs ?? SCRIPT_TIMEOUT_MS,
  });

  const result = await writer.write({ plan: input.plan, brief: input.brief });

  const warnings = [...result.warnings];
  if (result.usage) {
    const warning = await recordAnthropicCost(db, {
      model: SCRIPT_WRITER_MODEL,
      usage: result.usage,
      projectId: input.projectId,
      stepRunId: input.stepRunId,
    });
    if (warning) warnings.push(warning);
  }

  return {
    scripts: result.scripts,
    status: result.status,
    usage: result.usage,
    warnings,
  };
}
