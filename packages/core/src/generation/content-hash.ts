// content_hash de una generación (§9.6 dedupe) — LÓGICA PURA, sin red, sin BD.
//
// DOS generaciones con el MISMO (resolved_prompt, model_profile_id, inputs) producen el
// mismo output → se pueden deduplicar. T4.1 deja la BASE: el cálculo determinista del
// hash + su columna. La lógica de dedup COMPLETA (buscar una generación previa con el
// mismo hash y REUTILIZAR su asset) es deuda de F4/F5 — no se construye aquí.
//
// DETERMINISMO ES EL CONTRATO: el hash NO puede depender del orden de las claves de
// `inputs` (un objeto `{a,b}` y `{b,a}` son la misma entrada). Por eso se serializa con
// las claves ORDENADAS recursivamente antes de hashear — el mismo fixpoint que el golden
// de adapters. sha256 hex.
import { createHash } from 'node:crypto';

/** Los inputs de una generación: JSON arbitrario (imágenes de ref, params del modelo). */
export type GenerationInputs = Record<string, unknown>;

export interface ContentHashInput {
  resolvedPrompt: string;
  modelProfileId: string;
  inputs: GenerationInputs;
}

/** Ordena las claves de un valor JSON recursivamente. Un objeto reordenado produce la
 *  MISMA serialización → el mismo hash. Los arrays conservan su orden (es significativo). */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Calcula el `content_hash` determinista de una generación (§9.6). El material hasheado es
 * el JSON canónico de los tres campos que determinan el output: prompt resuelto, modelo e
 * inputs (con claves ordenadas). Reordenar `inputs` NO cambia el hash; cambiar cualquiera
 * de los tres campos SÍ. sha256 en hex (64 chars).
 */
export function computeContentHash(input: ContentHashInput): string {
  const canonical = JSON.stringify({
    resolvedPrompt: input.resolvedPrompt,
    modelProfileId: input.modelProfileId,
    inputs: sortDeep(input.inputs),
  });
  return createHash('sha256').update(canonical).digest('hex');
}
