// Cadena COMPLETA de la Verificación de T1.7 (regla de trabajo 8): el VisualAnalyzer llama a
// Haiku (HTTP mockeado con msw — CERO red real, cero gasto) → el servicio lee el screenshot del
// StorageAdapter, descifra la key de Anthropic (T0.14) y registra el `cost_entry` → se relee de
// la BD. Cierra el seam servicio→persistencia que el unit de core (para en VisualAnalyzerResult)
// no cubre. Codifica las cláusulas DETERMINISTAS observables:
//  #1 análisis url con screenshot → VisualAnalysis clasificado, persiste el cost_entry.
//  #3 modo manual sin imágenes → skipped, SIN cost_entry (cero coste), flujo continúa.
//  #4 cost_entry provider='anthropic' con quantity/unit='tokens' y amount_cents ENTERO.
//  #5 refusal → status refused, cost_entry SÍ registrado (se pagaron los tokens), sin crash.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createProject, makeLocalStorageAdapter, setSecretBlob } from '@ugc/db';
import { newUlid } from '@ugc/core/contracts';
import { deriveSecretsKey, encryptSecret } from '@ugc/core/secrets';
import {
  createTestDatabase,
  makeProject,
  makeRawContent,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import {
  ANTHROPIC_P3_HAPPY_OUTPUT,
  anthropicMessageResponse,
  anthropicRefusalResponse,
} from '@ugc/test-utils/fixtures/anthropic';
import type { StorageAdapter } from '@ugc/core';

import { runVisualAnalyze } from '../../src/visual-analyze';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const MESSAGES_ENDPOINT = `${ANTHROPIC_BASE}/v1/messages`;
const MASTER_KEY = 'test-master-key-for-visual-analyze-suite';

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let secretsKey: Buffer;

async function seedProject(): Promise<string> {
  const project = await createProject(tdb.db, makeProject({ name: 'Chain T1.7' }));
  return project.id;
}

/** PNG real de w×h (ArrayBuffer) que msw sirve como bytes de una imagen CDN. */
async function cdnPng(w: number, h: number): Promise<ArrayBuffer> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 120, g: 200, b: 120 } },
  })
    .png()
    .toBuffer();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** Persiste un screenshot PNG real en el StorageAdapter y devuelve su storage_key. */
async function seedScreenshot(): Promise<string> {
  const png = await sharp({
    create: { width: 1400, height: 3200, channels: 3, background: { r: 14, g: 165, b: 164 } },
  })
    .png()
    .toBuffer();
  const key = `screenshots/${newUlid()}.png`;
  await storage.put(key, new Uint8Array(png), { mime: 'image/png' });
  return key;
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'web:visual-analyze' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-visual-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  secretsKey = deriveSecretsKey(MASTER_KEY);
  // Siembra la key de Anthropic cifrada (T0.14): el servicio la descifra en cada llamada.
  await setSecretBlob(tdb.db, 'anthropic', encryptSecret('sk-ant-fake-key', secretsKey));
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

/** Cargos de anthropic para UN proyecto (aislamiento por-it: cada it siembra su proyecto). */
async function anthropicCostsFor(
  projectId: string,
): Promise<{ amount_cents: number; quantity: number | null; unit: string | null }[]> {
  const { rows } = await tdb.pool.query<{
    amount_cents: number;
    quantity: number | null;
    unit: string | null;
  }>(
    `select amount_cents, quantity, unit from cost_entry where provider = 'anthropic' and project_id = $1`,
    [projectId],
  );
  return rows;
}

describe('runVisualAnalyze — cadena servicio→persistencia (Verificación #1/#4)', () => {
  it('análisis url: clasifica desde el screenshot y persiste cost_entry provider=anthropic', async () => {
    let capturedBody: unknown;
    // Las 3 imágenes raster se fetchean (msw sirve un PNG grande) y se reescalan ≤768px antes
    // de mandarse como base64. El SVG y el data-URI se filtran ANTES de fetchear (nunca llegan).
    const bigPng = await cdnPng(1600, 1600);
    server.use(
      http.get('https://cdn.glow.example/hero.jpg', () =>
        HttpResponse.arrayBuffer(bigPng, { headers: { 'content-type': 'image/png' } }),
      ),
      http.get('https://cdn.glow.example/lifestyle.jpg', () =>
        HttpResponse.arrayBuffer(bigPng, { headers: { 'content-type': 'image/png' } }),
      ),
      http.get('https://cdn.glow.example/chart.png', () =>
        HttpResponse.arrayBuffer(bigPng, { headers: { 'content-type': 'image/png' } }),
      ),
      http.post(MESSAGES_ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(anthropicMessageResponse(ANTHROPIC_P3_HAPPY_OUTPUT));
      }),
    );

    const projectId = await seedProject();
    const screenshotRef = await seedScreenshot();
    // raw.images llega SIN sanear de T1.4: mete un logo SVG y un data-URI (píxel/tracking)
    // entre las 3 raster. El servicio debe FILTRARLOS antes de fetchear (un bloque con SVG o
    // sin capar 400earía / encarecería la única llamada real del verifier).
    const raw = makeRawContent({
      screenshotRef,
      images: [
        { url: 'https://cdn.glow.example/hero.jpg', alt: 'hero' },
        { url: 'https://cdn.glow.example/logo.svg', alt: 'logo' }, // filtrado (SVG)
        { url: 'https://cdn.glow.example/lifestyle.jpg', alt: null },
        { url: 'data:image/gif;base64,R0lGODlh', alt: 'pixel' }, // filtrado (data:)
        { url: 'https://cdn.glow.example/chart.png', alt: null },
      ],
    });

    const res = await runVisualAnalyze(
      { db: tdb.db, storage, secretsKey, anthropicBaseUrl: ANTHROPIC_BASE },
      { projectId, raw },
    );

    expect(res.status).toBe('analyzed');
    expect(res.visualAnalysis.images).toHaveLength(3);
    expect(res.visualAnalysis.hero_image_url).toBe('https://cdn.glow.example/hero.jpg');

    // TODAS las imágenes van base64 (ninguna como bloque url sin capar): screenshot + 3
    // productos = 4 bloques image, todos base64. Y las de producto reescaladas ≤768px.
    const body = capturedBody as {
      messages: { content: { type: string; source?: { type: string; data?: string } }[] }[];
    };
    const imageBlocks = (body.messages[0]?.content ?? []).filter((b) => b.type === 'image');
    expect(imageBlocks).toHaveLength(4);
    expect(imageBlocks.every((b) => b.source?.type === 'base64')).toBe(true);
    // Las 3 imágenes de producto (todas menos el screenshot) van ≤768px en su lado largo.
    // (El screenshot es el 1º bloque image; los productos son los siguientes 3.)
    for (const block of imageBlocks.slice(1)) {
      const bytes = Buffer.from(block.source?.data ?? '', 'base64');
      const meta = await sharp(bytes).metadata();
      expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(768);
    }

    // #4: cost_entry provider='anthropic' con tokens y amount_cents ENTERO.
    const costs = await anthropicCostsFor(projectId);
    expect(costs).toHaveLength(1);
    expect(costs[0]?.unit).toBe('tokens');
    expect(costs[0]?.quantity).toBeGreaterThan(0);
    expect(Number.isInteger(costs[0]?.amount_cents)).toBe(true);
    expect(res.usage?.inputTokens).toBeGreaterThan(0);
  });
});

describe('runVisualAnalyze — desync de índice: imagen intermedia que falla al fetch (regresión)', () => {
  it('una imagen NO-última que 404ea se cae de la lista; las URLs supervivientes siguen alineadas', async () => {
    // 3 imágenes CDN; la INTERMEDIA (lifestyle) 404ea → lista superviviente = [hero, chart].
    // El VLM devuelve 2 clasificaciones EN ORDEN de la lista superviviente. Antes del fix, el
    // hueco posicional desplazaba las URLs: la clasificación de 'chart' se pegaba a 'lifestyle'.
    const bigPng = await cdnPng(1200, 1200);
    const twoClassifications = {
      images: [
        // 1ª → hero (superviviente #1 = hero.jpg)
        {
          kind: 'packshot',
          has_overlay_text: false,
          background: 'clean',
          video_suitability: 'hero',
        },
        // 2ª → chart (superviviente #2 = chart.png), marcada unusable para distinguirla
        {
          kind: 'chart_or_text',
          has_overlay_text: true,
          background: 'busy',
          video_suitability: 'unusable',
        },
      ],
      brand_style: null,
      rendered_social_proof: null,
    };
    server.use(
      http.get('https://cdn.glow.example/hero.jpg', () =>
        HttpResponse.arrayBuffer(bigPng, { headers: { 'content-type': 'image/png' } }),
      ),
      // lifestyle.jpg NO se sirve → 404 → se cae de la lista superviviente.
      http.get(
        'https://cdn.glow.example/lifestyle.jpg',
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get('https://cdn.glow.example/chart.png', () =>
        HttpResponse.arrayBuffer(bigPng, { headers: { 'content-type': 'image/png' } }),
      ),
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json(anthropicMessageResponse(twoClassifications)),
      ),
    );

    const projectId = await seedProject();
    const raw = makeRawContent({
      screenshotRef: null,
      images: [
        { url: 'https://cdn.glow.example/hero.jpg', alt: 'hero' },
        { url: 'https://cdn.glow.example/lifestyle.jpg', alt: 'life' }, // 404 → dropeada
        { url: 'https://cdn.glow.example/chart.png', alt: 'chart' },
      ],
    });

    const res = await runVisualAnalyze(
      { db: tdb.db, storage, secretsKey, anthropicBaseUrl: ANTHROPIC_BASE },
      { projectId, raw },
    );

    expect(res.status).toBe('analyzed');
    // 2 imágenes clasificadas (la intermedia se cayó), URLs ALINEADAS con la lista superviviente.
    expect(res.visualAnalysis.images).toHaveLength(2);
    expect(res.visualAnalysis.images[0]?.url).toBe('https://cdn.glow.example/hero.jpg');
    expect(res.visualAnalysis.images[0]?.video_suitability).toBe('hero');
    // La 2ª clasificación (unusable/chart_or_text) va a chart.png, NO a lifestyle (dropeada).
    expect(res.visualAnalysis.images[1]?.url).toBe('https://cdn.glow.example/chart.png');
    expect(res.visualAnalysis.images[1]?.video_suitability).toBe('unusable');
    expect(res.visualAnalysis.hero_image_url).toBe('https://cdn.glow.example/hero.jpg');
  });
});

describe('runVisualAnalyze — AVIF real y URL sin extensión sobreviven al preparador (T1.14)', () => {
  it('una imagen .avif (bytes AVIF REALES) y una /_next/image?url=… llegan al VLM re-codificadas a PNG', async () => {
    // Los DOS casos reales del 2026-07-13 que el filtro por extensión raster descartaba:
    //  - relatio.chat: todas las imágenes .avif → Haiku recibió 0 imágenes → hero null → N3 FAIL.
    //  - stayforlong.com: /_next/image?url=… (extensión URL-encodeada en el query, no en el path).
    // Principio 9 de testing: el fixture AVIF son bytes AVIF DE VERDAD (sharp .avif()), no un
    // PNG renombrado — el fixture cómodo era exactamente lo que tapaba este bug.
    const avifBytes = await sharp({
      create: { width: 1400, height: 1000, channels: 3, background: { r: 200, g: 60, b: 60 } },
    })
      .avif({ quality: 40 })
      .toBuffer();
    // `HttpResponse.arrayBuffer` tipa `ArrayBuffer`, no `Buffer` (que es una VISTA sobre un
    // pool compartido): el slice extrae los bytes de ESTA imagen. No es boilerplate evitable.
    const avifBuf = avifBytes.buffer.slice(
      avifBytes.byteOffset,
      avifBytes.byteOffset + avifBytes.byteLength,
    );
    const nextImagePng = await cdnPng(1600, 900);
    const nextImageUrl =
      'https://shop.example/_next/image?url=https%3A%2F%2Fcdn.shop.example%2Fhero.jpg&w=1080&q=75';

    const twoClassifications = {
      images: [
        {
          kind: 'packshot',
          has_overlay_text: false,
          background: 'clean',
          video_suitability: 'hero',
        },
        {
          kind: 'lifestyle',
          has_overlay_text: false,
          background: 'busy',
          video_suitability: 'broll',
        },
      ],
      brand_style: null,
      rendered_social_proof: null,
    };
    let capturedBody: unknown;
    server.use(
      http.get('https://cdn.relatio.example/product.avif', () =>
        HttpResponse.arrayBuffer(avifBuf, { headers: { 'content-type': 'image/avif' } }),
      ),
      // msw matchea el path /_next/image sea cual sea el query string.
      http.get('https://shop.example/_next/image', () =>
        HttpResponse.arrayBuffer(nextImagePng, { headers: { 'content-type': 'image/png' } }),
      ),
      http.post(MESSAGES_ENDPOINT, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(anthropicMessageResponse(twoClassifications));
      }),
    );

    const projectId = await seedProject();
    const raw = makeRawContent({
      screenshotRef: null,
      images: [
        { url: 'https://cdn.relatio.example/product.avif', alt: 'hero avif' },
        { url: nextImageUrl, alt: null },
      ],
    });

    const res = await runVisualAnalyze(
      { db: tdb.db, storage, secretsKey, anthropicBaseUrl: ANTHROPIC_BASE },
      { projectId, raw },
    );

    // Ambas sobreviven: clasificadas y alineadas con la lista superviviente.
    expect(res.status).toBe('analyzed');
    expect(res.visualAnalysis.images).toHaveLength(2);
    expect(res.visualAnalysis.images[0]?.url).toBe('https://cdn.relatio.example/product.avif');
    expect(res.visualAnalysis.images[1]?.url).toBe(nextImageUrl);
    expect(res.visualAnalysis.hero_image_url).toBe('https://cdn.relatio.example/product.avif');

    // Y lo que llegó al VLM son 2 bloques base64 re-codificados a PNG ≤768px (el AVIF ya no es
    // AVIF: sharp lo decodificó y homogeneizó — el gate real es fetch+decode, no la extensión).
    const body = capturedBody as {
      messages: { content: { type: string; source?: { type: string; data?: string } }[] }[];
    };
    const imageBlocks = (body.messages[0]?.content ?? []).filter((b) => b.type === 'image');
    expect(imageBlocks).toHaveLength(2);
    for (const block of imageBlocks) {
      expect(block.source?.type).toBe('base64');
      const bytes = Buffer.from(block.source?.data ?? '', 'base64');
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe('png');
      expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(768);
    }
  });
});

describe('runVisualAnalyze — el preparador PARA en el tope de 8 imágenes (T1.14)', () => {
  it('con 12 URLs candidatas solo fetchea las 8 que el analyzer va a mandar (no descarga lo que se descarta)', async () => {
    // Consecuencia directa de relajar el filtro: antes la lista llegaba corta (solo extensiones
    // raster); ahora pasa TODA URL http(s) no-SVG y una web Next.js emite decenas. Sin el corte,
    // el servicio descargaba y re-codificaba con sharp las 12 para que el analyzer tirara 4.
    const png = await cdnPng(900, 900);
    const fetched: string[] = [];
    const urls = Array.from({ length: 12 }, (_, i) => `https://cdn.shop.example/p${String(i)}`);
    server.use(
      http.get('https://cdn.shop.example/:slug', ({ request }) => {
        fetched.push(new URL(request.url).pathname);
        return HttpResponse.arrayBuffer(png, { headers: { 'content-type': 'image/png' } });
      }),
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json(
          anthropicMessageResponse({
            images: Array.from({ length: 8 }, () => ({
              kind: 'lifestyle',
              has_overlay_text: false,
              background: 'clean',
              video_suitability: 'broll',
            })),
            brand_style: null,
            rendered_social_proof: null,
          }),
        ),
      ),
    );

    const projectId = await seedProject();
    const res = await runVisualAnalyze(
      { db: tdb.db, storage, secretsKey, anthropicBaseUrl: ANTHROPIC_BASE },
      {
        projectId,
        raw: makeRawContent({
          screenshotRef: null,
          images: urls.map((url) => ({ url, alt: null })),
        }),
      },
    );

    // 8 fetches, no 12: las 4 sobrantes ni se descargan ni se decodifican.
    expect(fetched).toHaveLength(8);
    expect(res.visualAnalysis.images).toHaveLength(8);
    expect(res.visualAnalysis.images.map((i) => i.url)).toEqual(urls.slice(0, 8));
  });
});

describe('runVisualAnalyze — modo manual sin imágenes: skipped, sin cost_entry (Verificación #3)', () => {
  it('RawContent manual sin screenshot ni subidas → skipped, cero coste, flujo continúa', async () => {
    let called = false;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        called = true;
        return HttpResponse.json(anthropicMessageResponse(ANTHROPIC_P3_HAPPY_OUTPUT));
      }),
    );

    const projectId = await seedProject();
    const raw = makeRawContent({
      source: 'manual',
      url: null,
      platform: 'manual',
      images: [],
      branding: undefined,
      product: undefined,
      screenshotRef: null,
    });

    const res = await runVisualAnalyze(
      { db: tdb.db, storage, secretsKey, anthropicBaseUrl: ANTHROPIC_BASE },
      { projectId, raw },
    );

    expect(called).toBe(false); // NO se llamó a Anthropic.
    expect(res.status).toBe('skipped');
    expect(res.visualAnalysis.images).toEqual([]);
    expect(res.usage).toBeNull();

    // Cero cost_entry de anthropic para ESTE proyecto (cero coste, aislamiento por-proyecto).
    const costs = await anthropicCostsFor(projectId);
    expect(costs).toHaveLength(0);
  });
});

describe('runVisualAnalyze — refusal: status refused, cost_entry registrado (Verificación #5)', () => {
  it('parsed_output null (refusal) → status refused, coste registrado (se pagaron tokens), sin crash', async () => {
    server.use(http.post(MESSAGES_ENDPOINT, () => HttpResponse.json(anthropicRefusalResponse())));

    const projectId = await seedProject();
    const screenshotRef = await seedScreenshot();
    const raw = makeRawContent({ screenshotRef, images: [] });

    const res = await runVisualAnalyze(
      { db: tdb.db, storage, secretsKey, anthropicBaseUrl: ANTHROPIC_BASE },
      { projectId, raw },
    );

    expect(res.status).toBe('refused');
    expect(res.visualAnalysis.images).toEqual([]);
    // Se pagaron los tokens → cost_entry registrado igualmente (record-first).
    expect(res.usage?.inputTokens).toBeGreaterThan(0);
    const costs = await anthropicCostsFor(projectId);
    expect(costs).toHaveLength(1);
    expect(costs[0]?.quantity).toBeGreaterThan(0);
  });
});
