// Integración del executor N7f · CLIP DE CTA (T5.5a, §7.5 «la CTA es product shot animado»). GEMELO de
// `n7d-broll.test.ts`: ejerce el plan del executor (filtrar la escena `cta`, cuantizar al enum) + el
// guard de catálogo, y —lo que N7d NO cubre— que el clip se persiste con `kind='cta_clip'`, con
// `parent_asset_ids` = el keyframe N7a de la dep, y que el output lleva su CLAVE DISTINTIVA
// (`ctaEndpoint`, no `brollEndpoint`). Fal mockeado (msw — CERO red real, CERO gasto). Postgres 16 REAL
// vía Testcontainers.
//
// EL ARNÉS NUNCA MÁS CÓMODO QUE LA REALIDAD (principio 9): el fake i2v emite EXACTAMENTE lo que el
// endpoint real emite (`{video:{url}}`), igual que `n7d-broll.test.ts`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { N7aOutputSchema } from '@ugc/core/contracts';
import { createDbPool, makeLocalStorageAdapter, seedGallery } from '@ugc/db';
import {
  adBatch,
  adScript,
  adVariant,
  asset,
  productBrief,
  project,
  urlAnalysis,
} from '@ugc/db/schema';
import {
  createTestDatabase,
  http,
  HttpResponse,
  makeAdBatch,
  makeAdScript,
  makeAdVariant,
  makeBrief,
  makeProductBrief,
  makeProject,
  makeTestLogger,
  makeUrlAnalysis,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import type { AdScene } from '@ugc/core/contracts';
import type { ExecutorDep } from '@ugc/core/orchestrator';
import type { StorageAdapter } from '@ugc/core';

import { makeN7fExecutor } from '../../src/executors/generate-cta';
import { makeN7dExecutor } from '../../src/executors/generate-broll';

const I2V_ENDPOINT = 'fal-ai/veo3.1/image-to-video';
const noopCollect = (_refs: unknown): void => undefined;

const VIDEO_URL = 'https://v3.fal.media/files/cta/clip.mp4';
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const IMG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** Camino feliz de Veo i2v con request_id DINÁMICO por submit. Output SIN `duration` (Veo no la emite).
 *  Sirve upload + submit + poll + descarga para el endpoint dado. */
function happyI2v(endpoint: string): void {
  let counter = 0;
  server.use(
    http.post('https://rest.fal.ai/storage/upload/initiate', () =>
      HttpResponse.json({
        upload_url: 'https://storage.fal.run/upload/input',
        file_url: 'https://fal.media/files/uploaded-input',
      }),
    ),
    http.put('https://storage.fal.run/upload/input', () => new HttpResponse(null, { status: 200 })),
    http.post(`https://queue.fal.run/${endpoint}`, () => {
      counter += 1;
      const id = `cta-req-${String(counter)}`;
      return HttpResponse.json({
        request_id: id,
        status_url: `https://queue.fal.run/${endpoint}/requests/${id}/status`,
        response_url: `https://queue.fal.run/${endpoint}/requests/${id}`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(`https://queue.fal.run/${endpoint}/requests/:id/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: params.id }),
    ),
    http.get(`https://queue.fal.run/${endpoint}/requests/:id`, () =>
      HttpResponse.json({ video: { url: VIDEO_URL, content_type: 'video/mp4' } }),
    ),
    http.get(VIDEO_URL, () =>
      HttpResponse.arrayBuffer(MP4_BYTES.buffer, { headers: { 'content-type': 'video/mp4' } }),
    ),
  );
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'worker:n7f' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-n7f-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
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
    'TRUNCATE generation, asset, cost_entry, ad_script, ad_variant, ad_batch, product_brief, url_analysis, project CASCADE',
  );
});

const s = (over: Partial<AdScene>): AdScene => ({
  t: 0,
  seconds: 2,
  segment: 'cta',
  narration: 'link in bio',
  visual: 'x',
  camera: 'x',
  emotion: 'x',
  ...over,
});

/** Siembra project→…→ad_script con las escenas dadas; devuelve el scriptId. */
async function seedScript(scenes: AdScene[]): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: makeBrief() }))
    .returning();
  const [batch] = await tdb.db
    .insert(adBatch)
    .values(makeAdBatch({ projectId: p!.id, briefId: brief!.id }))
    .returning();
  const [variant] = await tdb.db
    .insert(adVariant)
    .values(makeAdVariant({ batchId: batch!.id }))
    .returning();
  const [script] = await tdb.db
    .insert(adScript)
    .values(makeAdScript({ variantId: variant!.id, language: 'en', scenes }))
    .returning();
  return script!.id;
}

/** Crea un asset de imagen (keyframe) en storage + BD. */
async function makeKeyframe(): Promise<string> {
  const key = `inputs/keyframe/${Math.random().toString(36).slice(2)}`;
  const put = await storage.put(key, IMG_BYTES, { mime: 'image/png' });
  const [row] = await tdb.db
    .insert(asset)
    .values({
      kind: 'keyframe',
      storageKey: key,
      mime: 'image/png',
      bytes: put.bytes,
      checksum: put.checksum,
    })
    .returning();
  return row!.id;
}

/** Una dep resuelta de N7a que expone un shot con el keyframe dado — el executor deriva de aquí los
 *  keyframes cuando corre como nodo de un RUN (precedencia dep-wins, igual que N7d). El `outputRefs`
 *  valida contra `N7aOutputSchema` (discriminado por schema, no por node_key), así que se construye con
 *  su forma REAL. */
function n7aDep(keyframeAssetId: string): ExecutorDep {
  const outputRefs = N7aOutputSchema.parse({
    route: 'ai_packshot',
    syntheticProduct: true,
    shots: [{ generationId: 'gen-n7a', assetId: keyframeAssetId, costCents: 5 }],
  });
  return { stepId: 'step-n7a', nodeKey: 'N7a', status: 'succeeded', outputRefs };
}

function makeExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN7fExecutor({
    db,
    storage,
    falKey: () => Promise.resolve('fal-test-key-not-a-secret'),
    logger: makeTestLogger(),
  });
}

function makeBrollExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN7dExecutor({
    db,
    storage,
    falKey: () => Promise.resolve('fal-test-key-not-a-secret'),
    logger: makeTestLogger(),
  });
}

describe('N7f executor (T5.5a): clip de CTA (product shot animado i2v)', () => {
  it('ESPINA: una escena cta ⇒ 1 clip kind=cta_clip con parent_asset_ids = keyframe N7a; output con ctaEndpoint', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyI2v(I2V_ENDPOINT);
      const scriptId = await seedScript([
        s({ t: 0, seconds: 4, segment: 'hook', narration: 'hook' }),
        s({ t: 4, seconds: 6, segment: 'body', narration: 'body' }),
        s({ t: 10, seconds: 2, segment: 'cta', narration: 'link in bio' }),
      ]);
      const keyframe = await makeKeyframe();

      const outputs: unknown[] = [];
      await makeExecutor(db)({
        config: { scriptId, ctaEndpoint: I2V_ENDPOINT },
        collectOutput: (refs: unknown) => outputs.push(refs),
        // El keyframe llega por la DEP N7a (path de RUN), no por config: prueba la derivación dep-wins.
        deps: [n7aDep(keyframe)],
      });

      // EXACTAMENTE 1 clip de CTA (la única escena cta; hook/body NO generan cta_clip).
      const { rows: clips } = await tdb.pool.query<{
        kind: string;
        duration_s: number;
        parent_asset_ids: string[];
      }>("SELECT kind, duration_s, parent_asset_ids FROM asset WHERE kind = 'cta_clip'");
      expect(clips).toHaveLength(1);
      expect(clips[0]?.kind).toBe('cta_clip');
      // cta de 2s → enum 4 (redondeo-arriba al enum de Veo {4,6,8}).
      expect(clips[0]?.duration_s).toBe(4);
      // LINAJE: el clip deriva del keyframe N7a que se animó (§12 parent_asset_ids).
      expect(clips[0]?.parent_asset_ids).toEqual([keyframe]);

      // 1 generación completed, 1 cost_entry por SEGUNDO.
      const { rows: gens } = await tdb.pool.query<{ status: string }>(
        'SELECT status FROM generation',
      );
      expect(gens).toHaveLength(1);
      expect(gens[0]?.status).toBe('completed');
      const { rows: costs } = await tdb.pool.query<{ unit: string }>('SELECT unit FROM cost_entry');
      expect(costs).toHaveLength(1);
      expect(costs[0]?.unit).toBe('seconds');

      // OUTPUT con la CLAVE DISTINTIVA `ctaEndpoint` (NO brollEndpoint): así T5.5d discrimina N7f de N7d.
      const out = outputs[0] as {
        ctaEndpoint?: string;
        brollEndpoint?: string;
        route: string;
        clips: { ctaSceneIndex: number; assetId: string }[];
      };
      expect(out.ctaEndpoint).toBe(I2V_ENDPOINT);
      expect(out.brollEndpoint).toBeUndefined();
      expect(out.route).toBe('i2v');
      expect(out.clips).toHaveLength(1);
      expect(out.clips[0]?.ctaSceneIndex).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('CONTROL NEGATIVO (anti-colisión de dedup, T5.5a): body(4s)+cta(4s) sobre el MISMO keyframe ⇒ AMBOS assets persisten (broll_clip Y cta_clip), sin LoserRaceError', async () => {
    // El bug que muerde: N7f reusa el MISMO endpoint (I2V), el MISMO keyframe N7a y el MISMO prompt por
    // defecto que N7d. Con el salt de N7d = "bodySceneIndex:clipIndex" y el de N7f = "ctaSceneIndex:
    // clipIndex", body escena 0 → "0:0" y cta escena 0 → "0:0" COLISIONAN: mismo content_hash. El índice
    // único de PRODUCCIÓN (global por hash) haría que el SEGUNDO en generar (N7f) chocara y fuese a
    // `failed` en bucle (LoserRaceError) — la escena cta NUNCA se generaría. El fix namespacea el salt de
    // N7f con `cta:` (espacios disjuntos). Este test EJERCE el caso exacto y exige que AMBOS clips existan.
    // Si se quita el prefijo `cta:` de generate-cta.ts, este test se pone ROJO (N7f falla por la colisión).
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyI2v(I2V_ENDPOINT);
      // body(4s) y cta(4s): misma duración → mismo enum cuantizado (4). Mismo keyframe, mismo prompt por
      // defecto, mismo endpoint → el ÚNICO discriminador posible del hash es el salt namespaceado.
      const scriptId = await seedScript([
        s({ t: 0, seconds: 4, segment: 'body', narration: 'body four seconds' }),
        s({ t: 4, seconds: 4, segment: 'cta', narration: 'cta four seconds' }),
      ]);
      const keyframe = await makeKeyframe();

      // N7d primero (crea el broll_clip con content_hash H). Luego N7f sobre el MISMO keyframe/duración.
      await makeBrollExecutor(db)({
        config: { scriptId, brollEndpoint: I2V_ENDPOINT, imageAssetIds: [keyframe] },
        collectOutput: noopCollect,
        deps: [],
      });
      await makeExecutor(db)({
        config: { scriptId, ctaEndpoint: I2V_ENDPOINT, imageAssetIds: [keyframe] },
        collectOutput: noopCollect,
        deps: [],
      });

      // AMBOS assets existen: el prefijo `cta:` mantuvo los content_hash disjuntos → N7f no chocó con el
      // índice único de producción de N7d. Sin el fix, N7f iría a `failed` y no habría fila cta_clip.
      const { rows } = await tdb.pool.query<{ kind: string }>(
        "SELECT kind FROM asset WHERE kind IN ('broll_clip', 'cta_clip') ORDER BY kind",
      );
      expect(rows.map((r) => r.kind)).toEqual(['broll_clip', 'cta_clip']);
      // Y ambas generaciones quedaron `completed` (ninguna en `failed` por la carrera perdida de dedup).
      const { rows: gens } = await tdb.pool.query<{ status: string }>(
        'SELECT status FROM generation',
      );
      expect(gens).toHaveLength(2);
      expect(gens.every((g) => g.status === 'completed')).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('MONEY-GATE: una escena cta SIN keyframe (ni dep N7a ni config) → PermanentStepError, NO gasta', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      // NO se registran handlers de fal: si intentara subir/llamar, msw reventaría (prueba de que NO gastó).
      const scriptId = await seedScript([
        s({ t: 0, seconds: 2, segment: 'cta', narration: 'cta' }),
      ]);
      await expect(
        makeExecutor(db)({
          config: { scriptId, ctaEndpoint: I2V_ENDPOINT },
          collectOutput: noopCollect,
          deps: [], // sin dep N7a y sin cfg.imageAssetIds
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
      const { rows } = await tdb.pool.query('SELECT id FROM generation');
      expect(rows).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  it('guion SIN escena cta → PermanentStepError (no hay CTA que generar, no gasta)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const scriptId = await seedScript([
        s({ t: 0, seconds: 4, segment: 'hook', narration: 'hook' }),
        s({ t: 4, seconds: 6, segment: 'body', narration: 'body' }),
      ]);
      const keyframe = await makeKeyframe();
      await expect(
        makeExecutor(db)({
          config: { scriptId, ctaEndpoint: I2V_ENDPOINT, imageAssetIds: [keyframe] },
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

  it('GUARD DE CATÁLOGO: aspect fuera del enum del modelo → PermanentStepError, NO gasta', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const scriptId = await seedScript([
        s({ t: 0, seconds: 2, segment: 'cta', narration: 'cta' }),
      ]);
      const keyframe = await makeKeyframe();
      await expect(
        makeExecutor(db)({
          config: {
            scriptId,
            ctaEndpoint: I2V_ENDPOINT,
            imageAssetIds: [keyframe],
            aspect: '4:5', // ← no está en capabilities.aspects
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

  it('STEPLESS: el keyframe puede llegar por config (imageAssetIds) sin dep N7a', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyI2v(I2V_ENDPOINT);
      const scriptId = await seedScript([
        s({ t: 0, seconds: 2, segment: 'cta', narration: 'cta' }),
      ]);
      const keyframe = await makeKeyframe();
      await makeExecutor(db)({
        config: { scriptId, ctaEndpoint: I2V_ENDPOINT, imageAssetIds: [keyframe] },
        collectOutput: noopCollect,
        deps: [],
      });
      const { rows } = await tdb.pool.query<{ kind: string }>(
        "SELECT kind FROM asset WHERE kind = 'cta_clip'",
      );
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

  it('endpoint que no es kind de vídeo (un TTS) → PermanentStepError (no se gasta)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const scriptId = await seedScript([
        s({ t: 0, seconds: 2, segment: 'cta', narration: 'cta' }),
      ]);
      const keyframe = await makeKeyframe();
      await expect(
        makeExecutor(db)({
          config: {
            scriptId,
            ctaEndpoint: 'fal-ai/kokoro', // kind 'tts'
            imageAssetIds: [keyframe],
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
