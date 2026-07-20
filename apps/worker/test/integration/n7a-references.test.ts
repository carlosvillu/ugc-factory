// Integración del executor N7a · PRODUCT SHOTS, ruta DE REFERENCIAS REALES (T4.4b, §7.2). Ejerce la
// CADENA DETERMINISTA que el smoke live (contra fal) NO puede probar barato ni sin gastar: dado un
// brief con fotos hero REALES, el executor (a) selecciona las URLs por ruta, (b) las descarga y
// re-valida ANTES de gastar (puente URL→asset + defensa AVIF), (c) las sube a fal storage, (d)
// construye el payload de `seedream v4.5/edit` VÍA el `imageEditAdapter` (con el 9:16 propagado como
// `image_size:portrait_16_9`), y (e) persiste 2–3 generaciones con `synthetic_product=false`, cada una
// con su asset + cost_entry. Postgres 16 REAL vía Testcontainers; la ÚNICA frontera mockeada es la red
// (msw): el CDN del brief (descarga de la foto hero), fal storage (upload) y fal seedream (edit).
//
// LO QUE ESTA SUITE PROTEGE (cláusulas deterministas → tests permanentes del gate, regla 8):
//   · el 9:16 LLEGA al payload de seedream (`image_size:portrait_16_9`) — el hueco que la Entrega manda
//     cerrar («los adapters edit descartan el aspect hoy»);
//   · CONTROL NEGATIVO de la re-validación pre-gasto (planning:352): un hero 403 → 0 generaciones, 0
//     gasto (el executor REHÚSA antes de tocar fal);
//   · `synthetic_product=false` (el producto es real, no un packshot IA);
//   · el fallback seedream→NB2 emite el aspect en SU dialecto (`aspect_ratio`, no `image_size`).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import type { ProductBrief } from '@ugc/core/contracts';
import {
  createDbPool,
  getAsset,
  getGeneration,
  getModelProfileByEndpoint,
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
  makeTestPng,
  makeUrlAnalysis,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { makeN7aExecutor } from '../../src/executors/generation';

const noopCollect = (_refs: unknown): void => undefined;

const SEEDREAM_ENDPOINT = 'fal-ai/bytedance/seedream/v4.5/edit';
const NB2_ENDPOINT = 'fal-ai/nano-banana-2/edit';
// La foto hero del brief vive en el CDN del producto (URL del brief). El executor la DESCARGA.
const HERO_URL = 'https://cdn.example.com/serum-hero.jpg';
// El output del editor (el shot 9:16 del producto real).
const OUTPUT_URL = 'https://fal.media/files/out-seedream.png';

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let heroPng: Uint8Array;

/** Handlers del upload a fal storage (flujo initiate + PUT, §9.6): el input (la foto hero) se sube y
 *  fal devuelve una `file_url` pública que va como `image_urls[0]` del edit. */
function uploadHandlers(): Parameters<typeof server.use> {
  return [
    http.post('https://rest.fal.ai/storage/upload/initiate', () =>
      HttpResponse.json({
        upload_url: 'https://storage.fal.run/upload/input',
        file_url: 'https://fal.media/files/uploaded-hero',
      }),
    ),
    http.put('https://storage.fal.run/upload/input', () => new HttpResponse(null, { status: 200 })),
  ];
}

/** Camino feliz de la ruta de referencias: descarga del hero (CDN) + upload a fal + submit/poll/output
 *  del editor. `request_id` DINÁMICO por submit (N7a hace N submits; `fal_request_id` es UNIQUE). */
function happyReferences(endpoint: string): void {
  let counter = 0;
  server.use(
    // El CDN del brief sirve la foto hero (una PNG válida decodificable por sharp).
    http.get(HERO_URL, () =>
      HttpResponse.arrayBuffer(heroPng.buffer as ArrayBuffer, {
        headers: { 'content-type': 'image/png' },
      }),
    ),
    ...uploadHandlers(),
    http.post(`https://queue.fal.run/${endpoint}`, () => {
      counter += 1;
      const id = `n7a-ref-${String(counter)}`;
      return HttpResponse.json({
        request_id: id,
        status_url: `https://queue.fal.run/${endpoint}/requests/${id}/status`,
        response_url: `https://queue.fal.run/${endpoint}/requests/${id}`,
        cancel_url: `https://queue.fal.run/${endpoint}/requests/${id}/cancel`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(`https://queue.fal.run/${endpoint}/requests/:id/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: params.id }),
    ),
    http.get(`https://queue.fal.run/${endpoint}/requests/:id`, () =>
      // seedream/edit REAL emite `width:null, height:null` (NO ausentes — nulls EXPLÍCITOS que el parser
      // ESTRICTO rechaza: `.optional()` acepta ausente, no null). Emitir null aquí es el CONTROL NEGATIVO
      // del fix de money-path: sin el parser tolerante derivado del promptAdapter, este parse da null →
      // FalResponseError → 0 shots. Con el fix, finaliza OK.
      HttpResponse.json({
        images: [{ url: OUTPUT_URL, width: null, height: null, content_type: 'image/png' }],
      }),
    ),
    http.get(OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(heroPng.buffer as ArrayBuffer, {
        headers: { 'content-type': 'image/png' },
      }),
    ),
  );
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'worker:n7a-refs' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-n7a-refs-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  // Una PNG válida (220×220, como las miniaturas reales del producto): sharp la decodifica en el puente.
  heroPng = await makeTestPng(220, 220);
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

/** Siembra proyecto + análisis + brief; devuelve el briefId. `briefOverride` permite variar assets. */
async function seedBrief(brief: ProductBrief = makeBrief()): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [row] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: brief }))
    .returning();
  return row!.id;
}

function makeExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN7aExecutor({
    db,
    storage,
    falKey: () => Promise.resolve('fal-test-key-not-a-secret'),
    logger: makeTestLogger(),
  });
}

describe('N7a executor (T4.4b): shots desde referencias reales del producto', () => {
  it('promote_scraped: descarga el hero, lo sube a fal y edita 2 shots 9:16 con synthetic_product=false', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyReferences(SEEDREAM_ENDPOINT);
      const briefId = await seedBrief();

      const outputs: unknown[] = [];
      await makeExecutor(db)({
        config: { route: 'promote_scraped', briefId, numShots: 2, aspect: '9:16' },
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps: [],
      });

      // 2 generaciones completed, TODAS synthetic_product=FALSE (producto real, no packshot IA).
      const { rows: gens } = await tdb.pool.query<{
        status: string;
        synthetic_product: boolean;
        inputs: { image_urls?: string[]; image_size?: string; num_images?: number; seed?: number };
        content_hash: string;
        model_profile_id: string;
      }>(
        'SELECT status, synthetic_product, inputs, content_hash, model_profile_id FROM generation ORDER BY id',
      );
      expect(gens).toHaveLength(2);
      expect(gens.every((g) => g.status === 'completed')).toBe(true);
      // synthetic_product = FALSE (producto real). Assert EXACTO (no `!g...`, que pasaría con null).
      expect(gens.map((g) => g.synthetic_product)).toEqual([false, false]);

      // ── EL ASSERT CLAVE (deuda que T4.4b cierra) ── el 9:16 LLEGA al payload de seedream como
      // `image_size:portrait_16_9`; antes el adapter lo descartaba. Cae en ROJO si el aspect deja de
      // propagarse.
      expect(gens.every((g) => g.inputs.image_size === 'portrait_16_9')).toBe(true);
      // Las referencias (fal-url de la foto hero subida) viajan como `image_urls` en cada shot.
      expect(gens.every((g) => (g.inputs.image_urls ?? []).length === 1)).toBe(true);
      expect(
        gens.every((g) => g.inputs.image_urls?.[0] === 'https://fal.media/files/uploaded-hero'),
      ).toBe(true);
      // 1 imagen por shot (bucle, no num_images:N) + seed DISTINTO por shot (imágenes/hash distintos).
      expect(gens.every((g) => g.inputs.num_images === 1)).toBe(true);
      expect(new Set(gens.map((g) => g.inputs.seed)).size).toBe(2);
      expect(new Set(gens.map((g) => g.content_hash)).size).toBe(2);

      // Todas resueltas contra el model_profile de seedream (no flux-2).
      const seedream = await getModelProfileByEndpoint(db, SEEDREAM_ENDPOINT);
      expect(gens.every((g) => g.model_profile_id === seedream!.id)).toBe(true);

      // El PUENTE materializó la foto hero como asset `product_image` (además del asset keyframe de cada
      // shot): 1 product_image (deduplicado) + 2 keyframes = 3 assets.
      const { rows: assetKinds } = await tdb.pool.query<{ kind: string; count: string }>(
        'SELECT kind, COUNT(*)::text AS count FROM asset GROUP BY kind',
      );
      const byKind = Object.fromEntries(assetKinds.map((r) => [r.kind, Number(r.count)]));
      expect(byKind.product_image).toBe(1);
      expect(byKind.keyframe).toBe(2);

      // El artefacto: ruta + flag + 2 refs que resuelven a filas reales.
      const out = outputs[0] as {
        route: string;
        syntheticProduct: boolean;
        shots: { generationId: string; assetId: string; costCents: number }[];
      };
      expect(out.route).toBe('promote_scraped');
      expect(out.syntheticProduct).toBe(false);
      expect(out.shots).toHaveLength(2);
      for (const shot of out.shots) {
        expect(await getGeneration(db, shot.generationId)).toBeDefined();
        expect(await getAsset(db, shot.assetId)).toBeDefined();
      }
    } finally {
      await pool.end();
    }
  });

  // ── CONTROL NEGATIVO de la RE-VALIDACIÓN PRE-GASTO (planning:352) ──────────────────────────────
  // Una URL hero que hoy da 200 puede dar 403 mañana. El executor la re-descarga ANTES de gastar; si
  // está muerta, REHÚSA con PermanentStepError y NO toca fal (0 generaciones). Este es EL test que la
  // Entrega exige: «hero apuntando a URL muerta/403 → el código NO gasta».
  it('re-validación: un hero 403 → PermanentStepError y CERO generaciones (no se gasta en fal)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      // El CDN devuelve 403 para el hero; el fal submit NO debe llegar a registrarse (onUnhandledRequest
      // 'error' además cazaría cualquier llamada a fal que se colara).
      server.use(http.get(HERO_URL, () => new HttpResponse(null, { status: 403 })));
      const briefId = await seedBrief();

      await expect(
        makeExecutor(db)({
          config: { route: 'promote_scraped', briefId, numShots: 2, aspect: '9:16' },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);

      // NO se creó NINGUNA generación (rechazo ANTES de cualquier submit a fal).
      const { rows: gens } = await tdb.pool.query('SELECT id FROM generation');
      expect(gens).toHaveLength(0);
      // NO se cobró NADA.
      const { rows: costs } = await tdb.pool.query('SELECT id FROM cost_entry');
      expect(costs).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  it('upload_images: hero + image con la MISMA URL se deduplican a 1 referencia', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyReferences(SEEDREAM_ENDPOINT);
      // El brief por defecto trae hero_image_url == images[0].url (misma URL): dedup → 1 ref.
      const briefId = await seedBrief();

      await makeExecutor(db)({
        config: { route: 'upload_images', briefId, numShots: 2, aspect: '9:16' },
        collectOutput: noopCollect,
        deps: [],
      });

      // 1 solo product_image materializado (deduplicado), aunque hero e images[0] apunten a la misma URL.
      const { rows: prod } = await tdb.pool.query(
        "SELECT id FROM asset WHERE kind = 'product_image'",
      );
      expect(prod).toHaveLength(1);
      const { rows: gens } = await tdb.pool.query<{ synthetic_product: boolean }>(
        'SELECT synthetic_product FROM generation',
      );
      expect(gens.map((g) => g.synthetic_product)).toEqual([false, false]);
    } finally {
      await pool.end();
    }
  });

  // MONEY-PATH: el gasto de fal se REGISTRA con importe NO-CERO CORRECTO y se ATRIBUYE al step (§16).
  //   · IMPORTE: seedream/edit factura `unit='image'` a 4¢/img. Con `num_images:1` cada shot = 1 imagen →
  //     4¢/cost_entry, 8¢ el step. ESTE assert es la 2ª cara del fix de money-path: `finalizeGeneration`
  //     rutaba TODO por `falImageCostOf` (megapíxel-only), que DEGRADA `unit='image'` a 0¢ → los shots de
  //     referencia se registraban a coste 0 (fuga: /spend subreporta). Sin el ruteo por `cost.unit`, este
  //     assert cae en ROJO (0¢ ≠ 4¢). «Se generan shots» NO basta.
  //   · ATRIBUCIÓN: con `step_run_id` el cost_entry lo lleva (base de `step_run.cost_actual`). El executor
  //     pasa `ctx.stepId` a runGenerate, que lo estampa. (`step_run_id` es `text` sin FK dura hasta T4.11 →
  //     se ancla con un id sintético; el camino de producción es idéntico.)
  it('con step_run_id: cada cost_entry lleva el importe REAL (4¢/img seedream) y se atribuye al step', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyReferences(SEEDREAM_ENDPOINT);
      const briefId = await seedBrief();
      const stepId = '01JSTEPRUNXXXXXXXXXXXXXXXX';

      await makeExecutor(db)({
        config: { route: 'promote_scraped', briefId, numShots: 2, aspect: '9:16' },
        collectOutput: noopCollect,
        stepId,
        deps: [],
      });

      // Los cost_entry de fal del step: uno por shot, importe REAL (4¢), unidad 'images', atribuidos.
      const { rows } = await tdb.pool.query<{
        step_run_id: string | null;
        amount_cents: number;
        quantity: number;
        unit: string;
      }>(
        "SELECT step_run_id, amount_cents, quantity, unit FROM cost_entry WHERE provider = 'fal' ORDER BY id",
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.step_run_id === stepId)).toBe(true);
      // ── EL ASSERT ANTI-FUGA ── importe NO-CERO y EXACTO: seedream 4¢/img × 1 img.
      expect(rows.map((r) => r.amount_cents)).toEqual([4, 4]);
      expect(rows.every((r) => r.quantity === 1 && r.unit === 'images')).toBe(true);
      // Y la fila `generation.cost_actual` refleja el mismo importe (no 0).
      const { rows: gens } = await tdb.pool.query<{ cost_actual: number }>(
        'SELECT cost_actual FROM generation',
      );
      expect(gens.map((g) => g.cost_actual)).toEqual([4, 4]);
    } finally {
      await pool.end();
    }
  });

  it('promote_scraped sin hero_image_url → PermanentStepError (no hay referencia que editar)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const brief = makeBrief();
      const briefId = await seedBrief({
        ...brief,
        assets: { ...brief.assets, hero_image_url: null },
      });
      await expect(
        makeExecutor(db)({
          config: { route: 'promote_scraped', briefId, numShots: 2, aspect: '9:16' },
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

// El FALLBACK del editor (Entrega T4.4b): si seedream/edit NO está sembrado, se usa nano-banana-2/edit,
// que expresa el aspect en OTRO dialecto (`aspect_ratio:"9:16"` verbatim, no `image_size`). Se prueba
// borrando la fila de seedream del catálogo sembrado.
describe('N7a executor (T4.4b): fallback a nano-banana-2/edit cuando seedream no está', () => {
  it('sin seedream sembrado → usa NB2 y emite `aspect_ratio:"9:16"` (su dialecto), no image_size', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await tdb.pool.query('DELETE FROM model_profile WHERE fal_endpoint = $1', [
        SEEDREAM_ENDPOINT,
      ]);
      happyReferences(NB2_ENDPOINT);
      const briefId = await seedBrief();

      await makeExecutor(db)({
        config: { route: 'promote_scraped', briefId, numShots: 2, aspect: '9:16' },
        collectOutput: noopCollect,
        deps: [],
      });

      const { rows: gens } = await tdb.pool.query<{
        inputs: { aspect_ratio?: string; image_size?: string };
        model_profile_id: string;
      }>('SELECT inputs, model_profile_id FROM generation');
      expect(gens).toHaveLength(2);
      expect(gens.every((g) => g.inputs.aspect_ratio === '9:16')).toBe(true);
      expect(gens.every((g) => g.inputs.image_size === undefined)).toBe(true);
      const nb2 = await getModelProfileByEndpoint(db, NB2_ENDPOINT);
      expect(gens.every((g) => g.model_profile_id === nb2!.id)).toBe(true);
    } finally {
      // Re-sembrar seedream para no contaminar otros tests del mismo worker (el seed es idempotente).
      const seed = validateGallerySeed(RAW_GALLERY_SEED);
      if (seed.ok && seed.seed) await seedGallery(tdb.db, seed.seed);
      await pool.end();
    }
  });
});
