import { validateGallerySeed, RAW_GALLERY_SEED } from '../../../packages/core/src/gallery/index';
import { compilePrompt } from '../../../packages/core/src/gallery/compile-prompt';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT } from '../../../packages/core/src/gallery/compile-fixtures';
const v = validateGallerySeed(RAW_GALLERY_SEED);
if (!v.ok || !v.seed) throw new Error('seed no valida');
const { templates, guardPacks } = v.seed;
const bySlug = (s: string) => templates.find(t => t.slug === s)!;
const base = { brief: DEMO_BEAUTY_BRIEF, persona: DEMO_PERSONA, script: DEMO_SCRIPT, campaign: { platform: 'tiktok', aspect: '9:16', durationSeconds: 22 } };
for (const [slug, platform] of [['grwm-beauty-pain-point','tiktok'],['unboxing-saas-authority','reels'],['before-after-fitness-transformation','tiktok']] as const) {
  const r = compilePrompt({ template: bySlug(slug), sources: { ...base, campaign: { ...base.campaign, platform } }, guardPacks });
  if (!r.ok) { console.log(slug, 'FAILED', JSON.stringify(r.issues)); continue; }
  console.log(slug, '→ keys:', r.result.guardPackKeysUsed.join(', '));
}
