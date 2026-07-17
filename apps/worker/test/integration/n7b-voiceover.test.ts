// Integración del executor N7b · TTS + WORD TIMESTAMPS (T4.5, §7.2 N7b + §13.1). Ejerce la CADENA
// DETERMINISTA que la Verificación live (smoke contra fal) NO puede probar barato ni sin gastar: dado
// un `ad_script` sembrado, el executor lee sus `scenes[].narration` (path de PRODUCCIÓN), resuelve el
// triple de voz, y por cada escena invoca la cadena TTS→ASR (HTTP mockeado con msw — CERO red real,
// CERO gasto), persistiendo una generación `tts_audio` con `word_timestamps` sellados y 2 cost_entry.
// Postgres 16 REAL vía Testcontainers; la ÚNICA frontera mockeada es fal (msw), con la forma REAL que
// kokoro/speech-to-text emiten (principio 9 — mismo fixture capturado en vivo que el servicio).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { WordTimestampsSchema, computeWordCoverage } from '@ugc/core/generation';
import { createDbPool, makeLocalStorageAdapter, seedGallery } from '@ugc/db';
import { adBatch, adScript, adVariant, productBrief, project, urlAnalysis } from '@ugc/db/schema';
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
import type { StorageAdapter } from '@ugc/core';

import { makeN7bExecutor } from '../../src/executors/generate-voice';

const TTS_ENDPOINT = 'fal-ai/kokoro';
const ASR_ENDPOINT = 'fal-ai/elevenlabs/speech-to-text';
const noopCollect = (_refs: unknown): void => undefined;

// El output ASR/TTS REAL capturado en vivo (mismos ficheros que los unit de core y el servicio).
const REAL_ASR = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../../packages/core/test/fixtures/fal-asr/kokoro-en-asr.json'),
    'utf8',
  ),
) as Record<string, unknown>;
const REAL_TTS = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../../packages/core/test/fixtures/fal-asr/kokoro-en-tts.json'),
    'utf8',
  ),
) as { audio: { url: string } };
const AUDIO_URL = REAL_TTS.audio.url;
const WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

/** Camino feliz de la cadena con request_id DINÁMICO por submit (N7b hace 2 submits POR ESCENA — TTS
 *  y ASR — y `fal_request_id` es UNIQUE). El submit acuña `<endpoint>-req-<n>`; status/response se
 *  sirven por el id de la ruta. La descarga del audio y el output se sirven por la URL pública. */
function happyChain(): void {
  let counter = 0;
  server.use(
    http.post(`https://queue.fal.run/${TTS_ENDPOINT}`, () => {
      counter += 1;
      const id = `tts-req-${String(counter)}`;
      return HttpResponse.json({
        request_id: id,
        status_url: `https://queue.fal.run/${TTS_ENDPOINT}/requests/${id}/status`,
        response_url: `https://queue.fal.run/${TTS_ENDPOINT}/requests/${id}`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(`https://queue.fal.run/${TTS_ENDPOINT}/requests/:id/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: params.id }),
    ),
    http.get(`https://queue.fal.run/${TTS_ENDPOINT}/requests/:id`, () =>
      HttpResponse.json(REAL_TTS),
    ),
    http.get(AUDIO_URL, () =>
      HttpResponse.arrayBuffer(WAV_BYTES.buffer, { headers: { 'content-type': 'audio/wav' } }),
    ),
    http.post(`https://queue.fal.run/${ASR_ENDPOINT}`, () => {
      counter += 1;
      const id = `asr-req-${String(counter)}`;
      return HttpResponse.json({
        request_id: id,
        status_url: `https://queue.fal.run/${ASR_ENDPOINT}/requests/${id}/status`,
        response_url: `https://queue.fal.run/${ASR_ENDPOINT}/requests/${id}`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(`https://queue.fal.run/${ASR_ENDPOINT}/requests/:id/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: params.id }),
    ),
    http.get(`https://queue.fal.run/${ASR_ENDPOINT}/requests/:id`, () =>
      HttpResponse.json(REAL_ASR),
    ),
  );
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'worker:n7b' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-n7b-'));
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

/** Siembra la cadena project→analysis→brief→batch→variant→script y devuelve el scriptId. `scenes`
 *  lleva el shape REAL de `AdSceneSchema` (el que el executor valida) — DOS escenas con narración. */
async function seedScript(opts?: { language?: string }): Promise<string> {
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
  const language = opts?.language ?? 'en';
  const [script] = await tdb.db
    .insert(adScript)
    .values(
      makeAdScript({
        variantId: variant!.id,
        language,
        scenes: [
          {
            t: 0,
            seconds: 3,
            segment: 'hook',
            narration: 'The future belongs to those who work hard.',
            visual: 'x',
            camera: 'x',
            emotion: 'x',
          },
          {
            t: 3,
            seconds: 2,
            segment: 'body',
            narration: 'Dream big and make it happen.',
            visual: 'y',
            camera: 'y',
            emotion: 'y',
          },
        ],
      }),
    )
    .returning();
  return script!.id;
}

function makeExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN7bExecutor({
    db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    logger: makeTestLogger(),
  });
}

describe('N7b executor (T4.5): voiceover por escena con word timestamps', () => {
  it('sintetiza un audio tts_audio por escena, sella word_timestamps al 100%, con 2 cost_entry cada uno', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyChain();
      const scriptId = await seedScript({ language: 'en' });

      const outputs: unknown[] = [];
      await makeExecutor(db)({
        config: {
          scriptId,
          language: 'en',
          ttsEndpoint: TTS_ENDPOINT,
          provider: 'kokoro',
          voice: 'af_heart',
          speed: 1,
        },
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps: [],
      });

      // DOS generaciones (una por escena), TODAS completed.
      const { rows: gens } = await tdb.pool.query<{ status: string; duration_s: number }>(
        'SELECT status, duration_s FROM generation ORDER BY id',
      );
      expect(gens).toHaveLength(2);
      expect(gens.every((g) => g.status === 'completed')).toBe(true);

      // DOS assets, TODOS kind='tts_audio' (control negativo: NO 'keyframe' — no se reusó el finalizer
      // de imagen), cada uno con word_timestamps sellados y cobertura 100%.
      const { rows: assets } = await tdb.pool.query<{ kind: string; word_timestamps: unknown }>(
        'SELECT kind, word_timestamps FROM asset ORDER BY id',
      );
      expect(assets).toHaveLength(2);
      expect(assets.every((a) => a.kind === 'tts_audio')).toBe(true);
      for (const a of assets) {
        const wt = WordTimestampsSchema.parse(a.word_timestamps);
        expect(computeWordCoverage(wt).fullyCovered).toBe(true);
      }

      // CUATRO cost_entry (2 por escena: TTS chars + ASR seconds), provider='fal'.
      const { rows: costs } = await tdb.pool.query<{ unit: string; provider: string }>(
        'SELECT unit, provider FROM cost_entry ORDER BY unit',
      );
      expect(costs).toHaveLength(4);
      expect(costs.every((c) => c.provider === 'fal')).toBe(true);
      expect(costs.map((c) => c.unit).sort()).toEqual(['chars', 'chars', 'seconds', 'seconds']);

      // El artefacto ligero: scriptId, idioma y 2 clips.
      const out = outputs[0] as { scriptId: string; language: string; clips: unknown[] };
      expect(out.scriptId).toBe(scriptId);
      expect(out.clips).toHaveLength(2);
    } finally {
      await pool.end();
    }
  });

  it('CONTROL NEGATIVO: triple incoherente (kokoro endpoint + provider elevenlabs) → PermanentStepError, sin gastar', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const scriptId = await seedScript();
      await expect(
        makeExecutor(db)({
          config: {
            scriptId,
            language: 'en',
            ttsEndpoint: TTS_ENDPOINT, // kokoro
            provider: 'elevenlabs', // ← mismatch
            voice: 'some-11labs-id',
          },
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

  it('scriptId inexistente → PermanentStepError (no se gasta)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: {
            scriptId: '01JXXXXXXXXXXXXXXXXXXXXXXX',
            language: 'en',
            ttsEndpoint: TTS_ENDPOINT,
            provider: 'kokoro',
            voice: 'af_heart',
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

  it('config inválida (sin scriptId) → PermanentStepError', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: {
            language: 'en',
            ttsEndpoint: TTS_ENDPOINT,
            provider: 'kokoro',
            voice: 'af_heart',
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
