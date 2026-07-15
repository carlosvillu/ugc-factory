// Unit del LINTER FTC (T2.5, §15.1/§15.2). Lógica PURA: se llama con un `AdScript` y opts, se
// asserta sobre los `GuardrailFlag[]` devueltos. Sin red, sin mocks (unit-core.md §7).
//
// EXHAUSTIVIDAD (unit-core.md §11): cada regla del catálogo tiene ≥1 caso que BLOQUEA y ≥1 caso
// legítimo cercano que PASA — el par positivo/negativo pegado a la frontera caza regexes agresivas.
// Además: el TRAP DE IDIOMA (guion en `en`, claims en `es`), el control negativo (guion limpio → 0
// flags), y que explanation+suggestion nunca vienen vacías (requisito de producto «con explicación
// y sugerencia»).
import { describe, expect, it } from 'vitest';

import { AdScriptSchema, type AdScript } from '../contracts/ad-script';
import type { GuardrailRule } from '../contracts/guardrail-flag';
import { lintScript } from './ftc-linter';

/**
 * Construye un `AdScript` VÁLIDO cuyo texto hablado es `fullText`. NO es la factory `makeAdScript`
 * de `@ugc/test-utils` (esa devuelve una FILA de BD `NewAdScript`, con `scenes[{index,text,seconds}]`
 * — otro shape). Aquí necesitamos el CONTRATO de core (`AdScript`, `scenes[{t,seconds,segment,…}]`),
 * así que se construye local y se valida contra `AdScriptSchema` para no probar sobre basura.
 *
 * El linter audita `fullText` + `hook` + `cta` + narración de escenas; para tener control total del
 * texto auditado, todo el texto va en la escena de body y `hook`/`cta` son neutros salvo que el caso
 * los fije. Cada caso pasa el texto bajo prueba en `body` (una sola escena).
 */
function makeScript(overrides: {
  body: string;
  language?: string;
  hook?: string;
  cta?: string;
}): AdScript {
  const { body, language = 'es', hook = 'Mira esto.', cta = 'Enlace abajo.' } = overrides;
  const script: AdScript = {
    filenameCode: 'demo-x-es-30s',
    hook,
    cta,
    scenes: [
      {
        t: 0,
        seconds: 2,
        segment: 'hook',
        narration: hook,
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      {
        t: 2,
        seconds: 5,
        segment: 'body',
        narration: body,
        visual: 'v',
        camera: 'c',
        emotion: 'e',
      },
      { t: 7, seconds: 2, segment: 'cta', narration: cta, visual: 'v', camera: 'c', emotion: 'e' },
    ],
    subtitles: [{ start: 0, end: 2, text: hook }],
    fullText: `${hook} ${body} ${cta}`,
    wordCount: `${hook} ${body} ${cta}`.trim().split(/\s+/).length,
    estSeconds: 9,
    tone: 'cercano',
    language,
    sharedBodyKey: 'body-key',
  };
  // Red de seguridad: si el fixture deja de ser un AdScript válido, el test falla por eso, no por el
  // linter (unit-core.md: fixture inválido = fixture válido + mutación dirigida).
  expect(AdScriptSchema.safeParse(script).success).toBe(true);
  return script;
}

const CTX = { bannedClaims: ['cura el acné', 'resultados garantizados'], briefLanguage: 'es' };

// ── CASOS QUE BLOQUEAN: una fila por regla, con el texto que la dispara ──────────────────────────
const blocking: { name: string; script: AdScript; rule: GuardrailRule }[] = [
  {
    name: 'claim prohibido literal (banned_claim)',
    script: makeScript({ body: 'Este sérum cura el acné en tres días.' }),
    rule: 'banned_claim',
  },
  {
    name: 'claim prohibido con mayúsculas y sin acento (banned_claim, normalizado)',
    script: makeScript({ body: 'CURA EL ACNE, de verdad.' }),
    rule: 'banned_claim',
  },
  {
    name: 'primera persona de compra en es (first_person_purchase)',
    script: makeScript({ body: 'Me lo compré y me cambió la vida.' }),
    rule: 'first_person_purchase',
  },
  {
    // REGRESIÓN: el patrón anterior exigía EXACTAMENTE una palabra entre «llevo» y el verbo, así que
    // la forma NATURAL de un testimonio con cuantificador («llevo 3 meses usándolo», «llevo dos
    // semanas usando») se colaba. Esta fila era ROJA antes del fix y es VERDE después.
    name: 'uso prolongado con cuantificador numérico en es (first_person_purchase)',
    script: makeScript({ body: 'Llevo 3 meses usándolo y no lo cambio por nada.' }),
    rule: 'first_person_purchase',
  },
  {
    name: 'uso prolongado con cuantificador de palabras en es (first_person_purchase)',
    script: makeScript({ body: 'Llevo dos semanas usando esto todos los días.' }),
    rule: 'first_person_purchase',
  },
  {
    name: 'primera persona de compra en en (first_person_purchase)',
    script: makeScript({ body: 'I bought this and it changed my life.', language: 'en' }),
    rule: 'first_person_purchase',
  },
  {
    name: 'founder en primera persona en es (founder_first_person)',
    script: makeScript({ body: 'Yo fundé esta empresa y creé este producto.' }),
    rule: 'founder_first_person',
  },
  {
    name: 'founder en primera persona en en (founder_first_person)',
    script: makeScript({ body: "I'm the founder and I built this brand.", language: 'en' }),
    rule: 'founder_first_person',
  },
];

describe('lintScript — bloqueos con explicación y sugerencia', () => {
  it.each(blocking)('bloquea: $name', ({ script, rule }) => {
    const flags = lintScript(script, CTX);
    const flag = flags.find((f) => f.rule === rule);
    expect(flag).toBeDefined();
    if (!flag) return;
    expect(flag.blocking).toBe(true);
    expect(flag.excerpt.length).toBeGreaterThan(0); // señala DÓNDE
    expect(flag.explanation.length).toBeGreaterThan(0); // explica POR QUÉ (§15.2)
    expect(flag.suggestion.length).toBeGreaterThan(0); // propone alternativa compliant (§15.2)
  });
});

// ── CONTROLES NEGATIVOS: el patrón correcto NO puede dar falso positivo ──────────────────────────
const clean: { name: string; script: AdScript }[] = [
  {
    name: 'creator-style demo en en (frontera de first_person_purchase)',
    script: makeScript({ body: 'This serum hydrates in seconds — watch this.', language: 'en' }),
  },
  {
    name: 'founder-origin en tercera persona educator en en (frontera de founder_first_person)',
    script: makeScript({
      body: 'The maker built this because nothing on the market worked.',
      language: 'en',
    }),
  },
  {
    name: 'demo neutra en es sin claims ni primera persona',
    script: makeScript({ body: 'Este sérum hidrata la piel durante horas. Míralo.' }),
  },
  {
    name: 'origen founder en tercera persona en es',
    script: makeScript({ body: 'Quien lo creó lo hizo porque nada le funcionaba.' }),
  },
  {
    // FRONTERA del patrón laxo de «llevo … usa»: un «llevo» benigno (transportar, no usar-durante)
    // sin verbo `usar` cerca NO debe disparar. El tope de 3 palabras + lazy mantiene el patrón
    // honesto (no una máquina de falsos positivos) al no existir aquí ningún «us…» que enganchar.
    name: 'llevo benigno (transportar) en es (frontera de first_person_purchase)',
    script: makeScript({ body: 'Llevo el producto en el bolso a todas partes.' }),
  },
];

describe('lintScript — guiones limpios no disparan nada (la señal no es ruido)', () => {
  it.each(clean)('limpio: $name', ({ script }) => {
    expect(lintScript(script, CTX)).toEqual([]);
  });
});

// ── EL TRAP DE IDIOMA — guion en `en`, claims en `es`: la prueba de que la Verificación verifica ──
describe('lintScript — cruce de idiomas (comportamiento DECLARADO)', () => {
  it('banned_claim NO se detecta cuando el guion está en otro idioma que los claims', () => {
    // Claims en es, guion en en. El detector de claims por substring NO aplica cross-idioma (un
    // claim español no aparece verbatim en un guion inglés). Comportamiento declarado en el linter.
    const script = makeScript({
      body: 'This cures acne fast, guaranteed results.',
      language: 'en',
    });
    const flags = lintScript(script, { bannedClaims: ['cura el acné'], briefLanguage: 'es' });
    expect(flags.map((f) => f.rule)).not.toContain('banned_claim');
  });

  it('los detectores de idioma DESTINO SÍ actúan aunque los claims estén en otro idioma', () => {
    // El guion en en trae «I bought this» — se caza por el patrón EN, con claims en es. Esto
    // demuestra que first_person/founder dependen del idioma del GUION, no del brief.
    const script = makeScript({ body: 'I bought this and it saved my skin.', language: 'en' });
    const flags = lintScript(script, { bannedClaims: ['cura el acné'], briefLanguage: 'es' });
    expect(flags.map((f) => f.rule)).toContain('first_person_purchase');
  });

  it('banned_claim SÍ se detecta cuando guion y claims comparten idioma (el caso normal)', () => {
    const script = makeScript({ body: 'Este producto cura el acné.', language: 'es' });
    const flags = lintScript(script, { bannedClaims: ['cura el acné'], briefLanguage: 'es' });
    expect(flags.map((f) => f.rule)).toContain('banned_claim');
  });

  it('idioma destino sin patrones (p. ej. fr) → no se inventa detección de idioma destino', () => {
    // Limitación declarada: sin patrones para el idioma, first_person/founder no se detectan. El
    // claim SÍ si coincide el idioma del brief. Aquí brief=fr, claims fr → banned_claim sí.
    const script = makeScript({ body: "J'ai acheté ça, cure l'acné garanti.", language: 'fr' });
    const flags = lintScript(script, { bannedClaims: ["cure l'acné"], briefLanguage: 'fr' });
    expect(flags.map((f) => f.rule)).toContain('banned_claim');
    expect(flags.map((f) => f.rule)).not.toContain('first_person_purchase'); // sin patrones fr
  });
});

// ── EL LINTER AUDITA HOOK Y CTA, no solo el body (§15.2: «guiones y hooks») ──────────────────────
describe('lintScript — cobertura de hook y cta', () => {
  it('caza una violación que vive en el HOOK', () => {
    const script = makeScript({
      body: 'Texto neutro del cuerpo.',
      hook: 'I bought this last week.',
      language: 'en',
    });
    expect(lintScript(script, CTX).map((f) => f.rule)).toContain('first_person_purchase');
  });

  it('caza un claim prohibido que vive en el CTA', () => {
    const script = makeScript({
      body: 'Texto neutro del cuerpo.',
      cta: 'Cómpralo: cura el acné.',
      language: 'es',
    });
    expect(lintScript(script, CTX).map((f) => f.rule)).toContain('banned_claim');
  });

  it('NO audita los campos visuales (visual/camera/emotion no son texto hablado)', () => {
    // El texto hablado es limpio; si el linter mirara `visual` con «I bought this» flaggearía. No
    // debe: §15.2 audita guiones y hooks (lo hablado), no la descripción de plano.
    const base = makeScript({ body: 'This hydrates your skin.', language: 'en' });
    const withDirtyVisual: AdScript = {
      ...base,
      scenes: base.scenes.map((s) =>
        s.segment === 'body' ? { ...s, visual: 'I bought this and it changed my life' } : s,
      ),
    };
    expect(lintScript(withDirtyVisual, CTX)).toEqual([]);
  });
});
