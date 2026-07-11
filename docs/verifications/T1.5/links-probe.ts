// Verifier-owned probe for T1.5 observable #2: dumps the RAW same-domain links Firecrawl
// returns for a landing, and what discoverInternalUrls() picks from them. This proves the
// meaningful "skipped" — the landing DID link to other pages, but NONE matched the
// reviews/faq/about path pattern — vs. the void "skipped" (Firecrawl returned zero links,
// indistinguishable from a fallback). Costs ~1 Firecrawl credit (a lightweight links scrape).
//
// Usage: PROBE_URL=<landing> tsx --env-file-if-exists=.env docs/verifications/T1.5/links-probe.ts
import { discoverInternalUrls } from '../../../packages/core/src/ingest/firecrawl';

async function main(): Promise<void> {
  const url = process.env.PROBE_URL;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!url || !apiKey) {
    console.error('probe: falta PROBE_URL o FIRECRAWL_API_KEY');
    process.exit(2);
  }

  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ['links'], onlyMainContent: true, proxy: 'auto' }),
  });
  console.log(`probe: http status = ${String(res.status)}`);
  const body = (await res.json()) as { success?: boolean; data?: { links?: string[] | null } };
  const links = body.data?.links ?? [];
  console.log(`probe: success     = ${String(body.success)}`);
  console.log(`probe: total links = ${String(links.length)}`);

  // Same-domain filter (last-two-labels heuristic, mirrors registrableDomain in firecrawl.ts).
  const landing = new URL(url);
  const reg = (h: string) => h.toLowerCase().split('.').filter(Boolean).slice(-2).join('.');
  const landingReg = reg(landing.hostname);
  const sameDomain = links.filter((l) => {
    try {
      return reg(new URL(l, landing).hostname) === landingReg;
    } catch {
      return false;
    }
  });
  console.log(`probe: same-domain links = ${String(sameDomain.length)}`);
  console.log('probe: --- sample same-domain links (up to 40) ---');
  for (const l of sameDomain.slice(0, 40)) console.log(`  ${l}`);

  const discovered = discoverInternalUrls(url, links);
  console.log(`\nprobe: discoverInternalUrls picked = ${JSON.stringify(discovered)}`);
  console.log(
    `probe: MEANINGFUL_SKIP = ${String(sameDomain.length > 0 && discovered.length === 0)} (same-domain links exist but none match reviews/faq/about)`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('probe: threw', err);
  process.exit(1);
});
