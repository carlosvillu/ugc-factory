// Unit del executor N6 (costura STEPLESS: fuentes por dep `N6-sources`, sin BD). Cubre su comportamiento
// observable en ese path: sin fuentes cableadas se marca inaplicable; con un `N6-sources` compila DE
// VERDAD vía el motor de core y emite el resolvedPrompt con el fidelity guard. El path de PRODUCCIÓN
// (ensamblado desde la BD por `variantId`, T4.11) se cubre en integración. N6 es $0 y determinista.
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@ugc/core';
import type { ExecutorContext } from '@ugc/core/orchestrator';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT, type N6Sources } from '@ugc/core/gallery';
import { makeN6Executor } from './compile-prompt';
import { makeExecutorRegistry } from './index';

/** Un `N6-sources` de demo válido (el contrato forward que F4 cableará). */
const n6Sources: N6Sources = {
  node: 'N6-sources',
  brief: DEMO_BEAUTY_BRIEF,
  persona: DEMO_PERSONA,
  script: DEMO_SCRIPT,
  facets: { hookAngle: 'pain_point', format: 'grwm', platform: 'tiktok', durationSeconds: 22 },
};

function makeCtx(overrides: Partial<ExecutorContext> = {}): {
  ctx: ExecutorContext;
  outputs: unknown[];
  markInapplicable: ReturnType<typeof vi.fn>;
} {
  const outputs: unknown[] = [];
  const markInapplicable = vi.fn();
  const ctx: ExecutorContext = {
    config: { variantId: 'var_01' },
    collectOutput: (refs) => outputs.push(refs),
    markInapplicable,
    deps: [],
    ...overrides,
  };
  return { ctx, outputs, markInapplicable };
}

describe('makeN6Executor (costura stepless: fuentes por dep, sin BD)', () => {
  it('sin fuentes cableadas (sin dep N6-sources) → marca inaplicable y no compila', async () => {
    const { ctx, outputs, markInapplicable } = makeCtx();
    await makeN6Executor()(ctx);
    expect(markInapplicable).toHaveBeenCalledOnce();
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ node: 'N6', skipped: 'awaiting_generation_dag' });
  });

  it('con un N6-sources válido → COMPILA vía el motor y emite el resolvedPrompt', async () => {
    const { ctx, outputs, markInapplicable } = makeCtx({
      deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: n6Sources }],
    });
    await makeN6Executor()(ctx);
    expect(markInapplicable).not.toHaveBeenCalled();
    expect(outputs).toHaveLength(1);
    const out = outputs[0] as {
      node: string;
      templateSlug: string;
      guardPackKeysUsed: string[];
      resolvedPrompt: string;
    };
    expect(out.node).toBe('N6');
    expect(out.templateSlug).toBe('grwm-beauty-pain-point');
    // El motor real: fidelity guard literal + guard del vertical beauty.
    expect(out.resolvedPrompt).toContain('no deformation, drift, or artifacts');
    expect(out.guardPackKeysUsed).toContain('guard.vertical.beauty');
  });

  it('config inválida (sin variantId) → PermanentStepError', async () => {
    const { ctx } = makeCtx({ config: {} });
    // T4.11: N6 es `async` (lee la BD en el path de producción) — el throw viaja por promesa rechazada.
    await expect(makeN6Executor()(ctx)).rejects.toThrow(PermanentStepError);
  });

  it('un N6-sources con slot irresoluble (sin guion) → PermanentStepError accionable', async () => {
    const noScript: N6Sources = { ...n6Sources, script: undefined };
    const { ctx } = makeCtx({
      deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: noScript }],
    });
    // Sin guion, {hook.line}/{cta.line} no resuelven → el executor revienta ruidoso antes de un render.
    await expect(makeN6Executor()(ctx)).rejects.toThrow(/slots sin resolver/);
  });

  // T5.12 · LA PROMESA LITERAL DEL PLANNING: «un brief con `product.category` libre (p.ej.
  // `Cuidado de la piel`) llega a N6 sin `PermanentStepError`». Antes de T5.12 esto reventaba con
  // "N6: no hay template para la variante: No hay ningún template de galería que case con las facetas
  // [... vertical=Cuidado de la piel ...]" y dejaba el lote muerto hasta editar la category a mano.
  // Los valores son los que el LLM emitió DE VERDAD el 2026-07-25 sobre la URL de CeraVe.
  for (const category of ['Cuidado de la piel', 'Cuidado bucal']) {
    it(`una product.category LIBRE ("${category}") compila SIN PermanentStepError y deja rastro`, async () => {
      const freeCategory: N6Sources = {
        ...n6Sources,
        brief: {
          ...DEMO_BEAUTY_BRIEF,
          product: { ...DEMO_BEAUTY_BRIEF.product, category },
        },
      };
      const warn = vi.fn();
      const logger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn,
        error: vi.fn(),
        child: vi.fn(),
      } as unknown as Logger;
      const { ctx, outputs } = makeCtx({
        deps: [
          { stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: freeCategory },
        ],
      });
      // No lanza: la Entrega de T5.12 es exactamente esto.
      await makeN6Executor({ logger })(ctx);

      const out = outputs[0] as {
        node: string;
        resolvedPrompt: string;
        degradedFacet?: { facet: string; value: string; templateSlug: string };
      };
      expect(out.node).toBe('N6');
      expect(out.resolvedPrompt.length).toBeGreaterThan(0);
      // La degradación NO es silenciosa: warning estructurado + rastro en los output_refs del step.
      expect(out.degradedFacet).toMatchObject({ facet: 'vertical', value: category });
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toMatchObject({
        facet: 'vertical',
        unmatchedValue: category,
      });
    });
  }

  it('una category CANÓNICA no degrada: sin warning ni degradedFacet', async () => {
    const warn = vi.fn();
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child: vi.fn(),
    } as unknown as Logger;
    const { ctx, outputs } = makeCtx({
      deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: n6Sources }],
    });
    await makeN6Executor({ logger })(ctx);
    expect(warn).not.toHaveBeenCalled();
    expect(outputs[0]).not.toHaveProperty('degradedFacet');
  });

  it('está REGISTRADO en el orquestador bajo la clave N6 (Entrega: "registro del executor N6")', () => {
    // Los factories (N4/N5/N6) solo construyen closures; no tocan las deps al registrar, así que un
    // grupo de deps stub basta para comprobar que la clave existe y mapea a una función.
    const registry = makeExecutorRegistry({
      demoShouldFail: () => false,
      demoRecordCost: () => Promise.resolve(),
      analysis: {} as never,
      generation: {} as never,
    });
    expect(typeof registry.N6).toBe('function');
  });
});
