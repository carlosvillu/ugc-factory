import { describe, expect, it } from 'vitest';
import { validateGallerySeed, RAW_GALLERY_SEED } from './index';
import type { GuardPackSeed, PromptTemplateSeed } from './contracts';
import { resolveCompileInput, N6SourcesSchema, type N6Sources } from './compile-executor-contract';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT } from './compile-fixtures';

function seed(): { templates: PromptTemplateSeed[]; guardPacks: GuardPackSeed[] } {
  const v = validateGallerySeed(RAW_GALLERY_SEED);
  if (!v.ok || !v.seed) throw new Error('el seed de galería no valida');
  return { templates: v.seed.templates, guardPacks: v.seed.guardPacks };
}

const { templates, guardPacks } = seed();
const validSources: N6Sources = {
  node: 'N6-sources',
  brief: DEMO_BEAUTY_BRIEF,
  persona: DEMO_PERSONA,
  script: DEMO_SCRIPT,
  facets: { hookAngle: 'pain_point', format: 'grwm', platform: 'tiktok', durationSeconds: 22 },
};

describe('N6SourcesSchema', () => {
  it('acepta un N6-sources bien formado', () => {
    expect(N6SourcesSchema.safeParse(validSources).success).toBe(true);
  });
  it('rechaza un node distinto', () => {
    expect(N6SourcesSchema.safeParse({ ...validSources, node: 'otro' }).success).toBe(false);
  });
});

describe('resolveCompileInput', () => {
  it('resuelve un N6-sources válido → CompileInput con el template seleccionado por facetas', () => {
    const res = resolveCompileInput(validSources, templates, guardPacks);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.template.slug).toBe('grwm-beauty-pain-point');
    expect(res.input.sources.campaign.platform).toBe('tiktok');
  });

  it('cae al defaultAspect del template cuando el aspect no viene', () => {
    const res = resolveCompileInput(validSources, templates, guardPacks);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // grwm-beauty-pain-point tiene defaultAspect 9:16.
    expect(res.input.sources.campaign.aspect).toBe('9:16');
  });

  it('un objeto que NO es N6-sources → invalid_sources (no lanza)', () => {
    const res = resolveCompileInput({ foo: 'bar' }, templates, guardPacks);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('invalid_sources');
  });

  // T5.12: el `no_template` por CATEGORY desconocida era el bug (el LLM emite la category como texto
  // libre). El error duro sigue existiendo para facetas que NO son texto de LLM — aquí, un hookAngle
  // inexistente. Ninguna aserción se pierde: `no_template` + mensaje accionable siguen bajo test.
  it('facetas sin template compatible (hookAngle inexistente) → no_template con mensaje accionable', () => {
    const noMatch: N6Sources = {
      ...validSources,
      facets: { ...validSources.facets, hookAngle: 'no_such_angle' },
    };
    const res = resolveCompileInput(noMatch, templates, guardPacks);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('no_template');
    expect(res.message).toContain('no_such_angle');
  });

  // EL CASO REAL DE T5.12: la MISMA URL de CeraVe emitió `beauty` un día y `Cuidado de la piel` al
  // siguiente. Antes, la segunda etiqueta daba `no_template` → `PermanentStepError` en N6 → lote muerto
  // hasta que el usuario editaba la category a mano en CP1.
  for (const category of ['Cuidado de la piel', 'Cuidado bucal']) {
    it(`una category LIBRE del LLM ("${category}") resuelve, marcada como degradada`, () => {
      const freeCategory: N6Sources = {
        ...validSources,
        brief: {
          ...DEMO_BEAUTY_BRIEF,
          product: { ...DEMO_BEAUTY_BRIEF.product, category },
        },
      };
      const res = resolveCompileInput(freeCategory, templates, guardPacks);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // Slug PINCHADO, no `res.input.template.slug` (eso pasaría con CUALQUIER ganador y no probaría
      // nada). Con `format: 'grwm'` fijado por `validSources`, el pase degradado da overlap 3 a
      // `grwm-beauty-pain-point` (format+hookAngle+platform) contra 2 de los format-agnósticos.
      // El pin caza drift del seed, igual que el pin de `demo-pain-point` en la suite de services.
      expect(res.input.template.slug).toBe('grwm-beauty-pain-point');
      expect(res.degraded).toEqual({
        facet: 'vertical',
        value: category,
        templateSlug: 'grwm-beauty-pain-point',
      });
    });
  }

  it('una category CANÓNICA no marca degradación (la especificidad manda, sin relajar)', () => {
    const res = resolveCompileInput(validSources, templates, guardPacks);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.degraded).toBeUndefined();
    expect(res.input.template.slug).toBe('grwm-beauty-pain-point');
  });
});
