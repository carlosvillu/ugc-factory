// Integración del executor N7c · CLIP DE AVATAR, tiers image+audio (T4.7, §7.2 N7c). Ejerce lo que el
// smoke (que conduce el SERVICIO directo) NO cubre: el GUARD DE DINERO del executor (≤maxDuration ANTES
// de gastar) y el cableado (config inválida, perfil/asset ausente, kind incorrecto). El camino feliz
// invoca el avatar con fal mockeado (msw — CERO red real, CERO gasto). Postgres 16 REAL vía
// Testcontainers. El output de avatar se DERIVA del schema confirmado (`{video:{url}, duration}`); los
// modelos de avatar están prohibidos en la suite live (external-apis §8) — el smoke del verifier
// confirma la forma en vivo. Molde: `n7a-packshot.test.ts`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import {
  createAsset,
  createDbPool,
  makeLocalStorageAdapter,
  seedGallery,
  type Asset,
} from '@ugc/db';
import {
  createTestDatabase,
  http,
  HttpResponse,
  makeTestLogger,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { makeN7cExecutor } from '../../src/executors/generate-avatar';

const noopCollect = (_refs: unknown): void => undefined;

const KLING_ENDPOINT = 'fal-ai/kling-video/ai-avatar/v2/standard';
const OMNIHUMAN_ENDPOINT = 'fal-ai/bytedance/omnihuman/v1.5';
const VIDEO_URL = 'https://v3.fal.media/files/avatar/clip.mp4';
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const IMG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const WAV_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;

/** Handlers de upload a fal storage (initiate + PUT) + submit/poll/download del avatar. */
function happyAvatar(endpoint: string): void {
  const req = `n7c-req-${endpoint.replace(/\W/g, '')}`;
  server.use(
    http.post('https://rest.fal.ai/storage/upload/initiate', () =>
      HttpResponse.json({
        upload_url: 'https://storage.fal.run/upload/input',
        file_url: 'https://fal.media/files/uploaded-input',
      }),
    ),
    http.put('https://storage.fal.run/upload/input', () => new HttpResponse(null, { status: 200 })),
    http.post(`https://queue.fal.run/${endpoint}`, () =>
      HttpResponse.json({
        request_id: req,
        status_url: `https://queue.fal.run/${endpoint}/requests/${req}/status`,
        response_url: `https://queue.fal.run/${endpoint}/requests/${req}`,
        status: 'IN_QUEUE',
      }),
    ),
    http.get(`https://queue.fal.run/${endpoint}/requests/${req}/status`, () =>
      HttpResponse.json({ status: 'COMPLETED', request_id: req }),
    ),
    http.get(`https://queue.fal.run/${endpoint}/requests/${req}`, () =>
      HttpResponse.json({ video: { url: VIDEO_URL, content_type: 'video/mp4' }, duration: 4 }),
    ),
    http.get(VIDEO_URL, () =>
      HttpResponse.arrayBuffer(MP4_BYTES.buffer, { headers: { 'content-type': 'video/mp4' } }),
    ),
  );
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'worker:n7c' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-n7c-'));
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
  await tdb.pool.query('TRUNCATE generation, asset, cost_entry CASCADE');
});

/** Crea un asset de input (imagen/audio) en storage + BD. */
async function makeInputAsset(
  db: ReturnType<typeof createDbPool>['db'],
  kind: Asset['kind'],
  bytes: Uint8Array,
  mime: string,
  durationS?: number,
): Promise<Asset> {
  const key = `inputs/${kind}/${Math.random().toString(36).slice(2)}`;
  const put = await storage.put(key, bytes, { mime });
  return createAsset(db, {
    kind,
    storageKey: key,
    mime,
    bytes: put.bytes,
    checksum: put.checksum,
    ...(durationS !== undefined ? { durationS } : {}),
  });
}

function makeExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN7cExecutor({
    db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    logger: makeTestLogger(),
  });
}

describe('N7c executor (T4.7): clip de avatar image+audio', () => {
  it('KLING Std: anima imagen+audio, persiste avatar_clip completed + cost_entry, artefacto con refs', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyAvatar(KLING_ENDPOINT);
      const image = await makeInputAsset(db, 'reference_image', IMG_BYTES, 'image/png');
      const audio = await makeInputAsset(db, 'tts_audio', WAV_BYTES, 'audio/wav', 4);

      const outputs: unknown[] = [];
      await makeExecutor(db)({
        config: {
          avatarEndpoint: KLING_ENDPOINT,
          imageAssetId: image.id,
          audioAssetId: audio.id,
        },
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps: [],
      });

      const { rows: gens } = await tdb.pool.query<{ status: string }>(
        'SELECT status FROM generation',
      );
      expect(gens).toHaveLength(1);
      expect(gens[0]?.status).toBe('completed');
      // Solo el asset PRODUCIDO (avatar_clip); los 2 inputs (reference_image + tts_audio) también
      // están en la tabla, así que se filtra por kind.
      const { rows: clips } = await tdb.pool.query<{ duration_s: number }>(
        "SELECT duration_s FROM asset WHERE kind = 'avatar_clip'",
      );
      expect(clips).toHaveLength(1);
      expect(clips[0]?.duration_s).toBeCloseTo(4, 3);

      expect(outputs).toHaveLength(1);
      const out = outputs[0] as {
        avatarEndpoint: string;
        generationId: string;
        assetId: string;
        durationSeconds: number;
        costCents: number;
      };
      expect(out.avatarEndpoint).toBe(KLING_ENDPOINT);
      expect(out.costCents).toBe(22); // 5,62¢/s × 4 s = 22¢
    } finally {
      await pool.end();
    }
  });

  it('GUARD ≤maxDuration: OmniHuman (≤30s) con audio de 35s → PermanentStepError, NO gasta', async () => {
    // El guard de dinero: OmniHuman declara `capabilities.maxDuration=30`. Un hook de 35 s haría que fal
    // rechazara la request → se aborta ANTES de llamar (PermanentStepError, no reintentable). Data-driven
    // (lee maxDuration del perfil), no `if endpoint === omnihuman`. NO se registra ningún handler de fal:
    // si el executor intentara llamar, msw reventaría con onUnhandledRequest:'error' — prueba extra de
    // que NO gastó.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const image = await makeInputAsset(db, 'reference_image', IMG_BYTES, 'image/png');
      const audio = await makeInputAsset(db, 'tts_audio', WAV_BYTES, 'audio/wav', 35);
      await expect(
        makeExecutor(db)({
          config: {
            avatarEndpoint: OMNIHUMAN_ENDPOINT,
            imageAssetId: image.id,
            audioAssetId: audio.id,
            resolution: '1080p',
          },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
      // NO se creó ninguna generación (aborto ANTES de gastar).
      const { rows } = await tdb.pool.query('SELECT id FROM generation');
      expect(rows).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  it('KLING (sin maxDuration) NO gatea el guard: un audio largo pasa (Kling no declara el límite)', async () => {
    // Control del data-driven: Kling NO declara `maxDuration`, así que un audio de 35 s NO se aborta —
    // el guard solo muerde cuando el perfil declara el límite. El clip se genera normal.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyAvatar(KLING_ENDPOINT);
      const image = await makeInputAsset(db, 'reference_image', IMG_BYTES, 'image/png');
      const audio = await makeInputAsset(db, 'tts_audio', WAV_BYTES, 'audio/wav', 35);
      await makeExecutor(db)({
        config: {
          avatarEndpoint: KLING_ENDPOINT,
          imageAssetId: image.id,
          audioAssetId: audio.id,
        },
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

  it('OmniHuman con audio de 30s EXACTOS (== maxDuration) NO se aborta (límite inclusivo ≤)', async () => {
    // Frontera: el límite es ≤maxDuration, así que 30 s exactos pasan. Reintroducir un `>=` abortaría el
    // caso válido de 30 s.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyAvatar(OMNIHUMAN_ENDPOINT);
      const image = await makeInputAsset(db, 'reference_image', IMG_BYTES, 'image/png');
      const audio = await makeInputAsset(db, 'tts_audio', WAV_BYTES, 'audio/wav', 30);
      await makeExecutor(db)({
        config: {
          avatarEndpoint: OMNIHUMAN_ENDPOINT,
          imageAssetId: image.id,
          audioAssetId: audio.id,
        },
        collectOutput: noopCollect,
        deps: [],
      });
      const { rows } = await tdb.pool.query<{ status: string }>('SELECT status FROM generation');
      expect(rows[0]?.status).toBe('completed');
    } finally {
      await pool.end();
    }
  });

  it('config inválida (sin imageAssetId) → PermanentStepError', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: { avatarEndpoint: KLING_ENDPOINT, audioAssetId: 'x' },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });

  it('endpoint que no es kind avatar (un TTS) → PermanentStepError (no se gasta)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const image = await makeInputAsset(db, 'reference_image', IMG_BYTES, 'image/png');
      const audio = await makeInputAsset(db, 'tts_audio', WAV_BYTES, 'audio/wav', 4);
      await expect(
        makeExecutor(db)({
          config: {
            avatarEndpoint: 'fal-ai/kokoro', // kind 'tts', no 'avatar'
            imageAssetId: image.id,
            audioAssetId: audio.id,
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

  it('asset de audio inexistente → PermanentStepError (no se gasta)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const image = await makeInputAsset(db, 'reference_image', IMG_BYTES, 'image/png');
      await expect(
        makeExecutor(db)({
          config: {
            avatarEndpoint: KLING_ENDPOINT,
            imageAssetId: image.id,
            audioAssetId: '01JXXXXXXXXXXXXXXXXXXXXXXX',
          },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });
});
