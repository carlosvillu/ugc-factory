// Verifier's OWN unresolved-slot probe (T3.5 Verificación mitad 3): un slot irresoluble debe
// producir un CompileIssue que NOMBRA el slot Y su fuente. Rompo la fuente a propósito.
import { validateGallerySeed, RAW_GALLERY_SEED } from '../../../packages/core/src/gallery/index';
import { compilePrompt } from '../../../packages/core/src/gallery/compile-prompt';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT } from '../../../packages/core/src/gallery/compile-fixtures';
const v = validateGallerySeed(RAW_GALLERY_SEED);
if (!v.ok || !v.seed) throw new Error('seed no valida');
const { templates, guardPacks } = v.seed;
const tpl = templates.find(t => t.slug === 'grwm-beauty-pain-point')!;
const base = { brief: DEMO_BEAUTY_BRIEF, persona: DEMO_PERSONA, script: DEMO_SCRIPT, campaign: { platform: 'tiktok', aspect: '9:16', durationSeconds: 22 } };

// Caso A: brief SIN pain_points (el template grww usa {pain_point})
const briefNoPain = { ...DEMO_BEAUTY_BRIEF, pain_points: [] };
const rA = compilePrompt({ template: tpl, sources: { ...base, brief: briefNoPain }, guardPacks });
console.log('CASO A (brief.pain_points = []):', rA.ok ? 'ok:true (INESPERADO)' : JSON.stringify(rA.issues, null, 2));

// Caso B: persona SIN setting (¿el template usa {setting}/{persona.setting}? probamos igualmente
// con un template distinto forzando el slot). Rompo script para hook.line.
const rB = compilePrompt({ template: tpl, sources: { ...base, script: undefined }, guardPacks });
console.log('CASO B (script undefined → hook.line/cta.line):', rB.ok ? 'ok:true (INESPERADO)' : JSON.stringify(rB.issues, null, 2));
