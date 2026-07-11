// $0: mide con `count_tokens` (endpoint GRATUITO) el peso REAL del user message del ciclo 3,
// con VisualAnalysis realista, y descompone: system / markdown / bloque VISUAL sin podar vs podado.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import Anthropic from '../../../packages/core/node_modules/@anthropic-ai/sdk/index.mjs';

import { BRIEF_SYNTHESIZER_SYSTEM_PROMPT } from '../../../packages/core/prompts/brief-synthesizer';
import {
  buildUserMessage,
  trimVisualAnalysis,
  truncateMarkdown,
  BRIEF_SYNTHESIZER_MODEL,
} from '../../../packages/core/src/analyze/brief-synthesizer';
import { createDb } from '../../../packages/db/src/index';
import { loadAnthropicKey } from '../../../apps/web/src/server/anthropic-service';
import { deriveSecretsKey } from '../../../packages/core/src/secrets/index';
import type { RawContent, VisualAnalysis } from '../../../packages/core/src/contracts/index';

const EV = join(process.cwd(), 'docs/verifications/T1.8');
const log = (s: string): void => process.stderr.write(s + '\n');

async function main(): Promise<void> {
  const db = createDb(process.env.DATABASE_URL ?? '');
  const key = deriveSecretsKey(process.env.APP_MASTER_KEY ?? '');
  const apiKey = await loadAnthropicKey(db, key, 'count-tokens-c3');
  const client = new Anthropic({ apiKey });

  const { visual1, visual2 } = JSON.parse(await readFile(join(EV, 'visual-c3.json'), 'utf8')) as {
    visual1: VisualAnalysis;
    visual2: VisualAnalysis;
  };
  const md2 = await readFile(join(EV, 'markdown-url2.md'), 'utf8');

  const count = async (text: string): Promise<number> => {
    const r = await client.messages.countTokens({
      model: BRIEF_SYNTHESIZER_MODEL,
      messages: [{ role: 'user', content: text }],
    });
    return r.input_tokens;
  };

  log(`system prompt: ${String(await count(BRIEF_SYNTHESIZER_SYSTEM_PROMPT))} tok`);
  log(`markdown ugmonk COMPLETO (${String(md2.length)} chars): ${String(await count(md2))} tok`);
  const trunc = truncateMarkdown(md2);
  log(`markdown ugmonk TRUNCADO (${String(trunc.length)} chars): ${String(await count(trunc))} tok`);
  log(`VISUAL ugmonk SIN PODAR (${String(visual2.images.length)} imgs): ${String(await count(JSON.stringify(visual2)))} tok`);
  const trimmed = trimVisualAnalysis(visual2);
  log(`VISUAL ugmonk PODADO (${String(trimmed.images.length)} imgs): ${String(await count(JSON.stringify(trimmed)))} tok`);
  log(`  hero preservado? hero_image_url=${String(visual2.hero_image_url)}`);
  log(`  hero está en las podadas? ${String(trimmed.images.some((i) => i.url === visual2.hero_image_url))}`);
  log(`  suitability de las podadas: ${trimmed.images.map((i) => i.video_suitability).join(',')}`);

  const rawFull = (visual: VisualAnalysis, md: string): RawContent => ({
    source: 'url', url: 'https://ugmonk.com/products/analog-starter-kit', platform: 'shopify',
    markdown: md, images: visual.images.map((i) => ({ url: i.url, alt: null })),
    branding: { name: 'Ugmonk', logoUrl: null, colors: [] },
    product: { title: 'Analog Starter Kit', price: '$99.00', currency: 'USD' },
    screenshotRef: null,
  });

  const um = buildUserMessage({ raw: rawFull(visual2, md2), visualAnalysis: visual2, targetLanguage: 'es', extractedAt: '2026-07-11T00:00:00Z' });
  const umTok = await count(um);
  log(`\nUSER MESSAGE ciclo 3 (${String(um.length)} chars): ${String(umTok)} tok`);
  const sysTok = await count(BRIEF_SYNTHESIZER_SYSTEM_PROMPT);
  log(`INPUT TOTAL (system+user) = ${String(sysTok + umTok)} tok`);
  log(`  → coste input FRÍO (cache_write system 1,25x): $${((sysTok * 3 * 1.25) / 1e6 + (umTok * 3) / 1e6).toFixed(4)}`);
  log(`  → coste input CALIENTE (cache_read system 0,1x): $${((sysTok * 3 * 0.1) / 1e6 + (umTok * 3) / 1e6).toFixed(4)}`);
  log(`  → presupuesto restante para output bajo $0,15 (frío): ${String(Math.round(((0.15 - ((sysTok * 3 * 1.25) / 1e6 + (umTok * 3) / 1e6)) / 15) * 1e6))} tok`);
  process.exit(0);
}

main().catch((e: unknown) => { log(String(e)); process.exit(1); });
