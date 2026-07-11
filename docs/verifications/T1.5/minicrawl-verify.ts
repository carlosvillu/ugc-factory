// Verifier-owned script (NOT the implementer's) for T1.5 · Mini-crawl de páginas internas.
// Drives the CORE ingester directly with the VALID Firecrawl key from .env (bypasses the
// T0.14 DB secret store — no persistence needed; the T1.5 observables live in the ingester
// return value: raw.markdown, warnings, internalPages). Prints everything the Verification
// needs: provider (MUST be 'firecrawl' — a Jina fallback voids the run), the discovered
// internalPages, all warnings, and the anexed markdown blocks (## <path> headings + body)
// so the reviews text is auditable and the `skipped` outcome is unambiguous.
//
// Usage:
//   MINICRAWL_URL=<landing> tsx --env-file-if-exists=.env docs/verifications/T1.5/minicrawl-verify.ts
import { makeFirecrawlIngester, discoverInternalUrls } from '../../../packages/core/src/ingest/firecrawl';

async function main(): Promise<void> {
  const url = process.env.MINICRAWL_URL;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!url) {
    console.error('minicrawl: falta MINICRAWL_URL');
    process.exit(2);
  }
  if (!apiKey) {
    console.error('minicrawl: falta FIRECRAWL_API_KEY (.env)');
    process.exit(2);
  }

  // Extra scrape of the landing ALONE (formats incl. links) is NOT re-run here; the ingester
  // already fetches links inside the 1-credit landing scrape. To observe the raw link list
  // and what discoverInternalUrls would pick, we re-run discovery on the links the ingester
  // reports via internalPages + a separate manual link dump. But since ingest() doesn't expose
  // the raw links, we do ONE ingest and inspect its outputs.
  const ingester = makeFirecrawlIngester({ apiKey });
  const res = await ingester.ingest(url);

  console.log(`minicrawl: url           = ${url}`);
  console.log(`minicrawl: provider      = ${res.provider}   (MUST be 'firecrawl'; 'jina' => run VOID)`);
  console.log(`minicrawl: credits       = ${String(res.credits)}`);
  console.log(`minicrawl: warnings      = ${JSON.stringify(res.warnings)}`);
  console.log(`minicrawl: internalPages = ${JSON.stringify(res.internalPages)}`);
  console.log(`minicrawl: markdown len  = ${String(res.raw.markdown.length)} chars`);

  // Split the markdown into landing + anexed internal blocks (each starts at "\n\n## /path").
  // The anexed heading is "## <pathname>" per miniCrawl(); print each block so review text is visible.
  const md = res.raw.markdown;
  const headingRe = /\n\n## (\/\S*)\n\n/g;
  const matches = [...md.matchAll(headingRe)];
  console.log(`minicrawl: anexed blocks = ${String(matches.length)}`);
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : md.length;
    const block = md.slice(start, end);
    console.log(`\n===== ANEXED BLOCK ${String(i + 1)}: ${m[1]} (${String(block.length)} chars) =====`);
    console.log(block.slice(0, 2500));
    if (block.length > 2500) console.log(`... [truncated ${String(block.length - 2500)} more chars]`);
  }

  // Signal for the verifier:
  console.log(`\nminicrawl: provider_ok  = ${String(res.provider === 'firecrawl')}`);
  console.log(`minicrawl: skipped      = ${String(res.warnings.includes('internal_crawl_skipped'))}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('minicrawl: threw', err);
  process.exit(1);
});
