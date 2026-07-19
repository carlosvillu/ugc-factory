// Integración del PUENTE URL→ASSET de las fotos hero del brief (T4.4b, N7a ruta de referencias). Prueba
// las TRES propiedades que la Entrega exige del puente, con Postgres 16 REAL (Testcontainers) y la red
// mockeada (msw) — el `createAsset` toca BD de verdad, solo la descarga de la URL es doble:
//   1. NORMALIZACIÓN A PNG (defensa AVIF): una foto hero en AVIF se materializa como asset `image/png`
//      (el puente re-codifica con sharp ANTES de subir a fal, que no garantiza soporte AVIF). Con BYTES
//      AVIF reales, no un mime fabricado (principio 9).
//   2. RE-VALIDACIÓN PRE-GASTO (planning:352): una URL 403/404/red → `HeroReferenceUnavailableError`
//      (rehúsa; el executor la mapea a PermanentStepError y NO gasta). Bytes no-imagen → mismo error.
//   3. El asset queda subible a fal (`fal_url` null recién creado → `uploadInputCached` lo subirá).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getAsset, makeLocalStorageAdapter, type DbClient } from '@ugc/db';
import {
  createTestDatabase,
  http,
  HttpResponse,
  makeTestAvif,
  makeTestPng,
  makeTestLogger,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import {
  bridgeReferenceImageUrl,
  HeroReferenceUnavailableError,
} from '../../src/reference-image-bridge';

const HERO_URL = 'https://cdn.example.com/product-hero.avif';
const BRIEF_ID = '01JBRIEFXXXXXXXXXXXXXXXXXX';

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;

function deps(db: DbClient) {
  return { db, storage, logger: makeTestLogger() };
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:reference-bridge' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-ref-bridge-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE asset CASCADE');
});

describe('bridgeReferenceImageUrl (T4.4b): puente URL→asset con re-validación y defensa AVIF', () => {
  it('descarga un hero AVIF y lo materializa como asset PNG subible a fal (fal_url null)', async () => {
    const avif = await makeTestAvif(220, 220);
    server.use(
      http.get(HERO_URL, () =>
        HttpResponse.arrayBuffer(avif.buffer as ArrayBuffer, {
          headers: { 'content-type': 'image/avif' },
        }),
      ),
    );

    const bridged = await bridgeReferenceImageUrl(deps(tdb.db), {
      url: HERO_URL,
      briefId: BRIEF_ID,
    });

    // El asset persistido es PNG (re-codificado), no AVIF — la defensa que evita el 4xx de formato de fal.
    expect(bridged.mime).toBe('image/png');
    expect(bridged.falUrl).toBeNull();
    const row = await getAsset(tdb.db, bridged.assetId);
    expect(row).toBeDefined();
    expect(row!.kind).toBe('product_image');
    expect(row!.mime).toBe('image/png');
    // Los bytes en storage empiezan con la magic de PNG (89 50 4E 47): confirma la re-codificación REAL.
    const stream = await storage.get(row!.storageKey);
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('acepta también un hero PNG (se re-codifica a PNG, resolución preservada)', async () => {
    const png = await makeTestPng(220, 220);
    server.use(
      http.get(HERO_URL, () =>
        HttpResponse.arrayBuffer(png.buffer as ArrayBuffer, {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    const bridged = await bridgeReferenceImageUrl(deps(tdb.db), {
      url: HERO_URL,
      briefId: BRIEF_ID,
    });
    expect(bridged.mime).toBe('image/png');
    expect((await getAsset(tdb.db, bridged.assetId))!.bytes).toBeGreaterThan(0);
  });

  // ── RE-VALIDACIÓN PRE-GASTO (planning:352) ──────────────────────────────────────────────────────
  it('un hero 403 → HeroReferenceUnavailableError con status, SIN crear asset', async () => {
    server.use(http.get(HERO_URL, () => new HttpResponse(null, { status: 403 })));
    await expect(
      bridgeReferenceImageUrl(deps(tdb.db), { url: HERO_URL, briefId: BRIEF_ID }),
    ).rejects.toMatchObject({ name: 'HeroReferenceUnavailableError', status: 403 });
    const { rows } = await tdb.pool.query('SELECT id FROM asset');
    expect(rows).toHaveLength(0);
  });

  it('un fallo de red → HeroReferenceUnavailableError (sin status), SIN crear asset', async () => {
    server.use(http.get(HERO_URL, () => HttpResponse.error()));
    await expect(
      bridgeReferenceImageUrl(deps(tdb.db), { url: HERO_URL, briefId: BRIEF_ID }),
    ).rejects.toBeInstanceOf(HeroReferenceUnavailableError);
    const { rows } = await tdb.pool.query('SELECT id FROM asset');
    expect(rows).toHaveLength(0);
  });

  it('bytes que NO son una imagen → HeroReferenceUnavailableError (no se persiste basura)', async () => {
    server.use(
      http.get(HERO_URL, () =>
        HttpResponse.arrayBuffer(new TextEncoder().encode('not an image').buffer, {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    await expect(
      bridgeReferenceImageUrl(deps(tdb.db), { url: HERO_URL, briefId: BRIEF_ID }),
    ).rejects.toBeInstanceOf(HeroReferenceUnavailableError);
    const { rows } = await tdb.pool.query('SELECT id FROM asset');
    expect(rows).toHaveLength(0);
  });

  it('una respuesta 200 vacía (0 bytes) → HeroReferenceUnavailableError', async () => {
    server.use(
      http.get(HERO_URL, () =>
        HttpResponse.arrayBuffer(new ArrayBuffer(0), { headers: { 'content-type': 'image/png' } }),
      ),
    );
    await expect(
      bridgeReferenceImageUrl(deps(tdb.db), { url: HERO_URL, briefId: BRIEF_ID }),
    ).rejects.toBeInstanceOf(HeroReferenceUnavailableError);
  });
});
