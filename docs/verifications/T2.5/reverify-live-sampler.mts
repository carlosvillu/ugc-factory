// RE-VERIFY T2.5 — muestreador LIVE propio del verifier. Corre el ScriptWriter contra Sonnet 5
// REAL para el ángulo testimonial + founder, N veces, e IMPRIME los guiones COMPLETOS (body + los
// 3 hooks) + los flags de lintScript sobre cada uno. El objetivo es LEER el texto (lo que el test
// del implementer no expone), no solo asertar flags==[].
//
// Cap propio del verifier: aborta si el coste acumulado superaría MAX_USD. Muy por debajo del cap
// de tarea ($1). Corre: cd repo-root && npx tsx docs/verifications/T2.5/reverify-live-sampler.mts
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Carga la key de .env.test.local (mismo loader que setup-env, sin depender de vitest).
if (existsSync('.env.test.local')) {
  const parsed = parseEnv(readFileSync('.env.test.local', 'utf8'));
  for (const [k, v] of Object.entries(parsed)) process.env[k] ??= v as string;
}

import { makeAngle, makeBrief } from '../../../packages/test-utils/src/factories';
import { composeMatrix } from '../../../packages/core/src/strategy/matrix';
import { HOOK_LINE_SEEDS } from '../../../packages/core/src/library/seed-data';
import { makeScriptWriter } from '../../../packages/core/src/scripting/script-writer';
import { lintScript } from '../../../packages/core/src/scripting/ftc-linter';
import type { AnthropicUsage } from '../../../packages/core/src/analyze/anthropic-client';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY ausente en .env.test.local — no se puede muestrear live.');
  process.exit(2);
}

const RUNS = Number(process.env.SAMPLER_RUNS ?? '3');
const MAX_USD = 0.6; // cap propio del verifier, << $1 de la tarea

function costUsd(u: AnthropicUsage): number {
  return (
    (u.inputTokens * 3) / 1e6 +
    (u.cacheCreationInputTokens * 3 * 1.25) / 1e6 +
    (u.cacheReadInputTokens * 3 * 0.1) / 1e6 +
    (u.outputTokens * 15) / 1e6
  );
}

// Mismo fixture que el test del implementer: brief EN con ángulo founder + testimonial + banned claims.
const BRIEF = makeBrief({
  meta: {
    source_url: 'https://shop.example.com/products/serum',
    platform: 'shopify',
    language: 'en',
    extracted_at: '2026-07-15T12:00:00.000Z',
    extraction_confidence: 'high',
    warnings: [],
  },
  brand: {
    tone_of_voice: 'warm and expert',
    recommended_ad_tone: 'authentic',
    visual_style: {
      palette: ['#F5E9E2'],
      typography: 'serif',
      aesthetic: 'premium',
      photography_style: 'lifestyle',
    },
    banned_or_risky_claims: ['cures acne', 'guaranteed results'],
  },
  angles: [
    makeAngle({
      name: 'Founder origin story',
      framework: 'founder_story',
      hook_examples: ['The story behind why this was made', 'How this brand actually started'],
      key_message: 'The maker built this after years of frustration',
    }),
    makeAngle({
      name: 'Testimonial experience',
      framework: 'transformation',
      hook_examples: ['What happens after two weeks of using this', 'The result nobody talks about'],
      key_message: 'The 24h hydration shows the next morning',
    }),
  ],
});

const PLAN = composeMatrix({
  brief: BRIEF,
  libraryHooks: HOOK_LINE_SEEDS,
  angleCount: 2,
  hooksPerAngle: 3,
  languages: ['en'],
  objective: 'hook_test',
  tier: 'standard',
});

const lintCtx = {
  bannedClaims: BRIEF.brand.banned_or_risky_claims ?? [],
  briefLanguage: BRIEF.meta.language,
};

const writer = makeScriptWriter({ apiKey });
let totalUsd = 0;

for (let run = 1; run <= RUNS; run++) {
  if (totalUsd > MAX_USD) {
    console.error(`\n!! ABORT: coste acumulado $${totalUsd.toFixed(4)} superaría el cap propio $${MAX_USD}`);
    break;
  }
  console.log(`\n\n████████████████████ RUN ${run}/${RUNS} ████████████████████`);
  const res = await writer.write({ plan: PLAN, brief: BRIEF });
  const usage = res.usage;
  const usd = usage ? costUsd(usage) : 0;
  totalUsd += usd;
  console.log(`status=${res.status}  warnings=${JSON.stringify(res.warnings)}  coste=$${usd.toFixed(4)}  acumulado=$${totalUsd.toFixed(4)}`);

  for (const s of res.scripts) {
    const flags = lintScript(s, lintCtx);
    const isFounder = s.filenameCode.toLowerCase().includes('found') || s.sharedBodyKey.toLowerCase().includes('found');
    console.log(`\n── ${s.filenameCode}  (angle key: ${s.sharedBodyKey})  [${s.estSeconds}s]`);
    console.log(`   HOOK: ${s.hook}`);
    for (const sc of s.scenes.filter((x) => x.segment !== 'hook')) {
      console.log(`   ${sc.segment.toUpperCase()}: ${sc.narration}`);
    }
    console.log(`   lintScript flags: ${flags.length === 0 ? '[] (limpio)' : JSON.stringify(flags.map((f) => f.rule))}`);
  }
}

console.log(`\n\n═══════════ COSTE TOTAL DEL MUESTREO: $${totalUsd.toFixed(4)} (${RUNS} runs) ═══════════`);
