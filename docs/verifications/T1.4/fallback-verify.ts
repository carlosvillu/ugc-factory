// Verifier-owned script (NOT the implementer's): forces the Firecrawl->Jina fallback
// by driving the CORE ingester directly with a BOGUS api key. This avoids the money
// landmine of `FIRECRAWL_API_KEY=bad pnpm smoke:firecrawl`, which would read the VALID
// key from the T0.14 DB secret store (loadFirecrawlKey never reads env) and bill a real
// scrape with no fallback. Bogus key -> Firecrawl 401 (free) -> Jina free tier (free) = $0.
// Clause 3 only requires "Jina produce AL MENOS el markdown"; no persistence/spend/download.
import { makeFirecrawlIngester } from '../../../packages/core/src/ingest/firecrawl';

async function main(): Promise<void> {
  const url = process.env.FALLBACK_URL ?? 'https://www.oatly.com/en-gb';
  const ingester = makeFirecrawlIngester({ apiKey: 'fc-this-key-is-intentionally-invalid' });
  const res = await ingester.ingest(url);

  console.log(`fallback: url          = ${url}`);
  console.log(`fallback: provider     = ${res.provider}`);
  console.log(`fallback: credits      = ${String(res.credits)}`);
  console.log(`fallback: warnings     = ${JSON.stringify(res.warnings)}`);
  console.log(`fallback: markdown len = ${String(res.raw.markdown.length)} chars`);
  console.log(`fallback: images       = ${String(res.raw.images.length)}`);
  console.log(`fallback: branding     = ${JSON.stringify(res.raw.branding ?? null)}`);
  console.log('fallback: --- markdown head (first 500 chars) ---');
  console.log(res.raw.markdown.slice(0, 500));

  const ok =
    res.provider === 'jina' &&
    res.raw.markdown.length > 0 &&
    res.warnings.some((w) => w.startsWith('firecrawl_status_401'));
  console.log(`fallback: RESULT = ${ok ? 'PASS' : 'FAIL'} (expect provider=jina, markdown>0, 401 warning)`);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('fallback: threw', err);
  process.exit(1);
});
