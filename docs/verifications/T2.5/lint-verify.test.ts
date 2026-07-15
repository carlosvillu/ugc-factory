// VERIFIER SCRIPT (T2.5, clause 2 + objective negative/positive controls) — NOT the implementer's.
// Escrito por el verifier con SUS PROPIOS inputs (claim médico distinto del fixture del implementer).
// Construye AdScript reales validados contra AdScriptSchema, y ejerce lintScript directamente
// (como hará CP3/T2.6). Determinista, $0, sin red.
//
// Se ejecuta con: pnpm --filter @ugc/core exec vitest run --config <thisdir>/vitest.config.ts
import { describe, expect, it } from 'vitest';
import { lintScript } from '../../../packages/core/src/scripting/ftc-linter';
import { AdScriptSchema, type AdScript } from '../../../packages/core/src/contracts/ad-script';
import { GuardrailFlagSchema } from '../../../packages/core/src/contracts/guardrail-flag';

/** Construye un AdScript REAL (validado por el contrato) a partir del texto hablado por escena.
 *  El verifier NO reutiliza la factory de DB (shape distinto): construye el shape de core. */
function buildScript(opts: {
  language: string;
  hook: string;
  bodyNarration: string;
  cta: string;
}): AdScript {
  const raw = {
    filenameCode: 'A1-H1',
    hook: opts.hook,
    cta: opts.cta,
    scenes: [
      { t: 0, seconds: 3, segment: 'hook' as const, narration: opts.hook, visual: 'producto en mano', camera: 'close-up', emotion: 'curioso' },
      { t: 3, seconds: 6, segment: 'body' as const, narration: opts.bodyNarration, visual: 'demo de uso', camera: 'medium', emotion: 'confiado' },
      { t: 9, seconds: 3, segment: 'cta' as const, narration: opts.cta, visual: 'packshot', camera: 'static', emotion: 'directo' },
    ],
    subtitles: [{ start: 0, end: 12, text: `${opts.hook} ${opts.bodyNarration} ${opts.cta}` }],
    fullText: `${opts.hook} ${opts.bodyNarration} ${opts.cta}`,
    wordCount: 30,
    estSeconds: 12,
    tone: 'cercano',
    language: opts.language,
    sharedBodyKey: 'body-A1',
  };
  // Prueba de que el guion es un AdScript LEGÍTIMO, no un objeto a medias que engaña al linter.
  return AdScriptSchema.parse(raw);
}

// Claim médico prohibido ELEGIDO POR EL VERIFIER (distinto de 'cures acne' del implementer).
const CLAIM_ES = 'elimina el eccema por completo';
const CLAIM_EN = 'eliminates eczema completely';

describe('T2.5 verifier — clause 2: banned claim injected by hand', () => {
  it('POSITIVO: claim ES inyectado en guion ES ⇒ banned_claim blocking con explicación+sugerencia compliant', () => {
    const script = buildScript({
      language: 'es',
      hook: 'Tu piel merece algo mejor.',
      bodyNarration: `Este serum ${CLAIM_ES} en dos semanas segun nuestros usuarios.`,
      cta: 'Pruebalo hoy.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    console.log('[POS-ES] flags =', JSON.stringify(flags, null, 2));

    const banned = flags.filter((f) => f.rule === 'banned_claim');
    expect(banned).toHaveLength(1);
    // Cada flag DEBE validar el contrato (blocking, explanation .min(1), suggestion .min(1)).
    for (const f of banned) GuardrailFlagSchema.parse(f);
    expect(banned[0]?.blocking).toBe(true);
    expect(banned[0]?.explanation.length).toBeGreaterThan(20);
    expect(banned[0]?.suggestion.length).toBeGreaterThan(20);
    // El excerpt debe señalar el claim.
    expect(banned[0]?.excerpt.toLowerCase()).toContain('eccema');
  });

  it('CONTROL NEGATIVO: mismo idioma, SIN el claim ⇒ NO dispara banned_claim', () => {
    const script = buildScript({
      language: 'es',
      hook: 'Tu piel merece algo mejor.',
      bodyNarration: 'Este serum esta formulado para ayudar a hidratar la piel seca.',
      cta: 'Pruebalo hoy.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    console.log('[NEG-ES] flags =', JSON.stringify(flags));
    expect(flags.filter((f) => f.rule === 'banned_claim')).toHaveLength(0);
  });

  it('TRAP DE IDIOMA: claim ES (briefLanguage es) contra guion EN ⇒ banned_claim NO se detecta (limitación declarada)', () => {
    // El texto del guion en inglés NO contiene el claim español verbatim, y aunque lo contuviera,
    // el linter salta el bloque por script.language !== briefLanguage. Confirmamos el comportamiento
    // DECLARADO en la cabecera (líneas 22-29) y el código (línea 207).
    const script = buildScript({
      language: 'en',
      hook: 'Your skin deserves better.',
      bodyNarration: 'This serum is formulated to help hydrate dry skin over time.',
      cta: 'Try it today.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    console.log('[TRAP-CROSS] flags =', JSON.stringify(flags));
    expect(flags.filter((f) => f.rule === 'banned_claim')).toHaveLength(0);
  });

  it('CONTROL POSITIVO cruzado: claim EN contra guion EN (briefLanguage en) ⇒ SÍ dispara (prueba que el linter no está muerto)', () => {
    const script = buildScript({
      language: 'en',
      hook: 'Your skin deserves better.',
      bodyNarration: `This serum ${CLAIM_EN} in two weeks, users report.`,
      cta: 'Try it today.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_EN], briefLanguage: 'en' });
    console.log('[POS-EN] flags =', JSON.stringify(flags));
    expect(flags.filter((f) => f.rule === 'banned_claim')).toHaveLength(1);
  });
});

describe('T2.5 verifier — clauses 1 & 3 objective: first_person / founder patterns on hand-built scripts', () => {
  it('un guion EN con "I bought this" ⇒ first_person_purchase (prueba que el patrón caza lo que la cláusula 1 prohíbe)', () => {
    const script = buildScript({
      language: 'en',
      hook: 'This changed everything.',
      bodyNarration: 'I bought this last month and now my mornings are different.',
      cta: 'Link in bio.',
    });
    const flags = lintScript(script, { bannedClaims: [], briefLanguage: 'en' });
    console.log('[FP-POS] flags =', JSON.stringify(flags));
    expect(flags.some((f) => f.rule === 'first_person_purchase')).toBe(true);
  });

  it('un guion EN founder en 1ª persona "I founded this brand" ⇒ founder_first_person', () => {
    const script = buildScript({
      language: 'en',
      hook: 'The story behind this.',
      bodyNarration: 'I founded this company because nothing on the market worked for me.',
      cta: 'Learn more.',
    });
    const flags = lintScript(script, { bannedClaims: [], briefLanguage: 'en' });
    console.log('[FOUNDER-POS] flags =', JSON.stringify(flags));
    expect(flags.some((f) => f.rule === 'founder_first_person')).toBe(true);
  });

  it('CONTROL: guion EN creator-style en 3ª persona ("The maker built this") ⇒ SIN flags (no falso positivo)', () => {
    const script = buildScript({
      language: 'en',
      hook: 'The story behind this serum.',
      bodyNarration: 'The maker built this after years of frustration; here is what it does for dry skin.',
      cta: 'Learn more.',
    });
    const flags = lintScript(script, { bannedClaims: [], briefLanguage: 'en' });
    console.log('[3RD-PERSON] flags =', JSON.stringify(flags));
    expect(flags).toEqual([]);
  });

  it('el "my skin used to tighten... now it just doesnt" (patrón que el implementer levantó) ⇒ CONFIRMA que el linter NO lo caza', () => {
    // Item de juicio honesto: este texto suena a resultado personal de cliente pero cae FUERA de los
    // 3 patrones. El verifier CONFIRMA que efectivamente no dispara (para dejar constancia del hueco).
    const script = buildScript({
      language: 'en',
      hook: 'Real change takes time.',
      bodyNarration: 'My skin used to tighten after every shower; now it just doesnt.',
      cta: 'See for yourself.',
    });
    const flags = lintScript(script, { bannedClaims: [], briefLanguage: 'en' });
    console.log('[SOFT-GAP] flags =', JSON.stringify(flags));
    // NO afirmamos que esto sea correcto — solo documentamos el comportamiento real: el linter no lo caza.
    expect(flags).toEqual([]);
  });
});
