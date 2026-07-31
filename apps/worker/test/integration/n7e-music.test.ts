// Integración del executor N7e · BED MUSICAL IA (T4.9, §7.2 N7e). Ejerce lo que el smoke (que conduce
// el SERVICIO directo) NO cubre: la cáscara del executor — parseo de config, guard de catálogo
// (`kind:'music'` ANTES de gastar), y el output ref del bed. El camino feliz invoca ace-step con fal
// mockeado (msw — CERO red real, CERO gasto). Postgres 16 REAL vía Testcontainers.
//
// CLÁUSULA DETERMINISTA DE LA VERIFICACIÓN (regla de trabajo 8): «bed de 30 s con el mood pedido, coste
// registrado». El coste (0,02¢/s × 30 s → 1¢) y la persistencia (`music_bed` con `duration_s`, UN
// cost_entry por segundo) son deterministas → gate test permanente. El MOOD a oído es juicio humano
// (smoke del verifier). Molde: `n7d-broll.test.ts`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createDbPool, makeLocalStorageAdapter, seedGallery } from '@ugc/db';
import { adBatch, adVariant, asset, productBrief, project, urlAnalysis } from '@ugc/db/schema';
import {
  createTestDatabase,
  http,
  HttpResponse,
  makeAdBatch,
  makeAdVariant,
  makeProductBrief,
  makeProject,
  makeTestLogger,
  makeUrlAnalysis,
  server,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { makeN7eExecutor } from '../../src/executors/generate-music';

const MUSIC_ENDPOINT = 'fal-ai/ace-step';
const noopCollect = (_refs: unknown): void => undefined;

const AUDIO_URL = 'https://v3.fal.media/files/music/bed.mp3';
const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

/** Camino feliz de ace-step con request_id dinámico por submit. Output AUDIO (`{audio:{url}, seed, tags,
 *  lyrics}`). */
function happyMusic(): void {
  let counter = 0;
  server.use(
    http.post(`https://queue.fal.run/${MUSIC_ENDPOINT}`, () => {
      counter += 1;
      const id = `ace-req-${String(counter)}`;
      return HttpResponse.json({
        request_id: id,
        status_url: `https://queue.fal.run/${MUSIC_ENDPOINT}/requests/${id}/status`,
        response_url: `https://queue.fal.run/${MUSIC_ENDPOINT}/requests/${id}`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(`https://queue.fal.run/${MUSIC_ENDPOINT}/requests/:id/status`, ({ params }) =>
      HttpResponse.json({ status: 'COMPLETED', request_id: params.id }),
    ),
    http.get(`https://queue.fal.run/${MUSIC_ENDPOINT}/requests/:id`, () =>
      HttpResponse.json({
        audio: { url: AUDIO_URL, content_type: 'audio/mpeg' },
        seed: 42,
        tags: 'upbeat',
        lyrics: '[inst]',
      }),
    ),
    http.get(AUDIO_URL, () =>
      HttpResponse.arrayBuffer(MP3_BYTES.buffer, { headers: { 'content-type': 'audio/mpeg' } }),
    ),
  );
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'worker:n7e' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-n7e-'));
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
    'TRUNCATE generation, asset, cost_entry, ad_variant, ad_batch, product_brief, url_analysis, project CASCADE',
  );
});

/** Siembra project→url_analysis→brief→batch→variant y devuelve el `variantId`. Lo usan los tests del
 *  efecto de dominio `audio_source='ai_bed'` (T4.11): el executor lo marca cuando corre POR VARIANTE. */
async function seedVariant(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id }))
    .returning();
  const [batch] = await tdb.db
    .insert(adBatch)
    .values(makeAdBatch({ projectId: p!.id, briefId: brief!.id }))
    .returning();
  const [variant] = await tdb.db
    .insert(adVariant)
    .values(makeAdVariant({ batchId: batch!.id }))
    .returning();
  return variant!.id;
}

function makeExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN7eExecutor({
    db,
    storage,
    falKey: () => Promise.resolve('fal-test-key-not-a-secret'),
    logger: makeTestLogger(),
  });
}

describe('N7e executor (T4.9): bed musical IA', () => {
  it('ESPINA: bed de 30 s con el mood pedido → music_bed + cost por segundo, output ref', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyMusic();
      const outputs: unknown[] = [];
      await makeExecutor(db)({
        config: {
          musicEndpoint: MUSIC_ENDPOINT,
          mood: 'upbeat, energetic, commercial',
          durationSeconds: 30,
        },
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps: [],
      });

      // UN asset music_bed de 30 s.
      const { rows: assets } = await tdb.pool.query<{ kind: string; duration_s: number }>(
        "SELECT kind, duration_s FROM asset WHERE kind = 'music_bed'",
      );
      expect(assets).toHaveLength(1);
      expect(assets[0]?.duration_s).toBe(30);

      // 1 generation completed, 1 cost_entry por SEGUNDO.
      const { rows: gens } = await tdb.pool.query<{ status: string; resolved_prompt: string }>(
        'SELECT status, resolved_prompt FROM generation',
      );
      expect(gens).toHaveLength(1);
      expect(gens[0]?.status).toBe('completed');
      expect(gens[0]?.resolved_prompt).toBe('upbeat, energetic, commercial');
      const { rows: costs } = await tdb.pool.query<{ unit: string; amount_cents: number }>(
        'SELECT unit, amount_cents FROM cost_entry',
      );
      expect(costs).toHaveLength(1);
      expect(costs[0]?.unit).toBe('seconds');
      expect(costs[0]?.amount_cents).toBe(1); // 0,02¢/s × 30s = 0,6¢ → 1¢

      const out = outputs[0] as { musicEndpoint: string; mood: string; durationSeconds: number };
      expect(out.musicEndpoint).toBe(MUSIC_ENDPOINT);
      expect(out.mood).toBe('upbeat, energetic, commercial');
      expect(out.durationSeconds).toBe(30);
    } finally {
      await pool.end();
    }
  });

  it('POR VARIANTE (T4.11): tras el bed, la ad_variant tiene audio_source=ai_bed', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const variantId = await seedVariant();
      happyMusic();
      await makeExecutor(db)({
        config: { musicEndpoint: MUSIC_ENDPOINT, mood: 'upbeat', durationSeconds: 30 },
        variantId,
        collectOutput: noopCollect,
        deps: [],
      });
      const { rows } = await tdb.pool.query<{ audio_source: string | null }>(
        'SELECT audio_source FROM ad_variant WHERE id = $1',
        [variantId],
      );
      expect(rows[0]?.audio_source).toBe('ai_bed');
    } finally {
      await pool.end();
    }
  });

  it('T6.2b: si la variante tiene bed PROPIO, N7e NO pisa audio_source=own_license con ai_bed', async () => {
    // Caso de coexistencia (el bed propio se ató DESPUÉS de arrancar el run, con N7e ya encolado): N7e genera
    // igual un bed IA, pero N8 lo IGNORA (el bed propio gana en el ensamblador). La procedencia debe seguir
    // diciendo `own_license` — si N7e la pisara con `ai_bed`, la fila MENTIRÍA sobre el máster (que lleva la
    // música del usuario). Se afirma que audio_source PERMANECE own_license tras correr N7e.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const variantId = await seedVariant();
      // Crear un asset music_bed y atarlo a la variante con audio_source=own_license (lo que hace el endpoint).
      const [bed] = await tdb.db
        .insert(asset)
        .values({
          kind: 'music_bed',
          storageKey: `music/${variantId}.mp3`,
          mime: 'audio/mpeg',
          bytes: 4096,
          checksum: 'f'.repeat(64),
        })
        .returning();
      await tdb.pool.query(
        `UPDATE ad_variant SET own_music_bed_asset_id = $1, audio_source = 'own_license' WHERE id = $2`,
        [bed!.id, variantId],
      );

      happyMusic();
      await makeExecutor(db)({
        config: { musicEndpoint: MUSIC_ENDPOINT, mood: 'upbeat', durationSeconds: 30 },
        variantId,
        collectOutput: noopCollect,
        deps: [],
      });

      const { rows } = await tdb.pool.query<{ audio_source: string | null }>(
        'SELECT audio_source FROM ad_variant WHERE id = $1',
        [variantId],
      );
      // NO pisado: el bed propio manda la procedencia.
      expect(rows[0]?.audio_source).toBe('own_license');
    } finally {
      await pool.end();
    }
  });

  it('CONTROL stepless (sin variantId): NO se marca ninguna variante (la lleva el asset)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const variantId = await seedVariant();
      happyMusic();
      // Sin `variantId` en el contexto (el smoke conduce el servicio sin step/variante).
      await makeExecutor(db)({
        config: { musicEndpoint: MUSIC_ENDPOINT, mood: 'upbeat', durationSeconds: 30 },
        collectOutput: noopCollect,
        deps: [],
      });
      const { rows } = await tdb.pool.query<{ audio_source: string | null }>(
        'SELECT audio_source FROM ad_variant WHERE id = $1',
        [variantId],
      );
      // La variante sembrada queda intacta (audio_source NULL): el executor no la tocó.
      expect(rows[0]?.audio_source).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it('variantId que NO apunta a ninguna fila → PermanentStepError (cableado roto)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyMusic();
      await expect(
        makeExecutor(db)({
          config: { musicEndpoint: MUSIC_ENDPOINT, mood: 'upbeat', durationSeconds: 30 },
          variantId: 'variant-that-does-not-exist',
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });

  it('duration por defecto (30 s) si el config no la trae', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      happyMusic();
      await makeExecutor(db)({
        config: { musicEndpoint: MUSIC_ENDPOINT, mood: 'lofi, chill' },
        collectOutput: noopCollect,
        deps: [],
      });
      const { rows } = await tdb.pool.query<{ duration_s: number }>(
        "SELECT duration_s FROM asset WHERE kind = 'music_bed'",
      );
      expect(rows[0]?.duration_s).toBe(30);
    } finally {
      await pool.end();
    }
  });

  it('GUARD DE CATÁLOGO: endpoint que no es kind music (un TTS) → PermanentStepError, NO gasta', async () => {
    // NO se registran handlers de fal: si intentara llamar, msw reventaría con onUnhandledRequest:'error'.
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: { musicEndpoint: 'fal-ai/kokoro', mood: 'upbeat', durationSeconds: 30 }, // kind 'tts'
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

  it('endpoint inexistente (galería sin ese perfil) → PermanentStepError, NO gasta', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: { musicEndpoint: 'fal-ai/does-not-exist', mood: 'upbeat', durationSeconds: 30 },
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

  it('config inválida (sin mood) → PermanentStepError', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: { musicEndpoint: MUSIC_ENDPOINT, durationSeconds: 30 },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });

  it('config inválida (duration fuera de rango 5–240) → PermanentStepError', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({
          config: { musicEndpoint: MUSIC_ENDPOINT, mood: 'upbeat', durationSeconds: 999 },
          collectOutput: noopCollect,
          deps: [],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });
});
