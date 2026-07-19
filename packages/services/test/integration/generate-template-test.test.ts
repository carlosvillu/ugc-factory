// Imagen de PRUEBA de template cacheada + THUMBNAIL de template (T4.12). Verificación contra Postgres
// real + msw (CERO red real). La Entrega:
//  · `runTemplateTest` genera un asset `keyframe` + UN solo `cost_entry` de fal; probar la MISMA
//    imagen N veces NO añade coste (cache-hit scoped a `template_test=true`);
//  · `generateTemplateThumbnail` genera la miniatura y la ASOCIA a `prompt_template.thumbnail_asset_id`.
//
// CONTROL NEGATIVO (aquí, ejecutado y revertido): un prompt DISTINTO por prueba → content_hash distinto
// → NO es cache-hit → sube el ledger. Es la mordida del assert «N pruebas, 0 coste»: si la caché no
// mordiera, un forced-miss lo delataría (mismo patrón que el forced-miss de `generate-tts`).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getSpendSummary,
  getModelProfileByEndpoint,
  getTemplate,
  listGenerationsByStatus,
  makeLocalStorageAdapter,
  seedGallery,
  createTemplate,
  type ModelProfile,
  type PromptTemplate,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runTemplateTest } from '../../src/generate-template-test';
import { generateTemplateThumbnail } from '../../src/generate-template-thumbnail';

const ENDPOINT = 'fal-ai/flux-2';
const SUBMIT_URL = `https://queue.fal.run/${ENDPOINT}`;
const OUTPUT_URL = 'https://fal.media/files/out-template-test.png';
// 1x1 PNG real (bytes válidos): el StorageAdapter calcula bytes+checksum sobre esto.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** Registra el camino feliz de flux-2 con un contador de submits. Cada submit devuelve un request_id
 *  único → status/response propios (así N generaciones distintas no chocan en msw). */
function happyPath(): { submits: () => number } {
  let n = 0;
  server.use(
    http.post(SUBMIT_URL, () => {
      n += 1;
      const req = `TT-req-${String(n)}`;
      return HttpResponse.json({
        request_id: req,
        status_url: `${SUBMIT_URL}/requests/${req}/status`,
        response_url: `${SUBMIT_URL}/requests/${req}`,
        cancel_url: `${SUBMIT_URL}/requests/${req}/cancel`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(`${SUBMIT_URL}/requests/:req/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: String(params.req) }),
    ),
    http.get(`${SUBMIT_URL}/requests/:req`, () =>
      HttpResponse.json({
        images: [{ url: OUTPUT_URL, width: 1024, height: 1024, content_type: 'image/png' }],
        seed: 7,
      }),
    ),
    http.get(OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(PNG_BYTES.buffer, { headers: { 'content-type': 'image/png' } }),
    ),
  );
  return { submits: () => n };
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let fluxProfile: ModelProfile;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-template-test' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-tpltest-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const profile = await getModelProfileByEndpoint(tdb.db, ENDPOINT);
  if (profile === undefined) throw new Error(`model_profile ${ENDPOINT} no sembrado`);
  fluxProfile = profile;
});

beforeEach(async () => {
  // Aislar cada test: sin filas `generation`/`asset`/`cost_entry` heredadas el conteo del ledger es
  // determinista. Los templates se crean por test con slug único.
  await tdb.pool.query('TRUNCATE TABLE generation, asset, cost_entry CASCADE');
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
    // Key PEREZOSA: `runTemplateTest` la resuelve solo en el cache-miss.
    falKey: () => Promise.resolve('fal-test-key-not-a-secret'),
    sleep: () => Promise.resolve(),
    falOptions: { pollIntervalMs: 0 },
  };
}

async function falEntryCount(): Promise<number> {
  const summary = await getSpendSummary(tdb.db);
  return summary.byProvider.find((p) => p.provider === 'fal')?.entries ?? 0;
}

describe('runTemplateTest — imagen de prueba de template cacheada (Verificación T4.12)', () => {
  it('genera un asset keyframe y UN solo cost_entry de fal', async () => {
    const probe = happyPath();
    const before = await falEntryCount();

    const res = await runTemplateTest(testDeps(), {
      t2iProfile: fluxProfile,
      resolvedPrompt: 'UGC thumbnail for template A',
    });

    expect(res.cached).toBe(false);
    expect(res.assetId).toBeTruthy();
    expect(res.costCents).toBeGreaterThan(0);
    expect(probe.submits()).toBe(1);
    expect(await falEntryCount()).toBe(before + 1);
  });

  it('probar la MISMA imagen N veces NO añade coste (cache-hit: 0 fal, 0 cost_entry)', async () => {
    const probe = happyPath();
    const prompt = 'UGC thumbnail for template B';

    const first = await runTemplateTest(testDeps(), {
      t2iProfile: fluxProfile,
      resolvedPrompt: prompt,
    });
    expect(first.cached).toBe(false);
    expect(probe.submits()).toBe(1);
    const afterFirst = await falEntryCount();

    // Pruebas 2..5: MISMO prompt+modelo → mismo content_hash → CACHE-HIT. NO tocan fal ni el ledger.
    for (let i = 0; i < 4; i += 1) {
      const replay = await runTemplateTest(testDeps(), {
        t2iProfile: fluxProfile,
        resolvedPrompt: prompt,
      });
      expect(replay.cached).toBe(true);
      expect(replay.costCents).toBe(0);
      expect(replay.assetId).toBe(first.assetId); // el MISMO asset, no uno nuevo
    }

    expect(probe.submits()).toBe(1);
    expect(await falEntryCount()).toBe(afterFirst);

    // Una sola generación `template_test` completed para ese prompt (no 5).
    const completed = await listGenerationsByStatus(tdb.db, 'completed');
    expect(completed.filter((g) => g.templateTest && g.resolvedPrompt === prompt)).toHaveLength(1);
  });

  it('CONTROL NEGATIVO: un prompt DISTINTO por prueba SÍ sube el ledger (la caché muerde por hash)', async () => {
    const probe = happyPath();
    const before = await falEntryCount();

    await runTemplateTest(testDeps(), {
      t2iProfile: fluxProfile,
      resolvedPrompt: 'prompt distinto 1',
    });
    await runTemplateTest(testDeps(), {
      t2iProfile: fluxProfile,
      resolvedPrompt: 'prompt distinto 2',
    });

    // Dos prompts distintos → dos content_hash → dos generaciones → dos cost_entry (NO cache-hit).
    expect(probe.submits()).toBe(2);
    expect(await falEntryCount()).toBe(before + 2);
  });
});

describe('generateTemplateThumbnail — miniatura de galería asociada (T4.12)', () => {
  async function seedImageTemplate(slug: string): Promise<PromptTemplate> {
    const created = await createTemplate(tdb.db, {
      slug,
      title: `Thumb ${slug}`,
      kind: 'image',
      body: 'Producto {product.name} en un fondo limpio.',
      language: 'es',
    });
    const row = await getTemplate(tdb.db, created.id);
    if (row === undefined) throw new Error('template no creado');
    return row;
  }

  it('genera la miniatura y estampa thumbnail_asset_id en el template', async () => {
    happyPath();
    const template = await seedImageTemplate(`thumb-${String(Date.now())}`);

    const res = await generateTemplateThumbnail(
      {
        db: tdb.db,
        storage,
        falKey: 'fal-test-key-not-a-secret',
        falOptions: { pollIntervalMs: 0 },
      },
      template,
    );

    expect(res.assetId).toBeTruthy();
    // El template quedó con su thumbnail asociado (lo que el guard de publicación exige).
    const after = await getTemplate(tdb.db, template.id);
    expect(after?.thumbnailAssetId).toBe(res.assetId);
  });
});
