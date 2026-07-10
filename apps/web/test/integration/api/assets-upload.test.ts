// Integración handler-level de `POST /api/assets` (T1.6) contra Postgres real + un
// StorageAdapter sobre tmpdir (api.md §2, nivel 1): el upload de imágenes de
// referencia del intake manual. Fija como regresión permanente la VALIDACIÓN (la
// única superficie de riesgo de T1.6): allowlist de mime, cap de tamaño, y el
// happy-path (fila `asset` + fichero en el almacén + URL de descarga devuelta).
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { getAsset, makeLocalStorageAdapter } from '@ugc/db';
import { setDbForTests } from '@/server/db';
import { setStorageForTests } from '@/server/storage';
import { createSessionValue, setMasterKeyForTests, SESSION_COOKIE } from '@/server/session';
import { POST } from '@/app/api/assets/route';

const TEST_MASTER_KEY = 'test-master-key-for-assets-upload';
function sessionCookieHeader(): string {
  return `${SESSION_COOKIE}=${createSessionValue().value}`;
}

let tdb: TestDatabase;
let storageRoot: string;

function callUpload(file: File | null, opts: { authed?: boolean } = {}): Promise<Response> {
  const form = new FormData();
  if (file) form.append('file', file);
  const headers: Record<string, string> = {};
  if (opts.authed !== false) headers.cookie = sessionCookieHeader();
  // NO se fija content-type: `new Request` lo deriva del FormData (boundary correcto).
  return POST(new Request('http://test.local/api/assets', { method: 'POST', headers, body: form }));
}

function pngFile(name: string, bytes: Uint8Array, mime = 'image/png'): File {
  return new File([bytes as BlobPart], name, { type: mime });
}

beforeAll(async () => {
  setMasterKeyForTests(TEST_MASTER_KEY);
  tdb = await createTestDatabase({ label: 'web:assets-upload' });
  storageRoot = await mkdtemp(path.join(tmpdir(), 'ugc-assets-upload-'));
  setDbForTests(tdb.db);
  setStorageForTests(makeLocalStorageAdapter({ root: storageRoot }));
});

afterAll(async () => {
  setDbForTests(undefined);
  setStorageForTests(undefined);
  setMasterKeyForTests(undefined);
  await rm(storageRoot, { recursive: true, force: true });
  await tdb.close();
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE asset CASCADE');
});

describe('POST /api/assets (upload de imagen, T1.6)', () => {
  it('sin sesión ⇒ 401 antes de tocar nada', async () => {
    const res = await callUpload(pngFile('ref.png', new Uint8Array([1, 2, 3])), { authed: false });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('unauthorized');
  });

  it('imagen válida ⇒ 201, fila asset (reference_image) + fichero + URL de descarga', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    const res = await callUpload(pngFile('ref.png', bytes));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string };
    expect(body.url).toBe(`/api/assets/${body.id}/download`);

    const row = await getAsset(tdb.db, body.id);
    expect(row).toBeDefined();
    expect(row!.kind).toBe('reference_image');
    expect(row!.mime).toBe('image/png');
    expect(row!.bytes).toBe(bytes.byteLength);
    expect(row!.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    // La storage_key es interna (nunca la URL cruda): prefijo del dominio + id.
    expect(row!.storageKey).toContain('intake/');
    expect(row!.storageKey).toContain(row!.id);
  });

  it('mime NO permitido (application/pdf) ⇒ 400 validation_error, cero filas', async () => {
    const res = await callUpload(pngFile('doc.pdf', new Uint8Array([1, 2]), 'application/pdf'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
    const { rows } = await tdb.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM asset');
    expect(rows[0]!.n).toBe(0);
  });

  it('fichero por encima del cap de tamaño ⇒ 400 validation_error, cero filas', async () => {
    // 8 MiB + 1 byte: supera MAX_BYTES.
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    const res = await callUpload(pngFile('big.png', big));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
    const { rows } = await tdb.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM asset');
    expect(rows[0]!.n).toBe(0);
  });

  it('sin campo `file` ⇒ 400 validation_error', async () => {
    const res = await callUpload(null);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
  });

  it('Content-Length por encima del cap del body ⇒ 413 SIN bufferizar el body (seguridad)', async () => {
    // Se declara un Content-Length gigante: el precheck rechaza con 413 ANTES de
    // parsear el multipart (protección del heap). No se llega a insertar nada.
    const res = await POST(
      new Request('http://test.local/api/assets', {
        method: 'POST',
        headers: {
          cookie: sessionCookieHeader(),
          'content-type': 'multipart/form-data; boundary=x',
          'content-length': String(200 * 1024 * 1024), // 200 MB declarados
        },
        body: 'x', // el body real no importa: el precheck ni lo lee
      }),
    );
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('validation_error');
    const { rows } = await tdb.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM asset');
    expect(rows[0]!.n).toBe(0);
  });
});
