// Runner de SQL del verifier T1.11 — MI propio cliente contra la BD del stack E2E
// (testcontainer publicada en apps/web/e2e/.runtime.json). No uso el helper del implementer
// (`e2e/support/stack-db.ts`) a propósito: la evidencia debe ser independiente de su código.
// Se ejecuta desde apps/web (donde `pg` es resolvible con el store aislado de pnpm):
//   cd apps/web && node ../../docs/verifications/T1.11/q.mjs "SELECT ..."
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/apps/web/package.json');
const pg = require('pg');

const ROOT = '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads';
const { databaseUrl } = JSON.parse(readFileSync(`${ROOT}/apps/web/e2e/.runtime.json`, 'utf8'));
const sql = process.argv[2];
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const res = await client.query(sql);
console.log(`-- DB: ${databaseUrl}`);
console.log(`-- SQL: ${sql}`);
console.log(`-- rows: ${res.rowCount}`);
console.log(JSON.stringify(res.rows, null, 2));
await client.end();
