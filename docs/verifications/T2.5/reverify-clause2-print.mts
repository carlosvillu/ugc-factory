// Imprime los flags reales de lintScript para las claves del trap (evidencia legible).
// Corre con: cd packages/core && npx tsx ../../docs/verifications/T2.5/reverify-clause2-print.mts
import { AdScriptSchema, type AdScript } from '../../../packages/core/src/contracts/ad-script';
import { lintScript } from '../../../packages/core/src/scripting/ftc-linter';

function build(o: { language: string; hook: string; body: string; cta: string }): AdScript {
  const fullText = `${o.hook} ${o.body} ${o.cta}`;
  return AdScriptSchema.parse({
    filenameCode: 'reverify-c2',
    hook: o.hook,
    cta: o.cta,
    scenes: [
      { t: 0, seconds: 2, segment: 'hook', narration: o.hook, visual: 'v', camera: 'c', emotion: 'e' },
      { t: 2, seconds: 4, segment: 'body', narration: o.body, visual: 'v', camera: 'c', emotion: 'e' },
      { t: 6, seconds: 2, segment: 'cta', narration: o.cta, visual: 'v', camera: 'c', emotion: 'e' },
    ],
    subtitles: [{ start: 0, end: 8, text: fullText }],
    fullText,
    wordCount: fullText.trim().split(/\s+/).length,
    estSeconds: 8,
    tone: 'cercano',
    language: o.language,
    sharedBodyKey: 'k',
  });
}
const CLAIM_ES = 'revierte la calvicie en 30 días';
const CLAIM_EN = 'reverses baldness in 30 days';

const cases: Array<[string, AdScript, { bannedClaims: string[]; briefLanguage: string }]> = [
  ['POS-ES (es/es, claim ES)', build({ language: 'es', hook: 'Mira.', body: `Este tratamiento ${CLAIM_ES}.`, cta: 'Enlace.' }), { bannedClaims: [CLAIM_ES], briefLanguage: 'es' }],
  ['NEG-ES (es/es, sin claim)', build({ language: 'es', hook: 'Mira.', body: 'Cuida el cuero cabelludo.', cta: 'Enlace.' }), { bannedClaims: [CLAIM_ES], briefLanguage: 'es' }],
  ['TRAP-CROSS (en script / es briefLang, claim ES verbatim)', build({ language: 'en', hook: 'Look.', body: `They say ${CLAIM_ES} which is wild.`, cta: 'Bio.' }), { bannedClaims: [CLAIM_ES], briefLanguage: 'es' }],
  ['POS-EN (en/en, claim EN)', build({ language: 'en', hook: 'Look.', body: `This ${CLAIM_EN}.`, cta: 'Bio.' }), { bannedClaims: [CLAIM_EN], briefLanguage: 'en' }],
];
for (const [label, script, ctx] of cases) {
  const flags = lintScript(script, ctx);
  console.log(`\n=== ${label} ===`);
  console.log(`  script.language=${script.language} briefLanguage=${ctx.briefLanguage}`);
  console.log(`  flags (${flags.length}):`, JSON.stringify(flags, null, 2));
}
