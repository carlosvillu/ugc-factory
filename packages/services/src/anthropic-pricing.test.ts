// Unit del pricing de Anthropic (T1.8). Es lo que decide el número que la Verificación LEE en
// `/spend` ("coste <$0,15/brief"): si la tabla o los multiplicadores de caché están mal, el
// panel de gasto miente y el bound se evalúa contra un número falso.
import { describe, expect, it } from 'vitest';
import type { AnthropicUsage } from '@ugc/core/analyze';

import {
  anthropicBilledTokens,
  anthropicCostOf,
  anthropicUsageToCents,
  anthropicUsageToUsd,
} from './anthropic-pricing';

function usage(overrides: Partial<AnthropicUsage> = {}): AnthropicUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ...overrides,
  };
}

describe('anthropicUsageToUsd — tabla de precios por modelo', () => {
  it('Sonnet 5: $3/MTok input, $15/MTok output', () => {
    const usd = anthropicUsageToUsd(
      'claude-sonnet-5',
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    );
    expect(usd).toBeCloseTo(3 + 15, 6);
  });

  it('Haiku 4.5: $1/MTok input, $5/MTok output (el precio que T1.7 ya usaba)', () => {
    const usd = anthropicUsageToUsd(
      'claude-haiku-4-5',
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    );
    expect(usd).toBeCloseTo(1 + 5, 6);
  });

  // Antes este test exigía que un modelo sin precio LANZARA. Era un BUG DE DINERO: el throw ocurre
  // en el caller DESPUÉS de la llamada de pago, así que `recordCost` no llegaba a ejecutarse y el
  // gasto real quedaba SIN fila en `/spend` (rompe la disciplina record-first de T1.4). El
  // invariante correcto —y el que ahora se afirma— es: el coste NUNCA tumba el registro.
  it('un modelo sin precio NO lanza: degrada a $0 (el importe se pierde, la fila NO)', () => {
    expect(anthropicUsageToUsd('claude-inventado-9', usage({ inputTokens: 10 }))).toBe(0);
    expect(anthropicUsageToCents('claude-inventado-9', usage({ inputTokens: 10 }))).toBe(0);
  });
});

describe('anthropicCostOf — el registro del gasto NUNCA se pierde', () => {
  it('modelo CONOCIDO: importe correcto y sin warning', () => {
    const cost = anthropicCostOf(
      'claude-sonnet-5',
      usage({ inputTokens: 20_000, outputTokens: 2_000 }),
    );
    expect(cost.usd).toBeCloseTo((20_000 * 3) / 1e6 + (2_000 * 15) / 1e6, 6);
    expect(cost.billedTokens).toBe(22_000);
    expect(cost.warning).toBeNull();
  });

  it('modelo DESCONOCIDO: no lanza, avisa, y `quantity` (tokens reales) sigue siendo la verdad', () => {
    const u = usage({
      inputTokens: 20_000,
      outputTokens: 2_000,
      cacheCreationInputTokens: 5_000,
      cacheReadInputTokens: 1_000,
    });
    const cost = anthropicCostOf('claude-modelo-futuro', u);

    expect(cost.cents).toBe(0); // el importe se degrada…
    expect(cost.billedTokens).toBe(28_000); // …pero los tokens facturados son EXACTOS
    expect(cost.warning).toMatch(/SIN PRECIO/);
    expect(cost.warning).toContain('claude-modelo-futuro');
  });
});

describe('anthropicUsageToUsd — CONSCIENTE DE LA CACHÉ', () => {
  it('cache_write cuesta 1,25× el input', () => {
    const usd = anthropicUsageToUsd(
      'claude-sonnet-5',
      usage({ cacheCreationInputTokens: 1_000_000 }),
    );
    expect(usd).toBeCloseTo(3 * 1.25, 6);
  });

  it('cache_read cuesta 0,1× el input — el descuento que hace viable el <$0,15/brief', () => {
    const usd = anthropicUsageToUsd('claude-sonnet-5', usage({ cacheReadInputTokens: 1_000_000 }));
    expect(usd).toBeCloseTo(3 * 0.1, 6);
  });

  it('facturar el cache_read a precio COMPLETO sobre-reportaría 10× ese tramo', () => {
    // Este es el bug que la conciencia de caché evita: a partir de la 2ª síntesis la mayor parte
    // del input llega cacheado. Sin el 0,1×, `/spend` mostraría un gasto inflado y el check de la
    // Verificación podría FALLAR sobre un brief que realmente cuesta menos.
    const cached = anthropicUsageToUsd('claude-sonnet-5', usage({ cacheReadInputTokens: 6_000 }));
    const asIfFullPrice = anthropicUsageToUsd('claude-sonnet-5', usage({ inputTokens: 6_000 }));
    expect(asIfFullPrice / cached).toBeCloseTo(10, 4);
  });

  it('una síntesis realista (2ª llamada, system cacheado) queda MUY por debajo de $0,15', () => {
    // Perfil típico: system cacheado (~6k), user message con markdown truncado (~10k sin cachear),
    // brief de salida (~3,5k).
    const usd = anthropicUsageToUsd(
      'claude-sonnet-5',
      usage({ inputTokens: 10_000, cacheReadInputTokens: 6_000, outputTokens: 3_500 }),
    );
    expect(usd).toBeLessThan(0.15);
  });
});

describe('cost_entry: enteros y quantity', () => {
  it('amount_cents es SIEMPRE un entero (invariante duro del ledger)', () => {
    const cents = anthropicUsageToCents(
      'claude-sonnet-5',
      usage({ inputTokens: 10_000, cacheReadInputTokens: 6_000, outputTokens: 3_500 }),
    );
    expect(Number.isInteger(cents)).toBe(true);
    expect(cents).toBeGreaterThanOrEqual(0);
  });

  it('quantity = TODOS los tokens facturables (incl. los de caché: se pagaron, a otro precio)', () => {
    expect(
      anthropicBilledTokens(
        usage({
          inputTokens: 100,
          outputTokens: 20,
          cacheCreationInputTokens: 5,
          cacheReadInputTokens: 7,
        }),
      ),
    ).toBe(132);
  });

  it('sin caché (el caso de T1.7), quantity y coste son EXACTAMENTE los de antes de T1.8', () => {
    // Garantía de NO regresión sobre T1.7 (que ya está verificado): sus `cache_*` son siempre 0,
    // así que la fórmula nueva colapsa a la vieja (input+output al precio base) — mismo número.
    const u = usage({ inputTokens: 15_000, outputTokens: 220 });
    expect(anthropicBilledTokens(u)).toBe(15_220);
    const legacyCents = Math.round(15_000 * (100 / 1_000_000) + 220 * (500 / 1_000_000));
    expect(anthropicUsageToCents('claude-haiku-4-5', u)).toBe(legacyCents);
  });
});
