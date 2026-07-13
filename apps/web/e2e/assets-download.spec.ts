// Regresión permanente de la Verificación de T0.5 (e2e.md §9, DoD bloqueante):
// prepara un asset REAL (fichero en el almacén del stack + fila en `asset`),
// descarga el stream autenticado por `/api/assets/:id/download` y verifica el
// checksum extremo-a-extremo; sin `storageState`, el mismo endpoint devuelve 401
// sin exponer la ruta de storage.
//
// T0.5 no tiene botón de UI (el download proxificado es infraestructura que
// consumirán F4/F5): se ejercita con `page.request.get`, que hereda la cookie del
// storageState — no hay evento de descarga que escuchar (e2e.md §9 aplica cuando
// hay botón). La preparación es por factory directa a la BD + StorageAdapter sobre
// el MISMO `ASSETS_DIR` que lee web (publicado en .runtime.json), nunca por clicks.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { newUlid } from '@ugc/core/contracts';
import { createDb, createAsset, makeLocalStorageAdapter } from '@ugc/db';
import { makeAsset } from '@ugc/test-utils';
import { apiCall } from './support/http';

const runtime = JSON.parse(
  readFileSync(fileURLToPath(new URL('./.runtime.json', import.meta.url)), 'utf8'),
) as { databaseUrl: string; assetsDir: string };

// createDb (no drizzle raw): web no depende de drizzle-orm directamente, y el
// cliente que devuelve encaja en createAsset(db, ...).
const db = createDb(runtime.databaseUrl);
const storage = makeLocalStorageAdapter({ root: runtime.assetsDir });

/** Sube un asset real (fichero + fila) y devuelve id, storage_key y checksum. */
async function seedAsset(): Promise<{ id: string; storageKey: string; sha256: string }> {
  const bytes = randomBytes(8192);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  // storage_key único por spec (ULID en el nombre): fullyParallel no colisiona.
  const id = newUlid();
  const storageKey = `e2e/${id}.bin`;
  const put = await storage.put(storageKey, bytes, { mime: 'video/mp4' });
  expect(put.checksum).toBe(sha256);
  const row = await createAsset(
    db,
    makeAsset({
      id,
      kind: 'final_video',
      storageKey,
      mime: 'video/mp4',
      bytes: put.bytes,
      checksum: put.checksum,
    }),
  );
  return { id: row.id, storageKey, sha256 };
}

test.describe('descarga proxificada de assets (T0.5)', () => {
  test(
    'con sesión: descarga el stream y el checksum coincide',
    { tag: ['@f0'] },
    async ({ request }) => {
      const asset = await seedAsset();

      // page.request hereda la cookie de sesión del storageState (setup project).
      // `apiCall`: reintenta SOLO el corte de transporte del `next dev` local (T1.19).
      const res = await apiCall(
        () => request.get(`/api/assets/${asset.id}/download`),
        'GET /api/assets/:id/download',
      );
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('video/mp4');

      const body = await res.body();
      expect(createHash('sha256').update(body).digest('hex')).toBe(asset.sha256);
    },
  );

  // Sin storageState: el endpoint es la barrera real (withAuth), no el proxy.
  test.describe('sin sesión', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('devuelve 401 sin exponer la ruta de storage', { tag: ['@f0'] }, async ({ request }) => {
      const asset = await seedAsset();

      const res = await apiCall(
        () => request.get(`/api/assets/${asset.id}/download`),
        'GET /api/assets/:id/download (sin sesión)',
      );
      expect(res.status()).toBe(401);
      const raw = await res.text();
      expect(JSON.parse(raw).code).toBe('unauthorized');
      // El 401 no filtra el storage_key ni la raíz del almacén.
      expect(raw).not.toContain(asset.storageKey);
      expect(raw).not.toContain(runtime.assetsDir);
    });
  });
});
