// VERIFIER's OWN seed (not the implementer's smoke). Clause 1 requires the file be
// uploaded "vía el StorageAdapter" — so this exercises makeLocalStorageAdapter().put()
// and createAsset() against the SAME DATABASE_URL/ASSETS_DIR the web process uses
// (both read from e2e/.runtime.json). Everything downstream (psql read, sha256sum,
// curl roundtrip, 401) is done in raw shell for independent, code-agnostic evidence.
//
// It uploads bytes read from a file on disk (path in SEED_FILE) so the exact same
// bytes can be hashed by system `sha256sum` outside this process, and prints a
// machine-readable line the shell harness parses: RESULT <id> <storageKey> <checksum> <bytes>
import { readFileSync } from 'node:fs';
import { createDb, createAsset, makeLocalStorageAdapter } from '@ugc/db';
import { newUlid } from '@ugc/core/contracts';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const assetsDir = process.env.ASSETS_DIR;
  const seedFile = process.env.SEED_FILE;
  const mime = process.env.SEED_MIME ?? 'video/mp4';
  if (!databaseUrl || !assetsDir || !seedFile) {
    console.error('seed: need DATABASE_URL, ASSETS_DIR, SEED_FILE');
    process.exit(1);
  }

  const bytes = readFileSync(seedFile);
  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });

  const storageKey = `verifier/${newUlid()}.mp4`;
  const put = await storage.put(storageKey, bytes, { mime });
  const asset = await createAsset(db, {
    kind: 'final_video',
    storageKey,
    mime,
    bytes: put.bytes,
    checksum: put.checksum,
  });

  // Machine-readable line for the shell harness.
  console.log(`RESULT ${asset.id} ${storageKey} ${put.checksum} ${String(put.bytes)}`);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('seed: failed', err);
  process.exit(1);
});
