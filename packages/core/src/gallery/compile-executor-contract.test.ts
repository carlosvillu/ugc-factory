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

  it('facetas sin template compatible → no_template con mensaje accionable', () => {
    const noMatch: N6Sources = {
      ...validSources,
      brief: {
        ...DEMO_BEAUTY_BRIEF,
        product: { ...DEMO_BEAUTY_BRIEF.product, category: 'automotive' },
      },
      facets: { ...validSources.facets, format: 'grwm', platform: 'tiktok' },
    };
    const res = resolveCompileInput(noMatch, templates, guardPacks);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('no_template');
    expect(res.message).toContain('automotive');
  });
});
