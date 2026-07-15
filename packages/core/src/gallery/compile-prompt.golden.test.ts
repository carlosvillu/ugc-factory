// GOLDEN FILES del compilador de prompts (T3.5, Verificación). Comparan el `resolvedPrompt`
// carácter a carácter (patrón unit-core.md §2) contra un fichero versionado, sobre 3 combinaciones
// brief-fixture × template × persona con los templates de prueba de T3.2. Una regresión silenciosa
// (un guard que deja de inyectarse, un slot con el campo equivocado) rompe el golden.
//
// Regeneración SOLO con UPDATE_GOLDEN=1, revisando el diff como código.
import { describe, it } from 'vitest';
import { expectGolden } from '@ugc/test-utils';
import { validateGallerySeed, RAW_GALLERY_SEED } from './index';
import type { GuardPackSeed, PromptTemplateSeed } from './contracts';
import { compilePrompt } from './compile-prompt';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT } from './compile-fixtures';
import type { VariableSources } from './variable-sources';

function seed(): { templates: PromptTemplateSeed[]; guardPacks: GuardPackSeed[] } {
  const validation = validateGallerySeed(RAW_GALLERY_SEED);
  if (!validation.ok || !validation.seed) throw new Error('el seed de galería no valida');
  return { templates: validation.seed.templates, guardPacks: validation.seed.guardPacks };
}

const { templates, guardPacks } = seed();
const bySlug = (slug: string): PromptTemplateSeed => templates.find((t) => t.slug === slug)!;

const golden = (name: string): URL =>
  new URL(`../../test/golden/prompting/${name}.txt`, import.meta.url);

const sources: VariableSources = {
  brief: DEMO_BEAUTY_BRIEF,
  persona: DEMO_PERSONA,
  script: DEMO_SCRIPT,
  campaign: { platform: 'tiktok', aspect: '9:16', durationSeconds: 22 },
};

// 3 combos: (1) grwm-beauty/tiktok → guard vertical beauty; (2) unboxing-saas/instagram → sin
// guard vertical (saas no está sembrado) + platform reels/ig; (3) before-after-fitness/tiktok →
// ejercita objection+rebuttal (counter) del brief.
const combos: [name: string, slug: string, platform: string][] = [
  ['grwm-beauty-tiktok', 'grwm-beauty-pain-point', 'tiktok'],
  ['unboxing-saas-instagram', 'unboxing-saas-authority', 'reels'],
  ['before-after-fitness-tiktok', 'before-after-fitness-transformation', 'tiktok'],
];

describe('compilePrompt — golden files (carácter a carácter)', () => {
  it.each(combos)('golden %s', async (name, slug, platform) => {
    const res = compilePrompt({
      template: bySlug(slug),
      sources: { ...sources, campaign: { ...sources.campaign, platform } },
      guardPacks,
    });
    if (!res.ok) throw new Error(`compilación falló: ${JSON.stringify(res.issues)}`);
    await expectGolden(res.result.resolvedPrompt, golden(name));
  });
});
