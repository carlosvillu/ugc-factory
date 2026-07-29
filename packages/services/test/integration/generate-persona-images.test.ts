// Generación IA de REFERENCE-IMAGES de Persona (T4.12 pase B, §11 identity lock). Verificación contra
// Postgres real + msw (CERO red real, cero gasto). La Entrega:
//  · retrato base FLUX.2 (t2i, image_size custom) → subido a fal storage → cada encuadre NB2
//    (`nano-banana-2/edit`, resolution:"2K", aspect_ratio:"9:16", image_urls:[base]) → validado ≥2K →
//    persistido como `asset` kind='reference_image' en la persona;
//  · UN `cost_entry` provider='fal' por imagen (base megapíxel + cada encuadre por imagen);
//  · SIN dedup: dos llamadas «Generar variación» producen assets NUEVOS (no cache-hit).
//
// DEFENSA ≥2K (regla de trabajo 8, cláusula determinista de la Verificación): un output NB2 <2048 se
// RECHAZA (mismo guard que el upload manual). Se ejerce con un control negativo (output pequeño → lanza).
//
// Molde: `generate-avatar.test.ts` (uploadHandlers + submit/poll/download msw). El PNG del encuadre es
// REAL y ≥2048 (`makeTestPng(1536, 2752)`): `validateReferenceImage` lee dimensiones DEL FICHERO.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPersona,
  getAsset,
  getPersona,
  getSpendSummary,
  listGenerationsByStatus,
  makeLocalStorageAdapter,
  seedGallery,
  type PersonaRow,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, makeTestPng, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import {
  runGeneratePersonaImages,
  FLUX2_ENDPOINT,
  NB2_EDIT_ENDPOINT,
} from '../../src/generate-persona-images';

// URLs públicas que fal "emitiría" para el output del base (flux-2) y de cada encuadre (NB2).
const BASE_OUTPUT_URL = 'https://fal.media/files/persona-base.png';
const REF_OUTPUT_URL = 'https://fal.media/files/persona-ref.png';
// El base NO se valida ≥2K (es intermedio): bytes PNG mínimos válidos bastan.
const BASE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** Handlers del upload a fal storage (§9.6): el base se sube para ser `image_urls[0]` de NB2. */
function uploadHandlers(): Parameters<typeof server.use> {
  return [
    http.post('https://rest.fal.ai/storage/upload/initiate', () =>
      HttpResponse.json({
        upload_url: 'https://storage.fal.run/upload/input',
        file_url: 'https://fal.media/files/uploaded-base',
      }),
    ),
    http.put('https://storage.fal.run/upload/input', () => new HttpResponse(null, { status: 200 })),
  ];
}

/** Registra el submit/poll/response de un endpoint con un output dado. Cada submit devuelve un
 *  request_id ÚNICO (contador con prefijo) → dos generaciones distintas del mismo endpoint (p.ej. 3
 *  encuadres NB2) no chocan en `fal_request_id` (UNIQUE). El status/response casan por :req en la URL. */
function falEndpointHandlers(
  endpoint: string,
  prefix: string,
  output: Record<string, unknown>,
): void {
  const base = `https://queue.fal.run/${endpoint}`;
  let n = 0;
  server.use(
    http.post(base, () => {
      n += 1;
      const req = `${prefix}-${String(n)}`;
      return HttpResponse.json({
        request_id: req,
        status_url: `${base}/requests/${req}/status`,
        response_url: `${base}/requests/${req}`,
        cancel_url: `${base}/requests/${req}/cancel`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(`${base}/requests/:req/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: String(params.req) }),
    ),
    http.get(`${base}/requests/:req`, () => HttpResponse.json(output)),
  );
}

/** Camino feliz: base flux-2 (PNG pequeño) + NB2 edit con un PNG ≥2048 REAL. `refPng` son los bytes que
 *  `validateReferenceImage` decodifica (lado largo ≥2048 → pasa). Nonce por corrida para request_ids. */
function happyPath(nonce: string, refPng: Uint8Array): void {
  falEndpointHandlers(FLUX2_ENDPOINT, `FLX-${nonce}`, {
    images: [{ url: BASE_OUTPUT_URL, width: 1216, height: 2176, content_type: 'image/png' }],
  });
  // NB2/edit REAL emite `width:null, height:null` (probado con fal real, 2026-07-19). El fake reproduce
  // esos nulls para ejercitar el parser tolerante: las dims ≥2K se releen de los BYTES de `refPng`.
  falEndpointHandlers(NB2_EDIT_ENDPOINT, `NB2-${nonce}`, {
    images: [{ url: REF_OUTPUT_URL, width: null, height: null, content_type: 'image/png' }],
  });
  server.use(
    ...uploadHandlers(),
    http.get(BASE_OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(pngBuffer(BASE_PNG), { headers: { 'content-type': 'image/png' } }),
    ),
    http.get(REF_OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(pngBuffer(refPng), { headers: { 'content-type': 'image/png' } }),
    ),
  );
}

/** El ArrayBuffer exacto de un Uint8Array (recorta a su ventana): `HttpResponse.arrayBuffer` sirve estos
 *  bytes tal cual. Evita el `as ArrayBuffer` (el `.buffer` de un Uint8Array puede ser SharedArrayBuffer). */
function pngBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let refPng2K: Uint8Array;
let smallPng: Uint8Array;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-persona-images' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-persona-img-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  // PNGs reales: uno ≥2K (pasa el guard) y otro <2K (control negativo del guard).
  refPng2K = await makeTestPng(1536, 2752);
  smallPng = await makeTestPng(768, 1344);
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE TABLE generation, asset, cost_entry, persona CASCADE');
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

function testDeps() {
  return {
    db: tdb.db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    sleep: () => Promise.resolve(),
    falOptions: { pollIntervalMs: 0 },
  };
}

let personaCounter = 0;
async function makePersona(): Promise<PersonaRow> {
  personaCounter += 1;
  return createPersona(tdb.db, {
    name: `Test Persona ${String(personaCounter)}-${String(Date.now())}`,
    ageRange: '25-34',
    gender: 'female',
    ethnicity: 'latina',
    style: 'casual',
    descriptor: 'mujer de 29 años, latina, look casual',
    setting: 'baño con luz natural',
    personality: 'Cercana y directa.',
    wardrobeNotes: 'Camiseta lisa.',
    voiceMap: {},
  });
}

async function falEntryCount(): Promise<number> {
  const summary = await getSpendSummary(tdb.db);
  return summary.byProvider.find((p) => p.provider === 'fal')?.entries ?? 0;
}

describe('runGeneratePersonaImages — reference-images IA del mismo sujeto (Verificación T4.12 pase B)', () => {
  it('genera N encuadres ≥2K, los añade a la persona y registra el coste (base + cada encuadre)', async () => {
    happyPath('happy', refPng2K);
    const persona = await makePersona();
    const before = await falEntryCount();

    const res = await runGeneratePersonaImages(testDeps(), {
      personaId: persona.id,
      framingCount: 2,
    });

    expect(res.images).toHaveLength(2);
    for (const img of res.images) {
      expect(img.assetId).toBeTruthy();
      // DIMENSIONES ≥2K (identity lock §11): el lado largo alcanza el umbral.
      expect(Math.max(img.width, img.height)).toBeGreaterThanOrEqual(2048);
    }
    // Coste total > 0 (base + 2 encuadres) — «Generar variación» gasta.
    expect(res.costCents).toBeGreaterThan(0);

    // Las referencias quedaron EN la persona (addReferenceImage), en orden.
    const updated = await getPersona(tdb.db, persona.id);
    expect(updated?.referenceImageIds).toEqual(res.images.map((i) => i.assetId));

    // NORMALIZADO a JPEG (T5.19, fix del FAIL de VERIFY): NB2 devuelve `image/png`, pero la reference
    // se recodifica a JPEG para que N7c pueda DESCARGARLA (los PNG grandes daban file_download_error).
    // Se prueba sobre los BYTES REALMENTE ALMACENADOS (no la columna `mime`, un literal): si alguien
    // quita `normalizeReferenceImage`, el fichero seguiría siendo PNG y este assert lo caza.
    for (const img of res.images) {
      const asset = await getAsset(tdb.db, img.assetId);
      expect(asset?.mime).toBe('image/jpeg');
      expect(asset?.storageKey.endsWith('.jpg')).toBe(true);
      const storedBytes = readFileSync(path.join(assetsDir, asset!.storageKey));
      expect((await sharp(storedBytes).metadata()).format).toBe('jpeg');
    }

    // Un cost_entry de fal por generación (base + 2 encuadres = 3).
    expect(await falEntryCount()).toBe(before + 3);
  });

  it('«activa»: por defecto genera ≥ REFERENCE_IMAGES_MIN (2) encuadres', async () => {
    happyPath('default', refPng2K);
    const persona = await makePersona();

    const res = await runGeneratePersonaImages(testDeps(), { personaId: persona.id });

    expect(res.images.length).toBeGreaterThanOrEqual(2);
    const updated = await getPersona(tdb.db, persona.id);
    expect(updated?.referenceImageIds.length).toBe(res.images.length);
  });

  it('SIN dedup: dos «Generar variación» producen assets NUEVOS y suben el ledger cada vez', async () => {
    happyPath('run1', refPng2K);
    const persona = await makePersona();

    const first = await runGeneratePersonaImages(testDeps(), {
      personaId: persona.id,
      framingCount: 1,
    });
    const afterFirst = await falEntryCount();

    server.resetHandlers();
    happyPath('run2', refPng2K);
    const second = await runGeneratePersonaImages(testDeps(), {
      personaId: persona.id,
      framingCount: 1,
    });

    // Assets DISTINTOS (no cache-hit) y la persona acumula ambos.
    expect(second.images[0]?.assetId).not.toBe(first.images[0]?.assetId);
    const updated = await getPersona(tdb.db, persona.id);
    expect(updated?.referenceImageIds).toHaveLength(2);
    // El ledger subió otra vez (base + encuadre de la 2ª corrida).
    expect(await falEntryCount()).toBeGreaterThan(afterFirst);
  });

  it('DEFENSA ≥2K: un output NB2 <2048 se RECHAZA (no se persiste una referencia inválida)', async () => {
    // El encuadre devuelve un PNG de 768×1344 (<2048): `validateReferenceImage` debe lanzar.
    falEndpointHandlers(FLUX2_ENDPOINT, 'FLX-small', {
      images: [{ url: BASE_OUTPUT_URL, width: 1216, height: 2176, content_type: 'image/png' }],
    });
    // Como el NB2 real: sin dims en el output. El rechazo nace de los BYTES (768×1344 <2048), no de aquí.
    falEndpointHandlers(NB2_EDIT_ENDPOINT, 'NB2-small', {
      images: [{ url: REF_OUTPUT_URL, width: null, height: null, content_type: 'image/png' }],
    });
    server.use(
      ...uploadHandlers(),
      http.get(BASE_OUTPUT_URL, () =>
        HttpResponse.arrayBuffer(pngBuffer(BASE_PNG), { headers: { 'content-type': 'image/png' } }),
      ),
      http.get(REF_OUTPUT_URL, () =>
        HttpResponse.arrayBuffer(pngBuffer(smallPng), { headers: { 'content-type': 'image/png' } }),
      ),
    );
    const persona = await makePersona();

    await expect(
      runGeneratePersonaImages(testDeps(), { personaId: persona.id, framingCount: 1 }),
    ).rejects.toThrow(/2048|2K/i);

    // La persona NO recibió una referencia inválida.
    const updated = await getPersona(tdb.db, persona.id);
    expect(updated?.referenceImageIds).toHaveLength(0);
    // La generación del encuadre quedó `failed` (degradada), no `completed` mentirosa: ninguna
    // generación `completed` tiene un prompt de framing (`Same person`).
    const completed = await listGenerationsByStatus(tdb.db, 'completed');
    expect(completed.some((g) => g.resolvedPrompt?.includes('Same person') === true)).toBe(false);
  });
});
