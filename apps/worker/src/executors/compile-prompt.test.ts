// Unit del executor N6 (T3.5, esqueleto). Cubre lo que la Entrega promete ("registro del executor
// N6 en el orquestador") y su comportamiento observable: sin fuentes cableadas se marca inaplicable;
// con un `N6-sources` compila DE VERDAD vía el motor de core y emite el resolvedPrompt con el
// fidelity guard. Puro: sin BD, sin cola (N6 es $0 y determinista en T3.5).
import { describe, expect, it, vi } from 'vitest';
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

describe('makeN6Executor (esqueleto T3.5)', () => {
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

  it('config inválida (sin variantId) → PermanentStepError', () => {
    const { ctx } = makeCtx({ config: {} });
    // El executor valida de forma síncrona antes de devolver la promesa: el throw es síncrono.
    expect(() => makeN6Executor()(ctx)).toThrow(PermanentStepError);
  });

  it('un N6-sources con slot irresoluble (sin guion) → PermanentStepError accionable', () => {
    const noScript: N6Sources = { ...n6Sources, script: undefined };
    const { ctx } = makeCtx({
      deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: noScript }],
    });
    // Sin guion, {hook.line}/{cta.line} no resuelven → el executor revienta ruidoso antes de un render.
    expect(() => makeN6Executor()(ctx)).toThrow(/slots sin resolver/);
  });

  it('está REGISTRADO en el orquestador bajo la clave N6 (Entrega: "registro del executor N6")', () => {
    // Los factories (N4/N5/N6) solo construyen closures; no tocan las deps al registrar, así que un
    // grupo de deps stub basta para comprobar que la clave existe y mapea a una función.
    const registry = makeExecutorRegistry({
      demoShouldFail: () => false,
      demoRecordCost: () => Promise.resolve(),
      analysis: {} as never,
    });
    expect(typeof registry.N6).toBe('function');
  });
});
