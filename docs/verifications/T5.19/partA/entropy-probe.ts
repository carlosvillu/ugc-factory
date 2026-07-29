// REPRODUCIBLE PROBE (T5.19 Parte A) — the script that produced entropy-measured.txt.
// Run from packages/db so @ugc/core + pg resolve:
//   cd packages/db && SCRATCH_ASSETS=/tmp/ugc-t519-assets pnpm exec tsx <this file>
// Measures Shannon entropy of Maya's seeded reference bytes with the PRODUCTION function
// referenceImageEntropy + REFERENCE_PHOTO_ENTROPY_FLOOR from @ugc/core. Reads bytes off ASSETS_DIR,
// resolves storage_key from the scratch DB ugc_t519 (seeded from zero, no manual inserts).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { referenceImageEntropy, REFERENCE_PHOTO_ENTROPY_FLOOR } from '@ugc/core/persona/server';

const ASSETS = process.env.SCRATCH_ASSETS ?? '/tmp/ugc-t519-assets';
const client = new pg.Client({ connectionString: 'postgres://ugc:ugc@localhost:55432/ugc_t519' });
await client.connect();
const { rows } = await client.query(`
  SELECT p.name, a.storage_key
  FROM asset a JOIN persona p ON a.id = ANY(p.reference_image_ids)
  WHERE a.kind='reference_image' AND p.name IN ('Maya','Lucía (placeholder)')
  ORDER BY p.name, a.storage_key`);
let allMayaPass = true;
for (const r of rows as { name: string; storage_key: string }[]) {
  const bytes = new Uint8Array(await readFile(join(ASSETS, r.storage_key)));
  const entropy = await referenceImageEntropy(bytes);
  const pass = entropy > REFERENCE_PHOTO_ENTROPY_FLOOR;
  if (r.name === 'Maya' && !pass) allMayaPass = false;
  console.log(`${r.name.padEnd(20)} entropy=${entropy.toFixed(3)} floor=${REFERENCE_PHOTO_ENTROPY_FLOOR} => ${pass ? 'PHOTO (pass)' : 'PLACEHOLDER (fail)'} [${r.storage_key.slice(0,34)}...]`);
}
await client.end();
console.log(`\nMAYA VERDICT: ${allMayaPass ? 'ALL references PHOTOS above floor => GO for N7c spend' : 'STALE/PLACEHOLDER => ABORT'}`);
process.exit(allMayaPass ? 0 : 1);
