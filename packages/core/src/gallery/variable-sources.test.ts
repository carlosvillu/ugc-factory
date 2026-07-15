import { describe, expect, it } from 'vitest';
import { ProductBriefSchema } from '../contracts/product-brief';
import { PersonaSchema } from '../persona/contracts';
import { AdScriptSchema } from '../contracts/ad-script';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT } from './compile-fixtures';
import { resolveSlot, type SlotResolution, type VariableSources } from './variable-sources';

/** Narrowing helper: asserta que resolvió y devuelve el valor (evita `expect` condicional). */
function value(res: SlotResolution): string {
  if (!res.resolved) throw new Error(`esperaba resolución, obtuve fallo: ${res.message}`);
  return res.value;
}

/** Narrowing helper: asserta que FALLÓ y devuelve el fallo. */
function failure(res: SlotResolution): Extract<SlotResolution, { resolved: false }> {
  if (res.resolved) throw new Error(`esperaba fallo, resolvió a: ${res.value}`);
  return res;
}

const sources: VariableSources = {
  brief: DEMO_BEAUTY_BRIEF,
  persona: DEMO_PERSONA,
  script: DEMO_SCRIPT,
  campaign: { platform: 'tiktok', aspect: '9:16', durationSeconds: 22 },
};

describe('los fixtures de demo son válidos según su contrato', () => {
  it('el brief valida', () => {
    expect(ProductBriefSchema.safeParse(DEMO_BEAUTY_BRIEF).success).toBe(true);
  });
  it('la persona valida', () => {
    expect(PersonaSchema.safeParse(DEMO_PERSONA).success).toBe(true);
  });
  it('el guion valida', () => {
    expect(AdScriptSchema.safeParse(DEMO_SCRIPT).success).toBe(true);
  });
});

describe('resolveSlot — mapa slot→fuente §10.4', () => {
  const resolved: [slot: string, expected: string][] = [
    ['product.name', 'GlowSerum 24h'],
    ['product.category', 'beauty'],
    ['product.hero_image', 'https://cdn.example.com/glowserum-hero.jpg'],
    ['benefit.primary', 'hidrata 24 horas sin sensación grasa'],
    ['benefit[0]', 'hidrata 24 horas sin sensación grasa'],
    ['benefit[1]', 'reduce la tirantez desde el primer uso'],
    ['pain_point', 'la piel tira después de lavarla'],
    ['objection', 'es caro'],
    // ⚠ TRAMPA: rebuttal → objections[0].counter (NO un campo `rebuttal`)
    ['rebuttal', 'dura 3 meses, sale a menos que un café'],
    ['persona.age_range', '25-34'],
    ['persona.descriptor', 'mujer de 29 años, latina, look casual de diario'],
    ['persona.setting', 'baño con luz natural de ventana, encimera con dos o tres productos'],
    ['setting', 'baño con luz natural de ventana, encimera con dos o tres productos'],
    ['avatar.ref', '01JXDEMOREFIMG0000000001'],
    // ⚠ TRAMPA: hook.line/cta.line → AdScript (ya en idioma destino), NO del brief
    ['hook.line', 'Si tu piel tira al despertar, esto es para ti'],
    ['cta.line', 'Pruébalo 30 días sin riesgo, enlace en la bio'],
    ['platform', 'tiktok'],
    ['aspect', '9:16'],
    ['duration', '22'],
  ];

  it.each(resolved)('resuelve %s → %s', (slot, expected) => {
    expect(value(resolveSlot(slot, sources))).toBe(expected);
  });

  it('rebuttal usa `counter`, no un valor inventado (regresión de la trampa)', () => {
    expect(value(resolveSlot('rebuttal', sources))).toBe(DEMO_BEAUTY_BRIEF.objections[0]!.counter);
  });

  it('hook.line viene del AdScript, NUNCA del hook del ángulo del brief', () => {
    // El brief tiene hook_examples distintos: si viniera de ahí, este assert fallaría.
    expect(value(resolveSlot('hook.line', sources))).toBe(DEMO_SCRIPT.hook);
    expect(DEMO_BEAUTY_BRIEF.angles[0]!.hook_examples).not.toContain(DEMO_SCRIPT.hook);
  });
});

describe('resolveSlot — fallos accionables (nombran slot + fuente)', () => {
  it('hook.line sin guion → unresolved con fuente AdScript', () => {
    const f = failure(resolveSlot('hook.line', { ...sources, script: undefined }));
    expect(f.slot).toBe('hook.line');
    expect(f.source).toBe('AdScript');
    expect(f.message).toContain('AdScript');
  });

  it('objection con brief sin objections → unresolved con fuente ProductBrief', () => {
    const briefNoObjections = { ...DEMO_BEAUTY_BRIEF, objections: [] };
    const f = failure(resolveSlot('objection', { ...sources, brief: briefNoObjections }));
    expect(f.slot).toBe('objection');
    expect(f.source).toBe('ProductBrief');
  });

  it('benefit[5] fuera de rango → unresolved que nombra el índice', () => {
    const f = failure(resolveSlot('benefit[5]', sources));
    expect(f.slot).toBe('benefit[5]');
    expect(f.message).toContain('benefits[5]');
  });

  it('aspect ausente en el contexto → unresolved con fuente CampaignContext', () => {
    const f = failure(
      resolveSlot('aspect', { ...sources, campaign: { platform: 'tiktok', durationSeconds: 22 } }),
    );
    expect(f.source).toBe('CampaignContext');
  });
});
