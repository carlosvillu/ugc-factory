// EL CONTRATO `GuardrailFlag` — lo que el linter FTC (§15.2, T2.5) marca sobre un guion, y lo que
// se serializa en la columna `ad_script.guardrail_flags jsonb` (§12, ya declarada en
// `packages/db/src/schema/batch.ts`). Vive en `contracts` porque cruza módulos: lo PRODUCE
// `scripting/ftc-linter.ts` (N5, esta tarea), lo PERSISTE y RE-LINTEA CP3 (T2.6) al guardar
// ediciones del usuario, y lo consume la UI del editor (T2.6) para pintar el bloqueo.
//
// POR QUÉ NO VIVE DENTRO DE `AdScript` (la cabecera de `ad-script.ts` lo agrupa con las columnas de
// PERSISTENCIA que core omite a propósito): compliance es ORTOGONAL a la generación (decisión del
// advisor de T2.5). Un guion puede ser `scripted` (generación exitosa) Y tener flags bloqueantes: el
// `ScriptWriterStatus` mide éxito de GENERACIÓN, no de compliance. El linter es una FUNCIÓN PURA
// STANDALONE (`lintScript`) que devuelve `GuardrailFlag[]` — reutilizable por CP3 SIN regenerar el
// guion. Por eso el flag es su propio contrato, no un campo de `AdScript`.
//
// «BLOQUEA CON EXPLICACIÓN Y SUGERENCIA» (§15.2): el bloqueo se REPRESENTA aquí (`blocking: true`),
// no PARA. T2.5 solo produce y persiste la representación; QUIEN impide aprobar es CP3 (T2.6). Cada
// flag lleva SIEMPRE explicación (por qué es un problema de compliance) y sugerencia compliant —
// «no solo aviso» es requisito de producto, y por eso ambas son `.min(1)` (no vacías).
import { z } from 'zod';

/**
 * Los TIPOS de regla de compliance que el linter conoce (§15.1/§15.2). No se colapsan en uno
 * genérico: un claim médico prohibido y una afirmación founder son diagnósticos DISTINTOS con
 * sugerencias distintas (misma disciplina que `ScriptWriterStatus`, que separa `api_error` de
 * `parse_error`).
 *
 * - `banned_claim`: un claim de `brief.brand.banned_or_risky_claims` (salud/finanzas/resultados
 *   garantizados) aparece en el guion. §15.2.
 * - `first_person_purchase`: primera persona de COMPRA/experiencia de cliente («I bought this»,
 *   «me lo compré y…»). El avatar es un creator-style demonstrator, NUNCA un customer (§15.1).
 * - `founder_first_person`: afirmación en primera persona de SER el fundador («I'm the founder»,
 *   «yo fundé/creé esta empresa»). El avatar es sintético y NO es el fundador (§15.1).
 */
export const GuardrailRuleSchema = z.enum([
  'banned_claim',
  'first_person_purchase',
  'founder_first_person',
]);
export type GuardrailRule = z.infer<typeof GuardrailRuleSchema>;

/**
 * UN flag de compliance sobre un guion. Se serializa en `ad_script.guardrail_flags` (jsonb array).
 */
export const GuardrailFlagSchema = z.object({
  /** Qué regla se violó (§15.1/§15.2). */
  rule: GuardrailRuleSchema,
  /** ¿Impide aprobar? Hoy todas las reglas del catálogo bloquean (§15.2 dice «bloquea», no
   *  «avisa»). El campo existe explícito para que CP3 (T2.6) no tenga que re-derivar la política y
   *  para dejar sitio a futuras reglas de solo-aviso sin cambiar el contrato. */
  blocking: z.boolean(),
  /** Lo que DISPARÓ el flag: el fragmento textual del guion (el claim, la frase en primera
   *  persona). Señala DÓNDE está el problema para que CP3 lo resalte. */
  excerpt: z.string().min(1),
  /** POR QUÉ es un problema de compliance. Requisito de producto (§15.2: «con explicación»). */
  explanation: z.string().min(1),
  /** La alternativa COMPLIANT (reformulación creator-style / tercera persona / claim atenuado).
   *  Requisito de producto (§15.2: «y sugerencia»). Determinista: plantilla por tipo de regla, NO
   *  LLM — mantiene el linter puro, gratis y testeable sin red. */
  suggestion: z.string().min(1),
});
export type GuardrailFlag = z.infer<typeof GuardrailFlagSchema>;
