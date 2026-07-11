// VERIFIER-OWNED driver del CICLO 4 (T1.8 · BriefSynthesizer). NO es del implementer.
//
// POR QUÉ EXISTE (y por qué NO basta con reutilizar el ciclo 3): el system prompt (20:30) y el
// synthesizer (20:33) se MODIFICARON DESPUÉS de la corrida de pago del ciclo 3 (20:09-20:12). El
// número de 19 cts que medí entonces es contra un prompt QUE YA NO EXISTE (se añadieron las reglas
// 6.3.b "no infles el brief" y 6.3.c "assets.images no es un vertedero"). Dos efectos posibles:
//   - el prefijo del system CRECE  → más cache_write → el coste EN FRÍO puede SUBIR.
//   - la regla 6.3.c poda el eco de `assets` → el output puede BAJAR.
// Ninguno de los dos se puede razonar: se miden.
//
// Y como la llamada fría se paga IGUAL, se cosechan de ESE brief fresco TODAS las observables que
// dependen del modelo (Zod, evidence literal, ángulos distintos, coherencia de assets). Reutilizar
// la calidad del ciclo 3 mientras se paga un brief nuevo sería certificar el prompt VIEJO.
//
// UNA SOLA llamada de pago (presupuesto: el usuario pidió $0,20-0,30).
// Uso: npx tsx --env-file-if-exists=.env docs/verifications/T1.8/verify-brief-c4.ts
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runSynthesizeBrief } from '../../../apps/web/src/server/synthesize-brief';
import { deriveSecretsKey } from '../../../packages/core/src/secrets/index';
import { createDb, createProject } from '../../../packages/db/src/index';
import type { RawContent, VisualAnalysis } from '../../../packages/core/src/contracts/index';

const EV = join(process.cwd(), 'docs/verifications/T1.8');
const log = (s: string): void => process.stderr.write(s + '\n');

const URL_1 = 'https://www.allbirds.com/products/mens-tree-runners';

/** Mismo constructor de VisualAnalysis REALISTA que el ciclo 3 (verify-brief-c3.ts): URLs de CDN
 *  reales sacadas del markdown guardado, para que el bloque VISUAL pese lo que pesa en producción. */
function imageUrls(markdown: string): string[] {
  const urls = [
    ...markdown.matchAll(/https?:\/\/[^\s)"']+\.(?:jpg|jpeg|png|webp)(?:\?[^\s)"']*)?/gi),
  ].map((m) => m[0]);
  return [...new Set(urls)];
}

function makeRealisticVisual(markdown: string, target: number, palette: string[], aesthetic: string): VisualAnalysis {
  const urls = imageUrls(markdown);
  const widths = [180, 360, 493, 720, 1080, 1440, 1946, 2400, 3840];
  const all: string[] = [];
  for (let i = 0; all.length < target; i++) {
    const base = urls[i % urls.length];
    const w = widths[Math.floor(i / urls.length) % widths.length];
    const variant = base.includes('width=')
      ? base.replace(/width=\d+/, `width=${String(w)}`)
      : `${base}&width=${String(w)}`;
    if (!all.includes(variant)) all.push(variant);
    if (i > target * 4) break;
  }

  const kinds = ['packshot', 'lifestyle', 'detail', 'infographic', 'chart_or_text', 'other'] as const;
  const backgrounds = ['clean', 'busy', 'transparent', 'unknown'] as const;

  const images = all.map((url, i) => {
    const suit = i < 4 ? 'hero' : i % 3 === 0 ? 'broll' : i % 3 === 1 ? 'unusable' : 'broll';
    return {
      url,
      kind: kinds[i % kinds.length],
      has_overlay_text: i % 5 === 0,
      background: backgrounds[i % backgrounds.length],
      video_suitability: suit as 'hero' | 'broll' | 'unusable',
    };
  });

  return {
    images,
    hero_image_url: images[0]?.url ?? null,
    brand_style: {
      palette,
      aesthetic,
      photography_style: 'fotografía de producto natural con luz suave y fondos neutros',
    },
    rendered_social_proof: {
      rating: 4.7,
      review_count: 2108,
      quotes: [
        'The most comfortable shoes I have ever owned, I wear them every single day.',
        'Bought a second pair within a week. Worth every penny.',
      ],
    },
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    log(`verify-brief-c4: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const masterKey = requireEnv('APP_MASTER_KEY');

  const db = createDb(databaseUrl);
  const secretsKey = deriveSecretsKey(masterKey);
  const projectId = (await createProject(db, { name: `verify-T1.8-c4 ${new Date().toISOString()}` })).id;
  log(`verify-brief-c4: project = ${projectId}`);

  const md1 = await readFile(join(EV, 'markdown-url1.md'), 'utf8');
  const visual1 = makeRealisticVisual(md1, 27, ['#F5F0E8', '#2E2E2E', '#7BA05B', '#FFFFFF'], 'earthy minimal');
  log(`verify-brief-c4: markdown=${String(md1.length)} chars · visual=${String(visual1.images.length)} imgs`);

  const raw1: RawContent = {
    source: 'url',
    url: URL_1,
    platform: 'shopify',
    markdown: md1,
    images: visual1.images.map((i) => ({ url: i.url, alt: null })),
    branding: null,
    product: null,
    screenshotRef: null,
  };

  // LA ÚNICA LLAMADA DE PAGO. FRÍA: el prompt cambió (nuevo prefijo) y la caché ephemeral del ciclo
  // 3 (hace horas) está muerta → esta llamada ESCRIBE la caché. Es el régimen que el planning (nota
  // 5) declara "el número honesto".
  log('\n--- [1] URL_1 allbirds — llamada FRÍA contra el PROMPT NUEVO (6.3.b + 6.3.c) ---');
  const t0 = Date.now();
  const r1 = await runSynthesizeBrief(
    { db, secretsKey },
    { projectId, raw: raw1, visualAnalysis: visual1, targetLanguage: 'es' },
  );
  const ms = Date.now() - t0;

  const u = r1.usage;
  log(`status   = ${r1.status}`);
  log(`warnings = ${JSON.stringify(r1.warnings)}`);
  log(`latencia = ${String(ms)} ms`);
  if (u) {
    const usd =
      (u.inputTokens * 3) / 1e6 +
      (u.cacheCreationInputTokens * 3 * 1.25) / 1e6 +
      (u.cacheReadInputTokens * 3 * 0.1) / 1e6 +
      (u.outputTokens * 15) / 1e6;
    log(
      `usage    = in=${String(u.inputTokens)} out=${String(u.outputTokens)} cache_write=${String(u.cacheCreationInputTokens)} cache_read=${String(u.cacheReadInputTokens)}`,
    );
    log(`REGIMEN  = ${u.cacheCreationInputTokens > 0 ? 'FRIA (escribe cache) ✓' : 'CALIENTE (¡ojo!)'}`);
    log(`coste    = $${usd.toFixed(4)}  (${(usd * 100).toFixed(2)} cts)   bound: <25 cts`);
  }
  const b = r1.brief as { angles?: unknown[] } | null;
  log(`ángulos  = ${String(b?.angles?.length ?? 0)}`);

  await writeFile(
    join(EV, 'briefs-c4.json'),
    JSON.stringify({ projectId, latencyMs: ms, result: r1 }, null, 2),
  );
  log(`\nverify-brief-c4: briefs-c4.json escrito (project ${projectId}). OK`);
  process.exit(0);
}

main().catch((err: unknown) => {
  log(`verify-brief-c4: threw ${String(err)}`);
  process.exit(1);
});
