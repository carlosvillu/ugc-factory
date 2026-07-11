// VERIFIER-OWNED re-verify driver for T1.5 · Mini-crawl de páginas internas (2nd verify, post-fix).
// NOT the implementer's script. Drives the CORE ingester directly with the REAL Firecrawl key
// from .env (no DB/persistence needed — the T1.5 observables live in the ingester return value).
//
// For a given URL it runs, in order:
//   PHASE A — discovery probe: ONE scrape formats:['links'] + onlyMainContent:false (mirrors the
//     fix's fetchDiscoveryLinks), dumps the raw links AND what discoverInternalUrls() picks. This
//     is the evidence that a `skipped` is legit (0 pattern matches) vs a miss, and that obs1's
//     targets are actually discovered from the full-page link set.
//   PHASE B — full ingest(): asserts provider==='firecrawl' (jina voids run), inspects warnings,
//     internalPages, and prints each appended `## <path>` block with a review-token scan.
//
// Usage:
//   REVERIFY_URL=<landing> pnpm exec tsx --env-file-if-exists=.env docs/verifications/T1.5/reverify-driver.ts
import {
  makeFirecrawlIngester,
  discoverInternalUrls,
} from '../../../packages/core/src/ingest/firecrawl';

// Review-recognition tokens: star glyphs, rating phrases, verified-buyer markers, common
// customer-quote vocabulary. Presence of several in an appended /reviews block = recognizable
// review text (the Verification's "texto de reviews reconocible").
const REVIEW_TOKENS = [
  'verified',
  'star',
  '★',
  '⭐',
  '5/5',
  '5 out of 5',
  'review',
  'rating',
  'recommend',
  'my dog',
  'customer',
  'love',
  'purchase',
  'bought',
];

// Raw discovery scrape (formats:['links'], onlyMainContent:false) via the public Firecrawl v2
// endpoint, so the verifier sees EXACTLY the link set the fix's discovery path feeds to
// discoverInternalUrls. Independent of the ingester internals on purpose.
async function discoveryProbe(url: string, apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ['links'], onlyMainContent: false, proxy: 'auto' }),
  });
  if (!res.ok) {
    console.log(`  discovery-probe: HTTP ${String(res.status)} — scrape FAILED`);
    return [];
  }
  const body = (await res.json()) as { success?: boolean; data?: { links?: string[] | null } };
  return body.data?.links ?? [];
}

async function main(): Promise<void> {
  const url = process.env.REVERIFY_URL;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!url || !apiKey) {
    console.error('reverify: falta REVERIFY_URL o FIRECRAWL_API_KEY');
    process.exit(2);
  }

  console.log(`===== T1.5 RE-VERIFY :: ${url} =====\n`);

  // ── PHASE A: discovery probe ────────────────────────────────────────────────
  console.log('--- PHASE A: discovery probe (formats:[links], onlyMainContent:false) ---');
  const links = await discoveryProbe(url, apiKey);
  console.log(`  raw links returned      = ${String(links.length)}`);
  const picked = discoverInternalUrls(url, links);
  console.log(`  discoverInternalUrls -> = ${JSON.stringify(picked)}`);
  console.log(`  pattern matches (count) = ${String(picked.length)}`);
  // Show same-domain links so a "0 matches" is auditable (are there really no reviews/faq/about?).
  try {
    const host = new URL(url).hostname.split('.').slice(-2).join('.');
    const sameDomain = links.filter((l) => {
      try {
        return new URL(l).hostname.endsWith(host);
      } catch {
        return false;
      }
    });
    const uniquePaths = [
      ...new Set(
        sameDomain.map((l) => {
          try {
            return new URL(l).pathname;
          } catch {
            return l;
          }
        }),
      ),
    ].sort();
    console.log(`  same-domain unique paths = ${String(uniquePaths.length)}`);
    console.log(`  paths: ${JSON.stringify(uniquePaths.slice(0, 60))}`);
  } catch {
    /* noop */
  }

  // ── PHASE B: full ingest ────────────────────────────────────────────────────
  console.log('\n--- PHASE B: full ingest() ---');
  const ingester = makeFirecrawlIngester({ apiKey });
  const res = await ingester.ingest(url);
  console.log(`  provider      = ${res.provider}   (MUST be 'firecrawl')`);
  console.log(`  credits       = ${String(res.credits)}`);
  console.log(`  warnings      = ${JSON.stringify(res.warnings)}`);
  console.log(`  internalPages = ${JSON.stringify(res.internalPages)}`);
  console.log(`  markdown len  = ${String(res.raw.markdown.length)} chars`);

  const skipped = res.warnings.includes('internal_crawl_skipped');
  const linksScrapeFailed = res.warnings.includes('internal_links_scrape_failed');
  console.log(`  skipped(warning)        = ${String(skipped)}`);
  console.log(`  links_scrape_FAILED     = ${String(linksScrapeFailed)}  (must be false for a LEGIT skip)`);

  const md = res.raw.markdown;
  const headingRe = /\n\n## (\/\S*)\n\n/g;
  const matches = [...md.matchAll(headingRe)];
  console.log(`  appended blocks         = ${String(matches.length)}`);
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : md.length;
    const block = md.slice(start, end);
    const lower = block.toLowerCase();
    const hits = REVIEW_TOKENS.filter((t) => lower.includes(t.toLowerCase()));
    console.log(
      `\n===== BLOCK ${String(i + 1)}: ${m[1]} (${String(block.length)} chars) — review-tokens hit: ${JSON.stringify(hits)} =====`,
    );
    console.log(block.slice(0, 2200));
    if (block.length > 2200) console.log(`... [truncated ${String(block.length - 2200)} more chars]`);
  }

  // ── VERDICT SIGNALS ─────────────────────────────────────────────────────────
  console.log('\n--- SIGNALS ---');
  console.log(`  provider_ok             = ${String(res.provider === 'firecrawl')}`);
  console.log(`  is_skipped              = ${String(skipped)}`);
  console.log(`  legit_skip (no fail)    = ${String(skipped && !linksScrapeFailed)}`);
  const reviewBlock = matches.find((m) => /review|opinion|rese/i.test(m[1]!));
  if (reviewBlock) {
    const start = reviewBlock.index!;
    const idx = matches.indexOf(reviewBlock);
    const end = idx + 1 < matches.length ? matches[idx + 1]!.index! : md.length;
    const block = md.slice(start, end).toLowerCase();
    const hits = REVIEW_TOKENS.filter((t) => block.includes(t.toLowerCase()));
    console.log(`  reviews_block_present   = true (${reviewBlock[1]})`);
    console.log(`  reviews_tokens_hit      = ${String(hits.length)} ${JSON.stringify(hits)}`);
    console.log(`  reviews_text_recognizable = ${String(hits.length >= 3)}`);
  } else {
    console.log(`  reviews_block_present   = false`);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('reverify: threw', err);
  process.exit(1);
});
