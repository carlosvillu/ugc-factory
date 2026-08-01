// Unit del executor N6 (costura STEPLESS: fuentes por dep `N6-sources`, sin BD). Cubre su comportamiento
// observable en ese path: sin fuentes cableadas se marca inaplicable; con un `N6-sources` compila DE
// VERDAD vía el motor de core y emite el resolvedPrompt con el fidelity guard. El path de PRODUCCIÓN
// (ensamblado desde la BD por `variantId`, T4.11) se cubre en integración. N6 es $0 y determinista.
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@ugc/core';
import type { ExecutorContext } from '@ugc/core/orchestrator';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT, type N6Sources } from '@ugc/core/gallery';
import { N6OutputSchema, type N6ScenePrompt } from '@ugc/core/contracts';
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

  // T5b.1b-i · N6 emite un prompt POR ESCENA `body`/`cta` (el que N7d/N7f mandarán a fal en T5b.1b-ii).
  describe('T5b.1b-i · scenePrompts (un prompt por escena body/cta)', () => {
    it('con guion body+cta → un scenePrompt por escena, con su índice ABSOLUTO y sus beats por solape', async () => {
      const { ctx, outputs } = makeCtx({
        deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: n6Sources }],
      });
      await makeN6Executor()(ctx);
      const out = outputs[0] as { scenePrompts: N6ScenePrompt[] };

      // DEMO_SCRIPT: escena 0 hook, 1 body, 2 cta → 2 scenePrompts (body+cta), NO el hook.
      expect(out.scenePrompts).toHaveLength(2);
      expect(out.scenePrompts.map((s) => s.segment)).toEqual(['body', 'cta']);
      // sceneIndex es el índice ABSOLUTO en script.scenes (el mismo keying que segmentSceneIndices
      // da a N7d/N7f): body es la escena 1, cta la 2. Off-by-one aquí manda el guard pack a otra escena.
      expect(out.scenePrompts.map((s) => s.sceneIndex)).toEqual([1, 2]);
      // Cada entrada acarrea t/seconds (mapeo alternativo) y su guard pack.
      const body = out.scenePrompts.find((s) => s.segment === 'body')!;
      expect(body.t).toBe(3);
      expect(body.seconds).toBe(15);
      expect(body.guardPackKeysUsed).toContain('guard.vertical.beauty');
      // Escenas del grid del template → sí solapan beats → noBeatsOverlap false.
      expect(out.scenePrompts.every((s) => !s.noBeatsOverlap)).toBe(true);
      // Los beats de la escena body (bloque estructurado `Beats:`) están acotados a su ventana [3, 18):
      // el hook `[0-3s]` cae fuera, así que su beat NO aparece; sí los dos beats de proof [3-10]/[10-18].
      // (El texto narrativo del template `body` sí menciona todos los beats como prosa — eso es el
      // "cómo se ve" global y no se filtra; lo que la ventana acota es el bloque `Beats:`.)
      const bodyBeatsBlock = body.resolvedPrompt.slice(body.resolvedPrompt.indexOf('Beats:'));
      expect(bodyBeatsBlock).toContain('[3-10s]');
      expect(bodyBeatsBlock).toContain('[10-18s]');
      expect(bodyBeatsBlock).not.toContain('[0-3s]');
      expect(body.resolvedBeats.length).toBe(2);
      // El fidelity guard literal se emite también por escena.
      expect(body.resolvedPrompt).toContain('no deformation, drift, or artifacts');
      // La escena cta: su ventana [18,22) solo solapa el beat final del cta.
      const cta = out.scenePrompts.find((s) => s.segment === 'cta')!;
      const ctaBeatsBlock = cta.resolvedPrompt.slice(cta.resolvedPrompt.indexOf('Beats:'));
      expect(ctaBeatsBlock).toContain('[18-22s]');
      expect(ctaBeatsBlock).not.toContain('[3-10s]');
    });

    it('escena cuya ventana NO solapa el grid del template → noBeatsOverlap:true, resolvedBeats:[], output no rompe', async () => {
      // El grid de beats del template acaba en 22s. Una escena cta en t=25s (el timing lo deriva el LLM,
      // el grid es estático) tiene ventana [25,29): no cruza NINGÚN beat → resolvedBeats vacío. Sin la
      // señal, sería indistinguible de una escena normal. La escena body normal (t=3) sirve de contraste.
      const driftedCta = {
        ...DEMO_SCRIPT,
        scenes: [
          DEMO_SCRIPT.scenes.find((s) => s.segment === 'body')!,
          { ...DEMO_SCRIPT.scenes.find((s) => s.segment === 'cta')!, t: 25, seconds: 4 },
        ],
      };
      const sources: N6Sources = { ...n6Sources, script: driftedCta };
      const { ctx, outputs } = makeCtx({
        deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: sources }],
      });
      await makeN6Executor()(ctx);
      const out = outputs[0] as { node: string; scenePrompts: N6ScenePrompt[] };
      expect(out.node).toBe('N6');
      const cta = out.scenePrompts.find((s) => s.segment === 'cta')!;
      expect(cta.noBeatsOverlap).toBe(true);
      expect(cta.resolvedBeats).toEqual([]);
      // El prompt sale igualmente (ok:true) pero SIN sección `Beats:`.
      expect(cta.resolvedPrompt.length).toBeGreaterThan(0);
      expect(cta.resolvedPrompt).not.toContain('Beats:');
      // La escena body normal SÍ solapa su grid → noBeatsOverlap false (contraste, no todo es true).
      const body = out.scenePrompts.find((s) => s.segment === 'body')!;
      expect(body.noBeatsOverlap).toBe(false);
      expect(body.resolvedBeats.length).toBeGreaterThan(0);
    });

    it('CONTROL NEGATIVO: guion sin escenas body/cta → scenePrompts vacío, output no rompe', async () => {
      // Un guion de una sola escena hook: no hay body ni cta que compilar → array vacío (observable,
      // no ausente). El resto del output sigue intacto.
      const onlyHook = {
        ...DEMO_SCRIPT,
        scenes: [DEMO_SCRIPT.scenes.find((s) => s.segment === 'hook')!],
      };
      const sources: N6Sources = { ...n6Sources, script: onlyHook };
      const { ctx, outputs } = makeCtx({
        deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: sources }],
      });
      await makeN6Executor()(ctx);
      const out = outputs[0] as {
        node: string;
        resolvedPrompt: string;
        scenePrompts: N6ScenePrompt[];
      };
      expect(out.node).toBe('N6');
      expect(out.scenePrompts).toEqual([]);
      // El resolvedPrompt de la variante entera sigue emitiéndose.
      expect(out.resolvedPrompt.length).toBeGreaterThan(0);
    });

    it('RETROCOMPATIBILIDAD: resolvedPrompt (string) y resolvedBeats (array) siguen presentes con su forma', async () => {
      const { ctx, outputs } = makeCtx({
        deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: n6Sources }],
      });
      await makeN6Executor()(ctx);
      const out = outputs[0] as { resolvedPrompt: unknown; resolvedBeats: unknown };
      // La forma que leen los 3 componentes de canvas y los e2e de F4 NO cambia: string + array.
      expect(typeof out.resolvedPrompt).toBe('string');
      expect((out.resolvedPrompt as string).length).toBeGreaterThan(0);
      expect(Array.isArray(out.resolvedBeats)).toBe(true);
      expect((out.resolvedBeats as unknown[]).length).toBeGreaterThan(0);
    });

    it('el output completo valida contra N6OutputSchema (el array es parte del contrato, no un campo suelto)', async () => {
      const { ctx, outputs } = makeCtx({
        deps: [{ stepId: 's1', nodeKey: 'N6-sources', status: 'succeeded', outputRefs: n6Sources }],
      });
      await makeN6Executor()(ctx);
      // parse (no safeParse): un consumidor que discrimina por schema NO debe descartar `scenePrompts`
      // (está declarado en el contrato). `parse` lanza si el output no valida — el assert es el no-throw.
      const parsed = N6OutputSchema.parse(outputs[0]);
      expect(parsed.scenePrompts).toHaveLength(2);
    });
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
