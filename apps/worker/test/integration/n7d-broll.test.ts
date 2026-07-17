// Integración del executor N7d · B-ROLL POR ESCENA (T4.8, §7.2 N7d + §7.5). Ejerce lo que el smoke
// (que conduce el SERVICIO directo) NO cubre: el PLAN DE CLIPS del executor — filtrar el body (§7.5
// «el b-roll es el body»), trocear escenas > maxDuration, cuantizar al enum del modelo — y el guard de
// catálogo (aspect/resolution válidos ANTES de gastar). El camino feliz invoca Veo con fal mockeado
// (msw — CERO red real, CERO gasto). Postgres 16 REAL vía Testcontainers.
//
// LA CLÁUSULA ESPINA DE LA VERIFICACIÓN (regla de trabajo 8): «para una variante de conversión (21–34s)
// se generan EXACTAMENTE los clips del presupuesto §7.5 (1 avatar + 2 b-roll)». N7d es el b-roll → un
// guion de conversión (hook + 2 body + cta) DEBE producir EXACTAMENTE 2 clips de b-roll (uno por escena
// de body, sin trocear si caben). Ese conteo es un gate test permanente. Molde: `n7b-voiceover.test.ts`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createDbPool, makeLocalStorageAdapter, seedGallery } from '@ugc/db';
import {
  adBatch,
  adScript,
  adVariant,
  asset,
  modelProfile,
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
import type { StorageAdapter } from '@ugc/core';

import { makeN7dExecutor } from '../../src/executors/generate-broll';

const I2V_ENDPOINT = 'fal-ai/veo3.1/image-to-video';
const R2V_ENDPOINT = 'fal-ai/veo3.1/reference-to-video';
const noopCollect = (_refs: unknown): void => undefined;

const VIDEO_URL = 'https://v3.fal.media/files/broll/clip.mp4';
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const IMG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** Camino feliz de Veo b-roll con request_id DINÁMICO por submit (N7d hace un submit por CLIP; el
 *  fal_request_id es UNIQUE). Output SIN `duration` (Veo i2v/R2V no la emite). Sirve upload + submit +
 *  poll + descarga para el endpoint dado. */
function happyBroll(endpoint: string): void {
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
      const id = `brl-req-${String(counter)}`;
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
  tdb = await createTestDatabase({ label: 'worker:n7d' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-n7d-'));
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
  seconds: 5,
  segment: 'body',
  narration: 'apply the serum to camera',
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

/** Crea un asset de imagen (keyframe / product ref) en storage + BD. */
async function makeImageAsset(kind: 'keyframe' | 'product_image' = 'keyframe'): Promise<string> {
  const key = `inputs/${kind}/${Math.random().toString(36).slice(2)}`;
  const put = await storage.put(key, IMG_BYTES, { mime: 'image/png' });
  const [row] = await tdb.db
    .insert(asset)
    .values({
      kind,
      storageKey: key,
      mime: 'image/png',
      bytes: put.bytes,
      checksum: put.checksum,
    })
    .returning();
  return row!.id;
}

/** Siembra un model_profile de b-roll a medida (para probar invariantes de catálogo). Endpoint único
 *  por llamada (clave natural UNIQUE). Devuelve el endpoint. */
async function seedBrollProfile(caps: Record<string, unknown>): Promise<string> {
  const endpoint = `fal-ai/test-broll/${Math.random().toString(36).slice(2)}`;
  await tdb.db.insert(modelProfile).values({
    falEndpoint: endpoint,
    kind: 'i2v',
    capabilities: caps,
    cost: { unit: 'second', amountCents: 20 },
    promptAdapter: 'i2v',
  });
  return endpoint;
}

function makeExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN7dExecutor({
    db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    logger: makeTestLogger(),
  });
}

// Escenas de la Verificación: variante de CONVERSIÓN (21–34s) = hook (avatar) + 2 body (b-roll) + cta.
const CONVERSION_SCENES: AdScene[] = [
  s({ t: 0, seconds: 10, segment: 'hook', narration: 'hook line' }),
  s({ t: 10, seconds: 6, segment: 'body', narration: 'body clip one' }),
  s({ t: 16, seconds: 7, segment: 'body', narration: 'body clip two' }),
  s({ t: 23, seconds: 5, segment: 'cta', narration: 'cta line' }),
];

describe('N7d executor (T4.8): b-roll por escena de body', () => {
  it('ESPINA: variante de conversión (hook + 2 body + cta) ⇒ EXACTAMENTE 2 clips de b-roll (§7.5)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyBroll(I2V_ENDPOINT);
      const scriptId = await seedScript(CONVERSION_SCENES);
      const keyframe = await makeImageAsset('keyframe');

      const outputs: unknown[] = [];
      await makeExecutor(db)({
        config: {
          scriptId,
          brollEndpoint: I2V_ENDPOINT,
          imageAssetIds: [keyframe],
          aspect: '9:16',
          resolution: '720p',
        },
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps: [],
      });

      // EXACTAMENTE 2 clips de b-roll (uno por escena de body; hook/cta NO generan b-roll). Ni 4 (todas
      // las escenas) ni 3: solo el body. Este conteo ES la cláusula de la Verificación.
      const { rows: clips } = await tdb.pool.query<{ kind: string; duration_s: number }>(
        "SELECT kind, duration_s FROM asset WHERE kind = 'broll_clip' ORDER BY id",
      );
      expect(clips).toHaveLength(2);
      expect(clips.every((c) => c.kind === 'broll_clip')).toBe(true);
      // Body de 6s → enum 6; body de 7s → enum 8 (redondeo-arriba al enum de Veo {4,6,8}).
      expect(clips.map((c) => c.duration_s).sort()).toEqual([6, 8]);

      // 2 generaciones completed, 2 cost_entry (uno por clip), por SEGUNDO.
      const { rows: gens } = await tdb.pool.query<{ status: string }>(
        'SELECT status FROM generation',
      );
      expect(gens).toHaveLength(2);
      expect(gens.every((g) => g.status === 'completed')).toBe(true);
      const { rows: costs } = await tdb.pool.query<{ unit: string }>('SELECT unit FROM cost_entry');
      expect(costs).toHaveLength(2);
      expect(costs.every((c) => c.unit === 'seconds')).toBe(true);

      const out = outputs[0] as { route: string; clips: unknown[] };
      expect(out.route).toBe('i2v');
      expect(out.clips).toHaveLength(2);
    } finally {
      await pool.end();
    }
  });

  it('TROCEO §7.5: una escena de body > maxDuration se parte en 2 clips ≤ maxDuration', async () => {
    // maxDuration de Veo = 8 (max del enum). Una escena de body de 15s → 2 clips de 7,5s → cuantizados
    // a 8s cada uno. Una sola escena de body, pero DOS clips (el troceo).
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyBroll(I2V_ENDPOINT);
      const scriptId = await seedScript([
        s({ t: 0, seconds: 4, segment: 'hook', narration: 'hook' }),
        s({ t: 4, seconds: 15, segment: 'body', narration: 'long body scene' }),
      ]);
      const keyframe = await makeImageAsset('keyframe');

      const outputs: unknown[] = [];
      await makeExecutor(db)({
        config: { scriptId, brollEndpoint: I2V_ENDPOINT, imageAssetIds: [keyframe] },
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps: [],
      });

      const { rows: clips } = await tdb.pool.query<{ duration_s: number }>(
        "SELECT duration_s FROM asset WHERE kind = 'broll_clip'",
      );
      expect(clips).toHaveLength(2); // la escena larga se troceó
      expect(clips.every((c) => c.duration_s === 8)).toBe(true); // 7,5s → enum 8

      // Los 2 clips troceados vienen de la MISMA escena de body (bodySceneIndex 0), distinguidos por
      // clipIndex 0/1 — NO dos escenas distintas. (Control del fix: el índice aplanado los marcaría 0/1
      // como si fueran escenas separadas.)
      const out = outputs[0] as {
        clips: { bodySceneIndex: number; clipIndex: number }[];
      };
      expect(out.clips.map((c) => c.bodySceneIndex)).toEqual([0, 0]);
      expect(out.clips.map((c) => c.clipIndex)).toEqual([0, 1]);
    } finally {
      await pool.end();
    }
  });

  it('R2V: usa el endpoint reference-to-video (kind r2v) con las referencias del producto', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyBroll(R2V_ENDPOINT);
      const scriptId = await seedScript([s({ t: 0, seconds: 6, segment: 'body', narration: 'x' })]);
      const ref1 = await makeImageAsset('product_image');
      const ref2 = await makeImageAsset('product_image');

      const outputs: unknown[] = [];
      await makeExecutor(db)({
        config: {
          scriptId,
          brollEndpoint: R2V_ENDPOINT,
          imageAssetIds: [ref1, ref2],
        },
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps: [],
      });

      const { rows: clips } = await tdb.pool.query(
        "SELECT id FROM asset WHERE kind = 'broll_clip'",
      );
      expect(clips).toHaveLength(1);
      // R2V es duración FIJA 8s (enum de un valor) sea cual sea la escena.
      const { rows: dur } = await tdb.pool.query<{ duration_s: number }>(
        "SELECT duration_s FROM asset WHERE kind = 'broll_clip'",
      );
      expect(dur[0]?.duration_s).toBe(8);
      const out = outputs[0] as { route: string };
      expect(out.route).toBe('r2v');
    } finally {
      await pool.end();
    }
  });

  it('GUARD DE CATÁLOGO: aspect fuera del enum del modelo → PermanentStepError, NO gasta', async () => {
    // Veo declara aspects=[auto,9:16,16:9]. Un aspect '4:5' que no está → aborto ANTES de gastar. NO se
    // registran handlers de fal: si intentara subir/llamar, msw reventaría con onUnhandledRequest:'error'.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const scriptId = await seedScript([s({ t: 0, seconds: 6, segment: 'body', narration: 'x' })]);
      const keyframe = await makeImageAsset('keyframe');
      await expect(
        makeExecutor(db)({
          config: {
            scriptId,
            brollEndpoint: I2V_ENDPOINT,
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

  it('INVARIANTE dinero: maxDuration ≠ max(durations) → PermanentStepError ANTES de gastar (sin submit)', async () => {
    // Perfil mal sembrado: maxDuration=12 pero max(durations)=8. Una escena de 12s NO se trocearía
    // (12≤12) → 1 clip de 12s → la cuantización lo CLAMPARÍA a 8 → 8s facturados por una ventana de 12s.
    // El executor lo caza en el guard de catálogo y ABORTA sin llamar a fal. NO se registran handlers de
    // fal: si intentara subir/llamar, msw reventaría con onUnhandledRequest:'error' (prueba de que NO gastó).
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const endpoint = await seedBrollProfile({
        aspects: ['9:16'],
        durations: [4, 6, 8],
        maxDuration: 12, // ← incoherente con max(durations)=8
        resolutions: ['720p'],
      });
      const scriptId = await seedScript([
        s({ t: 0, seconds: 12, segment: 'body', narration: 'x' }),
      ]);
      const keyframe = await makeImageAsset('keyframe');
      await expect(
        makeExecutor(db)({
          config: { scriptId, brollEndpoint: endpoint, imageAssetIds: [keyframe] },
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

  it('CONTROL NEGATIVO del invariante: maxDuration == max(durations) → NO lanza (genera normal)', async () => {
    // El MISMO perfil pero coherente (maxDuration=8=max([4,6,8])): el guard NO muerde y el clip se genera.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const endpoint = await seedBrollProfile({
        aspects: ['9:16'],
        durations: [4, 6, 8],
        maxDuration: 8, // ← coherente
        resolutions: ['720p'],
      });
      happyBroll(endpoint);
      const scriptId = await seedScript([s({ t: 0, seconds: 6, segment: 'body', narration: 'x' })]);
      const keyframe = await makeImageAsset('keyframe');
      await makeExecutor(db)({
        config: { scriptId, brollEndpoint: endpoint, imageAssetIds: [keyframe] },
        collectOutput: noopCollect,
        deps: [],
      });
      const { rows } = await tdb.pool.query<{ status: string }>('SELECT status FROM generation');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('completed');
    } finally {
      await pool.end();
    }
  });

  it('INVARIANTE dinero: durations sin maxDuration → PermanentStepError (el troceo no topa)', async () => {
    // durations presente pero maxDuration ausente: el troceo no cotaría nada → clamp silencioso sobre
    // cualquier escena larga. Es incoherente para b-roll → aborta antes de gastar.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const endpoint = await seedBrollProfile({
        aspects: ['9:16'],
        durations: [4, 6, 8],
        resolutions: ['720p'],
        // maxDuration AUSENTE
      });
      const scriptId = await seedScript([s({ t: 0, seconds: 6, segment: 'body', narration: 'x' })]);
      const keyframe = await makeImageAsset('keyframe');
      await expect(
        makeExecutor(db)({
          config: { scriptId, brollEndpoint: endpoint, imageAssetIds: [keyframe] },
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

  it('guion SIN escenas de body → PermanentStepError (no hay b-roll que generar, no gasta)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const scriptId = await seedScript([
        s({ t: 0, seconds: 4, segment: 'hook', narration: 'hook' }),
        s({ t: 4, seconds: 4, segment: 'cta', narration: 'cta' }),
      ]);
      const keyframe = await makeImageAsset('keyframe');
      await expect(
        makeExecutor(db)({
          config: { scriptId, brollEndpoint: I2V_ENDPOINT, imageAssetIds: [keyframe] },
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

  it('endpoint que no es kind de vídeo (un TTS) → PermanentStepError (no se gasta)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const scriptId = await seedScript([s({ t: 0, seconds: 6, segment: 'body', narration: 'x' })]);
      const keyframe = await makeImageAsset('keyframe');
      await expect(
        makeExecutor(db)({
          config: {
            scriptId,
            brollEndpoint: 'fal-ai/kokoro', // kind 'tts'
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

  it('config inválida (sin imageAssetIds) → PermanentStepError', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const scriptId = await seedScript([s({ t: 0, seconds: 6, segment: 'body', narration: 'x' })]);
      await expect(
        makeExecutor(db)({
          config: { scriptId, brollEndpoint: I2V_ENDPOINT, imageAssetIds: [] },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });
});
