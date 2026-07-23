// `withComposition` (T5.8b): la cola de COMPOSICIÓN (N8 máster+C2PA → N9 CP4) que se añade a un plan de
// generación N6→N7. Test PURO (sin BD, determinista → corre en `pnpm gate`): la función es un ensamblado
// sobre el shape del plan, y su comportamiento —activar N8/N9 con el shape `{variantId}` sin mutar el plan
// de entrada— es exactamente lo que hace que un run del flujo NORMAL (y del regen) llegue a componer el
// máster y pausar en CP4. Estas cláusulas son las que `variantNodes` mira para emitir N8/N9, así que este
// test protege el contrato que las une.
import { describe, expect, it } from 'vitest';

import type { VariantGenerationPlan } from './generation-dag';
import { withComposition } from './generation-dag';

function n7Plan(variantId: string): VariantGenerationPlan {
  return {
    variantId,
    n6Config: { variantId },
    n7aConfig: { route: 'ai_packshot', briefId: 'b1' },
    n7bConfig: { scriptId: 's1' },
    n7cConfig: { avatarEndpoint: 'e', imageAssetId: 'i' },
    n7dConfig: { scriptId: 's1', brollEndpoint: 'e' },
    n7eConfig: { musicEndpoint: 'm', mood: 'x', durationSeconds: 30 },
  };
}

describe('withComposition (T5.8b): añade la cola N8/N9 al plan N6→N7', () => {
  it('activa N8 y N9 con el shape {variantId} (el marcador que variantNodes lee para emitirlos)', () => {
    const plan = withComposition(n7Plan('v1'));

    // N8/N9 se ACTIVAN por presencia; su config solo lleva la identidad de variante (N8/N9 leen
    // `ctx.variantId`, no su config). El shape espeja el que ya usa el harness de N8/N9.
    expect(plan.n8Config).toEqual({ variantId: 'v1' });
    expect(plan.n9Config).toEqual({ variantId: 'v1' });
  });

  it('CONSERVA los nodos N6→N7 del plan de entrada (solo AÑADE la cola, no la reemplaza)', () => {
    const input = n7Plan('v1');
    const plan = withComposition(input);

    expect(plan.variantId).toBe('v1');
    expect(plan.n6Config).toEqual(input.n6Config);
    expect(plan.n7aConfig).toEqual(input.n7aConfig);
    expect(plan.n7bConfig).toEqual(input.n7bConfig);
    expect(plan.n7cConfig).toEqual(input.n7cConfig);
    expect(plan.n7dConfig).toEqual(input.n7dConfig);
    expect(plan.n7eConfig).toEqual(input.n7eConfig);
  });

  it('es PURA: no muta el plan de entrada (el original sigue sin N8/N9)', () => {
    const input = n7Plan('v1');
    withComposition(input);

    // Un caller que quiera el plan N6→N7 a secas no debe ver aparecer N8/N9 en SU plan por haberlo pasado
    // a `withComposition`.
    expect(input.n8Config).toBeUndefined();
    expect(input.n9Config).toBeUndefined();
  });

  it('deriva la identidad de N8/N9 del plan, no de un argumento aparte (un solo dueño de la variante)', () => {
    const plan = withComposition(n7Plan('otra-variante'));
    expect(plan.n8Config).toEqual({ variantId: 'otra-variante' });
    expect(plan.n9Config).toEqual({ variantId: 'otra-variante' });
  });
});
