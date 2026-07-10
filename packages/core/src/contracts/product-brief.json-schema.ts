// Espejo JSON Schema del ProductBrief para el `output_config` de Anthropic
// (architecture.md §4, T1.1). Se genera con `z.toJSONSchema()` (Zod 4) y se
// post-procesa con `toAnthropicJsonSchema` — un helper PURO de core.
//
// El espejo diverge del Zod A PROPÓSITO (Apéndice A, divergencia 3):
//   - `additionalProperties: false` en TODO objeto (la API de Anthropic lo EXIGE).
//   - SIN constraints que Anthropic IGNORA (research/07 §4.2: `minimum`/`maxLength`…):
//     los de array (`minItems`/`maxItems`), los numéricos (`minimum`/`maximum`/
//     `exclusiveMinimum`/`exclusiveMaximum`/`multipleOf`) y los de string
//     (`minLength`/`maxLength`). Dejarlos haría que el espejo MINTIERA — las reglas
//     viven SOLO en Zod (el `safeParse` post-llamada es la red real).
//     Caso concreto: `z.number().int()` emite `minimum/maximum` con los bounds de
//     safe-integer (±9007199254740991); Anthropic los ignora → se podan.
// Tampoco lleva el bicondicional source_url↔manual: los `.superRefine` de Zod no se
// representan en JSON Schema, así que esa regla también es exclusiva de Zod. Es
// correcto y coherente con el reparto de responsabilidades: el espejo describe la
// FORMA; el `safeParse` tras la llamada aplica las REGLAS (unit-core.md §3).
//
// Recuerda las limitaciones del schema de Anthropic (research/07 §4.2): sin
// `minimum`/`maxLength`, `additionalProperties:false` obligatorio, sin recursión.
import { z } from 'zod';

import { ProductBriefSchema } from './product-brief';

/** Constraints que la API de Anthropic IGNORA (research/07 §4.2) y que, por tanto,
 *  se podan del espejo para que no mienta (las reglas viven solo en Zod): de array,
 *  numéricos y de string. `includes()` es case-SENSITIVE — respeta el camelCase
 *  exacto de cada keyword de JSON Schema. */
const PRUNED_KEYWORDS = [
  // array
  'minItems',
  'maxItems',
  'minContains',
  'maxContains',
  // numéricos
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  // string
  'minLength',
  'maxLength',
] as const;

/**
 * Walk puro del JSON Schema: (a) fija `additionalProperties: false` en todo objeto
 * y (b) poda los constraints que Anthropic ignora (array/numérico/string). No muta
 * la entrada — devuelve una copia. Es recursivo sobre la ESTRUCTURA del schema
 * (arrays/objetos anidados), no sobre el dominio del ProductBrief, que no es
 * recursivo (limitación de Anthropic).
 */
export function toAnthropicJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => toAnthropicJsonSchema(item));
  }
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }
  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((PRUNED_KEYWORDS as readonly string[]).includes(key)) {
      continue; // podado: la API lo ignoraría
    }
    output[key] = toAnthropicJsonSchema(value);
  }
  // Todo nodo de tipo objeto exige `additionalProperties: false` (requisito Anthropic).
  if (output.type === 'object') {
    output.additionalProperties = false;
  }
  return output;
}

/** El espejo JSON Schema draft 2020-12 que se envía en `output_config` de Anthropic. */
export const productBriefJsonSchema = toAnthropicJsonSchema(
  z.toJSONSchema(ProductBriefSchema),
) as Record<string, unknown>;
