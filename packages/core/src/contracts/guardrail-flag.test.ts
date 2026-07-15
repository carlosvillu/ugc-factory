// Contrato `GuardrailFlag` (T2.5, §15.2): un caso válido + una mutación por regla de negocio del
// schema (unit-core.md §3). El flag se serializa en `ad_script.guardrail_flags` (jsonb): lo que el
// schema no rechace entra en la BD y llega a CP3.
import { expect, it } from 'vitest';

import { GuardrailFlagSchema, type GuardrailFlag } from './guardrail-flag';

const valid: GuardrailFlag = {
  rule: 'banned_claim',
  blocking: true,
  excerpt: 'cura el acné',
  explanation: 'Contiene un claim de riesgo.',
  suggestion: 'Atenúa la afirmación.',
};

it('el flag canónico valida', () => {
  expect(GuardrailFlagSchema.safeParse(valid).success).toBe(true);
});

const invalid: [name: string, mutate: (f: GuardrailFlag) => unknown][] = [
  ['rule fuera del enum', (f) => ({ ...f, rule: 'made_up_rule' })],
  ['excerpt vacío', (f) => ({ ...f, excerpt: '' })],
  ['explanation vacía (§15.2 exige explicación)', (f) => ({ ...f, explanation: '' })],
  ['suggestion vacía (§15.2 exige sugerencia)', (f) => ({ ...f, suggestion: '' })],
  ['blocking no booleano', (f) => ({ ...f, blocking: 'yes' })],
];

it.each(invalid)('rechaza: %s', (_name, mutate) => {
  expect(GuardrailFlagSchema.safeParse(mutate(valid)).success).toBe(false);
});
