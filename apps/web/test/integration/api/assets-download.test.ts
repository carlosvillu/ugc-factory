// Integración handler-level de `GET /api/assets/:id/download` (T0.5) contra
// Postgres real + un StorageAdapter sobre tmpdir (api.md §2, nivel 1): el handler
// exportado invocado en proceso con `new Request()`, la BD y el storage inyectados
// vía los accessors lazy. Fija las cláusulas DETERMINISTAS de la Verificación como
// regresión permanente del gate: checksum extremo-a-extremo con sesión, 401 sin
// sesión SIN exponer la ruta de storage, 404 opaco, 400 por id no-ULID. El
// recorrido de navegador (descarga real) lo cubre el spec Playwright.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newUlid } from '@ugc/core/contracts';
import { createTestDatabase, makeAsset, type TestDatabase } from '@ugc/test-utils';
import { createAsset, makeLocalStorageAdapter } from '@ugc/db';
import { setDbForTests } from '@/server/db';
import { setStorageForTests } from '@/server/storage';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { GET } from '@/app/api/assets/[id]/download/route';

const TEST_MASTER_KEY = 'test-master-key-for-assets-download';

function sessionCookieHeader(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

/** Invoca el handler con el ctx de Next (params asíncrono, api.md). */
function callGet(id: string, opts: { authed: boolean }): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.authed) headers.cookie = sessionCookieHeader();
  return GET(new Request(`http://test.local/api/assets/${id}/download`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

let tdb: TestDatabase;
let storageRoot: string;

// Un asset real: fichero en el almacén + fila en `asset` con su checksum.
let assetId: string;
let assetBytes: Buffer;
let assetChecksum: string;
const STORAGE_KEY = 'runs/e2e/master.bin';

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:assets-download' });
  storageRoot = await mkdtemp(path.join(tmpdir(), 'ugc-assets-web-'));
  const storage = makeLocalStorageAdapter({ root: storageRoot });

  setDbForTests(tdb.db);
  setStorageForTests(storage);

  // Sube un fichero real y persiste la fila con lo que devolvió put (fila↔fichero
  // consistentes, exactamente como hará el pipeline).
  assetBytes = randomBytes(6000);
  assetChecksum = createHash('sha256').update(assetBytes).digest('hex');
  const put = await storage.put(STORAGE_KEY, assetBytes, { mime: 'application/octet-stream' });
  // Sanity del seed (no es un expect de test: beforeAll no es un test block).
  if (put.checksum !== assetChecksum) {
    throw new Error('seed: el checksum de put no coincide con el esperado');
  }

  const row = await createAsset(
    tdb.db,
    makeAsset({
      kind: 'final_video',
      storageKey: STORAGE_KEY,
      mime: 'video/mp4',
      bytes: put.bytes,
      checksum: put.checksum,
    }),
  );
  assetId = row.id;
});

afterAll(async () => {
  setDbForTests(undefined);
  setStorageForTests(undefined);
  setMasterKeyForTests(undefined);
  await rm(storageRoot, { recursive: true, force: true });
  await tdb.close();
});

describe('GET /api/assets/:id/download (T0.5)', () => {
  it('con sesión: 200, headers de la fila y checksum idéntico extremo-a-extremo', async () => {
    const res = await callGet(assetId, { authed: true });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-length')).toBe(String(assetBytes.byteLength));
    // La descarga usa el id como filename, NUNCA el storage_key interno.
    expect(res.headers.get('content-disposition')).toContain(assetId);
    expect(res.headers.get('content-disposition')).not.toContain(STORAGE_KEY);

    // El stream descargado tiene el checksum de la fila: proxy íntegro.
    const back = Buffer.from(await res.arrayBuffer());
    expect(createHash('sha256').update(back).digest('hex')).toBe(assetChecksum);
    expect(Buffer.compare(back, assetBytes)).toBe(0);
  });

  it('sin sesión: 401 unauthorized SIN exponer la ruta de storage', async () => {
    const res = await callGet(assetId, { authed: false });

    expect(res.status).toBe(401);
    const raw = await res.text();
    const body = JSON.parse(raw) as { code: string; message: string };
    expect(body.code).toBe('unauthorized');
    // El 401 no revela nada del almacén: ni el storage_key ni la raíz del tmpdir.
    expect(raw).not.toContain(STORAGE_KEY);
    expect(raw).not.toContain(storageRoot);
  });

  it('id ULID válido pero inexistente: 404 not_found opaco', async () => {
    const res = await callGet(newUlid(), { authed: true });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('id que no es un ULID: 400 validation_error (la frontera lo rechaza)', async () => {
    const res = await callGet('not-a-ulid', { authed: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('validation_error');
  });
});
