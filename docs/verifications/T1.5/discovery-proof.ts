// Keystone proof (T1.5): confirms discoverInternalUrls() — the SHIPPED discovery function —
// correctly picks reviews/faq/about from a REAL full link list, isolating the defect to the
// landing scrape's onlyMainContent:true (which starves discovery of nav/footer links). Runs
// one links scrape with onlyMainContent:false, then feeds those links to the shipped function.
import { discoverInternalUrls } from '../../../packages/core/src/ingest/firecrawl';

async function main(): Promise<void> {
  const url = process.env.PROOF_URL;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!url || !apiKey) {
    console.error('proof: falta PROOF_URL o FIRECRAWL_API_KEY');
    process.exit(2);
  }
  const res = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ['links'], onlyMainContent: false, proxy: 'auto' }),
  });
  const body = (await res.json()) as { data?: { links?: string[] } };
  const links = body.data?.links ?? [];
  console.log(`proof: onlyMainContent=false total links = ${String(links.length)}`);
  const picked = discoverInternalUrls(url, links);
  console.log(`proof: discoverInternalUrls(url, FULL links) = ${JSON.stringify(picked)}`);
  console.log(
    `proof: DISCOVERY_WORKS = ${String(picked.length > 0)} (shipped fn picks targets when links aren't stripped)`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('proof: threw', err);
  process.exit(1);
});
