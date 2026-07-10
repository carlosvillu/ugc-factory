// Test del adaptador filesystem de StorageAdapter (T0.5). Unit puro: usa un tmpdir
// real (no Postgres), así que corre en el proyecto db:unit. Fija el comportamiento
// observable de put/get/stat/delete, el checksum sha256 canónico y — clave de
// §19.2 — la barrera de path traversal.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '@ugc/core/contracts';
import { makeLocalStorageAdapter } from './local-storage';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ugc-storage-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Consume un web ReadableStream a Buffer (lo que el endpoint envolvería en Response). */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

describe('makeLocalStorageAdapter (T0.5)', () => {
  it('put escribe el fichero bajo la raíz, crea subdirs y devuelve bytes+checksum sha256', async () => {
    const storage = makeLocalStorageAdapter({ root });
    const data = randomBytes(2048);
    const expectedChecksum = createHash('sha256').update(data).digest('hex');

    const res = await storage.put('sub/dir/blob.bin', data);

    expect(res.bytes).toBe(2048);
    expect(res.checksum).toBe(expectedChecksum);
    // El fichero existe físicamente bajo la raíz con el contenido exacto.
    const onDisk = await readFile(path.join(root, 'sub/dir/blob.bin'));
    expect(Buffer.compare(onDisk, data)).toBe(0);
  });

  it('get devuelve un web ReadableStream con los bytes idénticos (roundtrip checksum)', async () => {
    const storage = makeLocalStorageAdapter({ root });
    const data = randomBytes(4096);
    const { checksum } = await storage.put('roundtrip.bin', data);

    const stream = await storage.get('roundtrip.bin');
    // Es un web ReadableStream (tiene getReader), no un Node stream.
    expect(typeof stream.getReader).toBe('function');
    const back = await drain(stream);
    expect(createHash('sha256').update(back).digest('hex')).toBe(checksum);
    expect(Buffer.compare(back, data)).toBe(0);
  });

  it('get de una key inexistente lanza AppError not_found', async () => {
    const storage = makeLocalStorageAdapter({ root });
    await expect(storage.get('no-existe.bin')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('stat devuelve bytes+checksum de un fichero existente y null si no existe', async () => {
    const storage = makeLocalStorageAdapter({ root });
    const data = randomBytes(1000);
    const put = await storage.put('stat-me.bin', data);

    const info = await storage.stat('stat-me.bin');
    expect(info).toEqual({ bytes: 1000, checksum: put.checksum });

    expect(await storage.stat('ghost.bin')).toBeNull();
  });

  it('delete borra el fichero y es idempotente', async () => {
    const storage = makeLocalStorageAdapter({ root });
    await storage.put('del.bin', randomBytes(64));

    await storage.delete('del.bin');
    expect(await storage.stat('del.bin')).toBeNull();
    // Segundo delete no lanza (force).
    await expect(storage.delete('del.bin')).resolves.toBeUndefined();
  });

  it('put acepta un web ReadableStream como entrada', async () => {
    const storage = makeLocalStorageAdapter({ root });
    const data = randomBytes(512);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });

    const res = await storage.put('from-stream.bin', stream);
    expect(res.bytes).toBe(512);
    expect(res.checksum).toBe(createHash('sha256').update(data).digest('hex'));
  });

  describe('path traversal (§19.2 "nunca ruta cruda")', () => {
    it('rechaza un key con .. que escaparía de la raíz', async () => {
      const storage = makeLocalStorageAdapter({ root });
      await expect(storage.get('../../../etc/passwd')).rejects.toBeInstanceOf(AppError);
      await expect(storage.stat('../escape.bin')).rejects.toMatchObject({
        code: 'validation_error',
      });
    });

    it('rechaza un key con ruta absoluta', async () => {
      const storage = makeLocalStorageAdapter({ root });
      await expect(storage.put('/etc/evil.bin', randomBytes(8))).rejects.toMatchObject({
        code: 'validation_error',
      });
    });

    it('no confunde un sibling con prefijo común como interno (root vs root-evil)', async () => {
      // Un adaptador sobre `root` no debe aceptar `../<basename>-evil/...`.
      const sibling = `../${path.basename(root)}-evil/x.bin`;
      const storage = makeLocalStorageAdapter({ root });
      await expect(storage.stat(sibling)).rejects.toMatchObject({
        code: 'validation_error',
      });
    });

    it('rechaza un key que designa el propio root (vacío, ".", "foo/..") en vez de un fichero', async () => {
      // `resolveWithinRoot(root, '')` === root: servir el directorio raíz daría un
      // 200 roto (EISDIR tras enviar cabeceras). Debe ser un validation_error
      // limpio, no dejar pasar la raíz. Igual para '.' y cualquier key que
      // colapse al root vía '..'.
      const storage = makeLocalStorageAdapter({ root });
      for (const key of ['', '.', 'foo/..']) {
        await expect(storage.get(key)).rejects.toMatchObject({ code: 'validation_error' });
        await expect(storage.stat(key)).rejects.toMatchObject({ code: 'validation_error' });
        await expect(storage.put(key, randomBytes(4))).rejects.toMatchObject({
          code: 'validation_error',
        });
      }
    });
  });
});

// Confirma que el tmpdir de la raíz existe (guardia de que el harness montó bien).
it('la raíz de test es un directorio real', async () => {
  const info = await stat(root);
  expect(info.isDirectory()).toBe(true);
});
