import { describe, expect, it } from 'vitest';
import { validateGallerySeed, RAW_GALLERY_SEED } from './index';
import type { GuardPackSeed, PromptTemplateSeed } from './contracts';
import { compilePrompt, COMPILER_ANTI_STYLE } from './compile-prompt';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT } from './compile-fixtures';
import type { VariableSources } from './variable-sources';

function seed(): { templates: PromptTemplateSeed[]; guardPacks: GuardPackSeed[] } {
  const validation = validateGallerySeed(RAW_GALLERY_SEED);
  if (!validation.ok || !validation.seed) throw new Error('el seed de galería no valida');
  return { templates: validation.seed.templates, guardPacks: validation.seed.guardPacks };
}

const { templates, guardPacks } = seed();
const grwm = templates.find((t) => t.slug === 'grwm-beauty-pain-point')!;
const unboxing = templates.find((t) => t.slug === 'unboxing-saas-authority')!;

const sources: VariableSources = {
  brief: DEMO_BEAUTY_BRIEF,
  persona: DEMO_PERSONA,
  script: DEMO_SCRIPT,
  campaign: { platform: 'tiktok', aspect: '9:16', durationSeconds: 22 },
};

describe('compilePrompt — inyección obligatoria y resolución completa', () => {
  it('compila la variante beauty/tiktok sin slots sin resolver', () => {
    const res = compilePrompt({ template: grwm, sources, guardPacks });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // No queda ningún `{slot}` sin resolver en el prompt.
    expect(res.result.resolvedPrompt).not.toMatch(/\{[a-z]/);
  });

  it('inyecta el fidelity guard LITERAL del compilador ("no deformation") aunque el seed no lo diga', () => {
    const res = compilePrompt({ template: grwm, sources, guardPacks });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.resolvedPrompt).toContain('no deformation, drift, or artifacts');
    // El pack `guard.fidelity` del seed NO contiene esa frase: la emite el compilador.
    const fidelitySeed = guardPacks.find((p) => p.key === 'guard.fidelity')!;
    expect(fidelitySeed.lines.join(' ')).not.toContain('no deformation, drift, or artifacts');
  });

  it('inyecta el anti-estilo UGC del compilador', () => {
    const res = compilePrompt({ template: grwm, sources, guardPacks });
    expect(res.ok && res.result.resolvedPrompt).toContain(COMPILER_ANTI_STYLE);
  });

  it('inyecta el guard pack del vertical (beauty) y de la plataforma (tiktok), §9.5', () => {
    const res = compilePrompt({ template: grwm, sources, guardPacks });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.guardPackKeysUsed).toEqual([
      'guard.general',
      'guard.fidelity',
      'guard.vertical.beauty',
      'guard.platform.tiktok',
    ]);
    // Una línea concreta del guard de beauty aparece en el prompt.
    expect(res.result.resolvedPrompt).toContain('Make no medical, dermatological');
  });

  it('interpola hook.line/cta.line del AdScript en los beats', () => {
    const res = compilePrompt({ template: grwm, sources, guardPacks });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.resolvedPrompt).toContain(DEMO_SCRIPT.hook);
    expect(res.result.resolvedPrompt).toContain(DEMO_SCRIPT.cta);
    // El dialogue de los beats queda interpolado (no `{hook.line}`).
    expect(res.result.resolvedBeats.some((b) => b.dialogue === DEMO_SCRIPT.hook)).toBe(true);
  });

  it('resuelve {benefit[1]} del template unboxing (brief con ≥2 benefits)', () => {
    // El unboxing es saas: para probar la interpolación de benefit[1], se compila su body con
    // las fuentes beauty (los slots son los mismos; el guard del vertical difiere y no importa aquí).
    const res = compilePrompt({ template: unboxing, sources, guardPacks });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.resolvedPrompt).toContain(DEMO_BEAUTY_BRIEF.benefits[1]!.benefit);
  });
});

describe('compilePrompt — slot irresoluble → error accionable (qué variable, de qué fuente)', () => {
  it('brief sin objections y template before-after → unresolved_slot que nombra objection ← ProductBrief', () => {
    const beforeAfter = templates.find((t) => t.slug === 'before-after-fitness-transformation')!;
    const briefNoObjections = { ...DEMO_BEAUTY_BRIEF, objections: [] };
    const res = compilePrompt({
      template: beforeAfter,
      sources: { ...sources, brief: briefNoObjections },
      guardPacks,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const objectionIssue = res.issues.find((i) => i.slot === 'objection');
    expect(objectionIssue).toBeDefined();
    expect(objectionIssue!.code).toBe('unresolved_slot');
    expect(objectionIssue!.source).toBe('ProductBrief');
    expect(objectionIssue!.message).toContain('ProductBrief');
    // El rebuttal (counter) del mismo template también falla por la misma causa.
    expect(res.issues.some((i) => i.slot === 'rebuttal')).toBe(true);
  });

  it('sin guion → unresolved_slot que nombra hook.line ← AdScript', () => {
    const res = compilePrompt({
      template: grwm,
      sources: { ...sources, script: undefined },
      guardPacks,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const hookIssue = res.issues.find((i) => i.slot === 'hook.line');
    expect(hookIssue?.source).toBe('AdScript');
  });
});

describe('compilePrompt — por escena (N7 genera 1 clip por escena, §13.1)', () => {
  it('compila UNA escena hook: solo su beat lleva el dialogue del hook', () => {
    const hookScene = DEMO_SCRIPT.scenes.find((s) => s.segment === 'hook')!;
    const res = compilePrompt({ template: grwm, sources, guardPacks, scene: hookScene });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // La ventana [0,3) solo solapa el beat 1 (hook): el resolvedBeats se acota.
    expect(res.result.resolvedBeats.length).toBeGreaterThanOrEqual(1);
    expect(res.result.resolvedBeats.every((b) => b.tStart < hookScene.t + hookScene.seconds)).toBe(
      true,
    );
    // El fidelity guard sigue estando (se emite siempre, también por escena).
    expect(res.result.resolvedPrompt).toContain('no deformation, drift, or artifacts');
  });
});
