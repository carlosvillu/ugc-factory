// T5.22 verifier — trace a single page load and grep THE TRACE ZIP for HMR/.next-dev tokens.
// Uses the Playwright API directly (NO spec added to apps/web/e2e). The PRIMARY evidence for
// clause (c) is the unzipped trace's frames ("los frames de los traces"), NOT the in-memory
// request array — so this script unzips the .zip and greps its extracted files. The request
// array is kept only as secondary corroboration.
//
// Usage:  node trace-and-grep.mjs <baseUrl> <path> <outLabel>
//   dev :  node trace-and-grep.mjs http://localhost:3000 /login dev
//   prod:  node trace-and-grep.mjs http://localhost:3100 /login prod
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Resolve @playwright/test from apps/web (this script lives under docs/, which has no
// node_modules). createRequire anchored at apps/web finds the pnpm-hoisted package.
const WEB_DIR = fileURLToPath(new URL('../../../apps/web/', import.meta.url));
const requireFromWeb = createRequire(path.join(WEB_DIR, 'noop.js'));
const pwEntry = requireFromWeb.resolve('@playwright/test');
const pwMod = await import(pathToFileURL(pwEntry).href);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) throw new Error('could not load chromium from @playwright/test');

const [, , baseUrl, urlPath, label] = process.argv;
if (!baseUrl || !urlPath || !label) {
  console.error('usage: node trace-and-grep.mjs <baseUrl> <path> <label>');
  process.exit(2);
}

const EV = fileURLToPath(new URL('.', import.meta.url));
const traceZip = path.join(EV, `${label}-trace.zip`);

const browser = await chromium.launch();
const context = await browser.newContext();
await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
const page = await context.newPage();

const requests = [];
page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));

const target = new URL(urlPath, baseUrl).toString();
try {
  await page.goto(target, { waitUntil: 'load', timeout: 30_000 });
} catch (e) {
  console.error(`goto(${target}) failed: ${String(e)}`);
}
// Let HMR establish its channel after load (dev only); harmless in prod.
await page.waitForTimeout(4000);

await context.tracing.stop({ path: traceZip });
await browser.close();

// PRIMARY EVIDENCE: unzip the trace and grep its frames/network/resources.
const extractDir = mkdtempSync(path.join(tmpdir(), `t522-trace-${label}-`));
execFileSync('unzip', ['-o', '-q', traceZip, '-d', extractDir]);

const CANDIDATES = ['webpack-hmr', 'turbopack-hmr', 'hot-reloader', '__nextjs', '.next/dev'];
const zipHits = {};
for (const tok of CANDIDATES) {
  try {
    // -r recursive, -l list files, -F fixed string; empty result => grep exit 1 (caught).
    const out = execFileSync('grep', ['-rlF', tok, extractDir], { encoding: 'utf8' });
    zipHits[tok] = out.trim().split('\n').filter(Boolean).length;
  } catch {
    zipHits[tok] = 0;
  }
}

// SECONDARY: request-array / console corroboration.
const reqHits = new Set();
for (const line of [...requests, ...consoleMsgs]) {
  for (const tok of CANDIDATES) if (line.includes(tok)) reqHits.add(tok);
}

console.log(`=== ${label} @ ${target} ===`);
console.log(`requests captured: ${requests.length}`);
console.log(`trace zip: ${traceZip}`);
console.log('TRACE-ZIP token hits (files matched):', JSON.stringify(zipHits));
console.log('REQUEST-ARRAY token hits:', reqHits.size ? [...reqHits].join(', ') : '(none)');
console.log('--- request URLs ---');
for (const r of requests) console.log(r);
