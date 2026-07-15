// RE-VERIFY T2.5 — Cláusula 2 (claim inyectado a mano) + trap de idioma airtight.
// Verifier escéptico, contexto fresco. Inputs PROPIOS, distintos del fixture del implementer
// (`cures acne`) y del verifier anterior (`elimina el eccema`). Se ejerce `lintScript` directamente
// como hará CP3. Determinista, $0, sin red.
//
// Se ejecuta copiando este fichero temporalmente a packages/core/src/scripting/ (el vitest config
// solo incluye src/**) y corriendo `vitest run` targeted; se ELIMINA tras correr. NO se toca código
// de producto ni el test del implementer.
import { describe, expect, it } from 'vitest';

import { AdScriptSchema, type AdScript } from '../contracts/ad-script';
import { GuardrailFlagSchema } from '../contracts/guardrail-flag';
import { lintScript } from './ftc-linter';

// ── Constructor de un AdScript VÁLIDO con texto hablado a medida. El claim se mete en la NARRACIÓN
//    de una escena body + fullText (donde el linter audita), NO en visual/camera/emotion.
function buildScript(opts: {
  language: string;
  hook: string;
  bodyNarration: string;
  cta: string;
}): AdScript {
  const fullText = `${opts.hook} ${opts.bodyNarration} ${opts.cta}`;
  const script: AdScript = {
    filenameCode: 'reverify-c2',
    hook: opts.hook,
    cta: opts.cta,
    scenes: [
      {
        t: 0,
        seconds: 2,
        segment: 'hook',
        narration: opts.hook,
        visual: 'creador a cámara',
        camera: 'close-up',
        emotion: 'curioso',
      },
      {
        t: 2,
        seconds: 4,
        segment: 'body',
        narration: opts.bodyNarration,
        visual: 'producto en mano',
        camera: 'medium',
        emotion: 'seguro',
      },
      {
        t: 6,
        seconds: 2,
        segment: 'cta',
        narration: opts.cta,
        visual: 'pack shot',
        camera: 'static',
        emotion: 'directo',
      },
    ],
    subtitles: [{ start: 0, end: 8, text: fullText }],
    fullText,
    wordCount: fullText.trim().split(/\s+/).length,
    estSeconds: 8,
    tone: 'cercano',
    language: opts.language,
    sharedBodyKey: 'reverify-body',
  };
  // Aserto DURO: es un AdScript real, no un stub que el schema rechazaría.
  return AdScriptSchema.parse(script);
}

// Mi claim propio (salud, distinto de los previos): «revierte la calvicie en 30 días».
const CLAIM_ES = 'revierte la calvicie en 30 días';
const CLAIM_EN = 'reverses baldness in 30 days';

describe('[T2.5 REVERIFY] Cláusula 2 — claim inyectado + trap de idioma airtight', () => {
  it('[POS-ES] claim ES en guion ES / briefLang ES ⇒ banned_claim blocking con explicación + sugerencia', () => {
    const script = buildScript({
      language: 'es',
      hook: 'Mira lo que descubrí sobre el pelo.',
      bodyNarration: `Este tratamiento ${CLAIM_ES}, sin efectos secundarios.`,
      cta: 'Enlace en la bio.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    console.warn('[POS-ES] flags:', JSON.stringify(flags, null, 2));
    const banned = flags.find((f) => f.rule === 'banned_claim');
    expect(banned).toBeDefined();
    expect(banned?.blocking).toBe(true);
    expect(banned?.explanation.length ?? 0).toBeGreaterThan(0);
    expect(banned?.suggestion.length ?? 0).toBeGreaterThan(0);
    // Cada flag es un GuardrailFlag válido de contrato.
    for (const f of flags) GuardrailFlagSchema.parse(f);
  });

  it('[POS-ES-ACCENT] el claim matchea aunque el guion lo escriba SIN tildes (normalización)', () => {
    const script = buildScript({
      language: 'es',
      hook: 'Escucha esto.',
      bodyNarration: 'Dicen que revierte la calvicie en 30 dias, increible.',
      cta: 'Pruebalo.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    console.warn('[POS-ES-ACCENT] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags.some((f) => f.rule === 'banned_claim')).toBe(true);
  });

  it('[NEG-ES] control negativo: mismo idioma, SIN el claim ⇒ no dispara', () => {
    const script = buildScript({
      language: 'es',
      hook: 'Mira este producto.',
      bodyNarration: 'Está formulado para cuidar el cuero cabelludo día a día.',
      cta: 'Enlace en la bio.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    console.warn('[NEG-ES] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags).toEqual([]);
  });

  it('[TRAP-CROSS] claim ES verbatim en guion EN / briefLang ES ⇒ NO dispara (limitación declarada)', () => {
    // El mismo claim español, insertado LITERAL en un guion marcado como `en`. Como
    // script.language (en) !== briefLanguage (es), el linter NO intenta el match. Airtight.
    const script = buildScript({
      language: 'en',
      hook: 'Look what I found.',
      bodyNarration: `They literally say it ${CLAIM_ES} which sounds wild.`,
      cta: 'Link in bio.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    console.warn('[TRAP-CROSS] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags.some((f) => f.rule === 'banned_claim')).toBe(false);
  });

  it('[POS-EN] control positivo cruzado: claim EN en guion EN / briefLang EN ⇒ SÍ dispara (el linter no está muerto)', () => {
    const script = buildScript({
      language: 'en',
      hook: 'Look what I found.',
      bodyNarration: `This treatment ${CLAIM_EN}, no side effects.`,
      cta: 'Link in bio.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_EN], briefLanguage: 'en' });
    console.warn('[POS-EN] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags.some((f) => f.rule === 'banned_claim')).toBe(true);
  });

  it('[TRAP-SAME-ES] refuerzo: el MISMO claim ES en guion ES / briefLang ES SÍ dispara (cierra el par del trap)', () => {
    const script = buildScript({
      language: 'es',
      hook: 'Escucha.',
      bodyNarration: `Este producto ${CLAIM_ES}.`,
      cta: 'Míralo.',
    });
    const flags = lintScript(script, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    expect(flags.some((f) => f.rule === 'banned_claim')).toBe(true);
  });

  it('[CLAIM-IN-VISUAL-ONLY] un claim SOLO en visual/camera/emotion NO dispara (solo se audita lo hablado)', () => {
    // Diseño confirmado: el linter audita fullText/hook/cta/narration, no visual. Este test
    // documenta el límite: si un caller mete el claim solo en `visual`, no se caza.
    const script = buildScript({
      language: 'es',
      hook: 'Mira.',
      bodyNarration: 'Un producto de cuidado capilar.',
      cta: 'Enlace.',
    });
    // Sobrescribo visual con el claim (sin tocar lo hablado).
    const tampered: AdScript = {
      ...script,
      scenes: script.scenes.map((s) =>
        s.segment === 'body' ? { ...s, visual: `cartel que dice ${CLAIM_ES}` } : s,
      ),
    };
    const flags = lintScript(tampered, { bannedClaims: [CLAIM_ES], briefLanguage: 'es' });
    console.warn('[CLAIM-IN-VISUAL-ONLY] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags.some((f) => f.rule === 'banned_claim')).toBe(false);
  });

  it('[FP-POS] patrón de compra: «I bought this» en guion EN ⇒ first_person_purchase', () => {
    const script = buildScript({
      language: 'en',
      hook: 'Honest review.',
      bodyNarration: 'I bought this last month and it changed my life.',
      cta: 'Link in bio.',
    });
    const flags = lintScript(script, { bannedClaims: [], briefLanguage: 'en' });
    console.warn('[FP-POS] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags.some((f) => f.rule === 'first_person_purchase')).toBe(true);
  });

  it('[FOUNDER-POS] «I founded this company» ⇒ founder_first_person', () => {
    const script = buildScript({
      language: 'en',
      hook: 'My story.',
      bodyNarration: 'I founded this company after years of frustration.',
      cta: 'Link in bio.',
    });
    const flags = lintScript(script, { bannedClaims: [], briefLanguage: 'en' });
    console.warn('[FOUNDER-POS] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags.some((f) => f.rule === 'founder_first_person')).toBe(true);
  });

  it('[3RD-PERSON] «The maker built this…» NO da falso positivo de founder', () => {
    const script = buildScript({
      language: 'en',
      hook: 'The story.',
      bodyNarration: 'The maker built this because supermarket creams never worked.',
      cta: 'Link in bio.',
    });
    const flags = lintScript(script, { bannedClaims: [], briefLanguage: 'en' });
    console.warn('[3RD-PERSON] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags).toEqual([]);
  });

  it('[USE-FRAMING-GAP] «Two weeks in, honestly kind of embarrassing…» NO lo caza el linter (hueco documentado)', () => {
    // El residuo borroso: use-framing personal que evade los 3 patrones duros. Se documenta que
    // lintScript==[] aquí NO es compliance completa, es ausencia de los 3 patrones.
    const script = buildScript({
      language: 'en',
      hook: 'Two weeks in, and honestly? Kind of embarrassing how obvious it is.',
      bodyNarration: "It's not the glow. It's that your skin stops feeling tight by morning.",
      cta: 'Link in bio.',
    });
    const flags = lintScript(script, { bannedClaims: [], briefLanguage: 'en' });
    console.warn('[USE-FRAMING-GAP] flags:', JSON.stringify(flags.map((f) => f.rule)));
    expect(flags).toEqual([]); // documentado: el linter NO pretende cazar esto
  });
});
