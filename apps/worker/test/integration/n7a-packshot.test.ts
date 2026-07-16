// Integración del executor N7a · PRODUCT SHOTS, ruta packshot-IA (T4.4, §7.2). Ejerce la CADENA
// DETERMINISTA que la Verificación live (smoke contra fal) NO puede probar barato ni sin gastar:
// dado un brief sembrado, el executor construye el prompt de packshot, invoca `fal-ai/flux-2`
// (HTTP mockeado con msw — CERO red real, CERO gasto), y persiste 2–3 generaciones con
// `synthetic_product=true`, cada una con su asset PNG y su cost_entry. Postgres 16 REAL vía
// Testcontainers (orchestrator.md: cero mocks de BD); la ÚNICA frontera mockeada es fal (msw), con
// la forma REAL que flux-2 emite (principio 9: el doble emite lo que fal emitiría, no lo que le
// conviene al test — mismo fixture que `packages/services/test/integration/generate.test.ts`).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { buildPackshotPrompt } from '@ugc/core/generation';
import type { ProductBrief } from '@ugc/core/contracts';
import {
  createDbPool,
  getAsset,
  getGeneration,
  makeLocalStorageAdapter,
  seedGallery,
} from '@ugc/db';
import { productBrief, project, urlAnalysis } from '@ugc/db/schema';
import {
  createTestDatabase,
  http,
  HttpResponse,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeTestLogger,
  makeUrlAnalysis,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { makeN7aExecutor } from '../../src/executors/generation';

/** Sink de output para los tests que solo comprueban el efecto en BD (no el artefacto). */
const noopCollect = (_refs: unknown): void => undefined;

const ENDPOINT = 'fal-ai/flux-2';
// El request_id es DINÁMICO: N7a hace N submits (uno por shot), y `generation.fal_request_id` es
// UNIQUE — dos shots con el mismo id colisionarían (23505). El handler de submit acuña uno nuevo
// por llamada; status/response se sirven por ese id (parámetro de ruta), no por una URL fija.
const OUTPUT_URL = 'https://fal.media/files/out-flux2.png';
// 1x1 PNG real (bytes válidos): el StorageAdapter calcula bytes+checksum sobre esto.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
// 1024×1024 = 1,048576 MP; a 1,2 céntimos/MP → round(1,258…) = 1 céntimo por shot.
const RESPONSE_BODY = {
  images: [{ url: OUTPUT_URL, width: 1024, height: 1024, content_type: 'image/png' }],
  seed: 7,
};

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;

/** Handlers del camino feliz con request_id DINÁMICO por submit (N7a hace N submits). El submit
 *  acuña `req-<n>`; status/response se sirven por el id de la ruta. */
function happyPath(): void {
  let counter = 0;
  server.use(
    http.post(`https://queue.fal.run/${ENDPOINT}`, () => {
      counter += 1;
      const id = `n7a-req-${String(counter)}`;
      return HttpResponse.json({
        request_id: id,
        status_url: `https://queue.fal.run/${ENDPOINT}/requests/${id}/status`,
        response_url: `https://queue.fal.run/${ENDPOINT}/requests/${id}`,
        cancel_url: `https://queue.fal.run/${ENDPOINT}/requests/${id}/cancel`,
        status: 'IN_QUEUE',
        queue_position: 0,
      });
    }),
    http.get(`https://queue.fal.run/${ENDPOINT}/requests/:id/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: params.id }),
    ),
    http.get(`https://queue.fal.run/${ENDPOINT}/requests/:id`, () =>
      HttpResponse.json(RESPONSE_BODY),
    ),
    http.get(OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(PNG_BYTES.buffer, { headers: { 'content-type': 'image/png' } }),
    ),
  );
}

const BRIEF: ProductBrief = makeBrief();

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'worker:n7a' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-n7a-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  // Catálogo REAL (incluye el model_profile flux-2): `generation.model_profile_id` es NOT NULL y N7a
  // lo resuelve por endpoint. Sin este seed el executor fallaría al resolver el modelo.
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
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
  await tdb.pool.query(
    'TRUNCATE generation, asset, cost_entry, product_brief, url_analysis, project CASCADE',
  );
});

/** Siembra proyecto + análisis + brief; devuelve el briefId (el forward-pointer de la config N7a). */
async function seedBrief(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();
  return brief!.id;
}

/** Deps del executor con polling inmediato (no espera de verdad). `falKey` es un literal de test. */
function makeExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN7aExecutor({
    db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    logger: makeTestLogger(),
  });
}

describe('N7a executor (T4.4): packshots IA 9:16 con synthetic_product', () => {
  it('genera 2 packshots 9:16 desde el brief, con synthetic_product=true y 1 asset por shot', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyPath();
      const briefId = await seedBrief();

      const outputs: unknown[] = [];
      const ctx = {
        config: { route: 'ai_packshot', briefId, numShots: 2, aspect: '9:16' },
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps: [],
      };
      await makeExecutor(db)(ctx);

      // 2 generaciones, TODAS completed, TODAS synthetic_product=true (el flag de procedencia).
      const { rows: gens } = await tdb.pool.query<{
        status: string;
        synthetic_product: boolean;
        inputs: { image_size?: string; num_images?: number; seed?: number };
        content_hash: string;
        model_profile_id: string;
      }>(
        'SELECT status, synthetic_product, inputs, content_hash, model_profile_id FROM generation ORDER BY id',
      );
      expect(gens).toHaveLength(2);
      expect(gens.every((g) => g.status === 'completed')).toBe(true);
      // ── CONTROL NEGATIVO EMBEBIDO ── este assert cae en ROJO si el executor deja de pasar
      // `syntheticProduct:true` a runGenerate, o si runGenerate deja de persistir la columna.
      expect(gens.every((g) => g.synthetic_product)).toBe(true);

      // Los inputs de flux-2: 9:16 vertical = portrait_16_9, 1 imagen por shot (bucle, no num_images:N),
      // y un seed DISTINTO por shot (imágenes distintas + content_hash distinto).
      expect(gens.every((g) => g.inputs.image_size === 'portrait_16_9')).toBe(true);
      expect(gens.every((g) => g.inputs.num_images === 1)).toBe(true);
      expect(new Set(gens.map((g) => g.inputs.seed)).size).toBe(2);
      // content_hash distinto por shot (el seed los diferencia): dedupe futuro no los colapsa.
      expect(new Set(gens.map((g) => g.content_hash)).size).toBe(2);

      // 1 asset PNG por shot, cada uno atado a su generación.
      const { rows: assets } = await tdb.pool.query<{ generation_id: string; mime: string }>(
        'SELECT generation_id, mime FROM asset',
      );
      expect(assets).toHaveLength(2);
      expect(assets.every((a) => a.mime === 'image/png')).toBe(true);

      // El artefacto ligero: la ruta, el flag de procedencia y 2 refs (generation+asset+coste).
      expect(outputs).toHaveLength(1);
      const out = outputs[0] as {
        route: string;
        syntheticProduct: boolean;
        shots: { generationId: string; assetId: string; costCents: number }[];
      };
      expect(out.route).toBe('ai_packshot');
      expect(out.syntheticProduct).toBe(true);
      expect(out.shots).toHaveLength(2);
      // Cada ref resuelve a una fila real (generation + asset).
      for (const shot of out.shots) {
        expect(await getGeneration(db, shot.generationId)).toBeDefined();
        expect(await getAsset(db, shot.assetId)).toBeDefined();
      }
    } finally {
      await pool.end();
    }
  });

  it('respeta numShots=3 (genera exactamente 3 packshots)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyPath();
      const briefId = await seedBrief();
      await makeExecutor(db)({
        config: { route: 'ai_packshot', briefId, numShots: 3, aspect: '9:16' },
        collectOutput: noopCollect,
        deps: [],
      });
      const { rows } = await tdb.pool.query('SELECT id FROM generation');
      expect(rows).toHaveLength(3);
    } finally {
      await pool.end();
    }
  });

  it('el prompt de packshot lleva la identidad del producto y las señales de estudio 9:16', () => {
    // El executor delega en `buildPackshotPrompt` (core, puro). Aquí solo se ancla que el prompt que
    // el executor usaría contiene lo que la ruta packshot exige (el detalle vive en el unit de core).
    const prompt = buildPackshotPrompt(BRIEF);
    expect(prompt).toContain(BRIEF.product.name);
    expect(prompt.toLowerCase()).toContain('packshot');
    expect(prompt).toContain('9:16');
  });

  it('ruta con referencias reales (upload_images) → PermanentStepError (es T4.4b, no T4.4)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const briefId = await seedBrief();
      await expect(
        makeExecutor(db)({
          config: { route: 'upload_images', briefId, numShots: 2, aspect: '9:16' },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
      // NO se creó ninguna generación (rechazo ANTES de gastar).
      const { rows } = await tdb.pool.query('SELECT id FROM generation');
      expect(rows).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  it('config inválida (sin briefId) → PermanentStepError', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: { route: 'ai_packshot' },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });

  it('brief inexistente → PermanentStepError (no se gasta)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: {
            route: 'ai_packshot',
            briefId: '01JXXXXXXXXXXXXXXXXXXXXXXX',
            numShots: 2,
            aspect: '9:16',
          },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
      const { rows } = await tdb.pool.query('SELECT id FROM generation');
      expect(rows).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });
});
