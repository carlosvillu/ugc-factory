// Cadena de la Verificación de T4.9 (regla de trabajo 8): el servicio de BED MUSICAL IA invoca ace-step
// (HTTP mockeado con msw — CERO red real, cero gasto) y persiste:
//  · `generation` submitting→submitted→completed, con las URLs TAL CUAL fal las devuelve;
//  · el audio del output descargado a NUESTRO storage como `asset` kind='music_bed' con `duration_s`;
//  · UN `cost_entry` provider='fal' unit='seconds' (una llamada = un cargo, por SEGUNDO del bed).
//
// CLAVE DE MÚSICA vs B-ROLL: mismo molde (UNA llamada, duración = INPUT no output, UN cost_entry por
// segundo, payload por BYPASS), pero AUDIO-family — ace-step devuelve `{audio:{url}, seed, tags, lyrics}`
// (verificado 2026-07-17 vs fal openapi), NO `{video:{url}}`. El bed es INSTRUMENTAL (`lyrics:"[inst]"`)
// y el mood viaja como `tags`. Molde: `generate-broll.test.ts`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getAsset,
  getGeneration,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
  seedGallery,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runGenerateMusic } from '../../src/generate-music';

const MUSIC_ENDPOINT = 'fal-ai/ace-step';

const AUDIO_URL = 'https://v3.fal.media/files/music/bed.mp3';
const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04]); // "ID3" tag mínimo

/** Registra el camino feliz de ace-step + captura el body del submit. El output es AUDIO
 *  (`{audio:{url}, seed, tags, lyrics}`): la duración del bed = el input enviado, no un campo del output. */
function happyMusic(reqSuffix: string): {
  getSubmitBody: () => Record<string, unknown> | undefined;
} {
  const req = `ACE-${reqSuffix}`;
  const status = `https://queue.fal.run/${MUSIC_ENDPOINT}/requests/${req}/status`;
  const response = `https://queue.fal.run/${MUSIC_ENDPOINT}/requests/${req}`;
  let submitBody: Record<string, unknown> | undefined;
  server.use(
    http.post(`https://queue.fal.run/${MUSIC_ENDPOINT}`, async ({ request }) => {
      submitBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        request_id: req,
        status_url: status,
        response_url: response,
        status: 'IN_QUEUE',
      });
    }),
    http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
    // Output de ace-step: `{audio:{url}, seed, tags, lyrics}` (NO `{video}` ni `{images}`).
    http.get(response, () =>
      HttpResponse.json({
        audio: { url: AUDIO_URL, content_type: 'audio/mpeg' },
        seed: 42,
        tags: 'upbeat, energetic',
        lyrics: '[inst]',
      }),
    ),
    http.get(AUDIO_URL, () =>
      HttpResponse.arrayBuffer(MP3_BYTES.buffer, { headers: { 'content-type': 'audio/mpeg' } }),
    ),
  );
  return { getSubmitBody: () => submitBody };
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let musicProfile: ModelProfile;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-music' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-music-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const music = await getModelProfileByEndpoint(tdb.db, MUSIC_ENDPOINT);
  if (music === undefined) throw new Error('perfil de música (ace-step) no sembrado');
  musicProfile = music;
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

function deps() {
  return {
    db: tdb.db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    sleep: () => Promise.resolve(),
    falOptions: { pollIntervalMs: 0 },
  };
}

describe('runGenerateMusic — bed musical IA (Verificación T4.9)', () => {
  it('mood → tags + duration input + lyrics [inst]; music_bed + cost por segundo', async () => {
    const { getSubmitBody } = happyMusic('happy');

    const res = await runGenerateMusic(deps(), {
      musicModelProfileId: musicProfile.id,
      mood: 'upbeat, energetic, commercial',
      durationSeconds: 30,
    });

    // PAYLOAD ace-step (bypass): tags (el MOOD) + duration (los segundos pedidos, NÚMERO no string) +
    // lyrics "[inst]" (instrumental). NO campos de vídeo/imagen.
    const body = getSubmitBody();
    expect(body?.tags).toBe('upbeat, energetic, commercial');
    expect(body?.duration).toBe(30);
    expect(body?.lyrics).toBe('[inst]');
    expect(body).not.toHaveProperty('image_url');
    expect(body).not.toHaveProperty('video');

    const gen = await getGeneration(tdb.db, res.generation.id);
    expect(gen?.status).toBe('completed');
    // Duración = el input ENVIADO (el output no re-cuantiza), NO otro número.
    expect(gen?.durationS).toBeCloseTo(30, 3);
    // El mood es el resolved_prompt (entrada semántica del bed).
    expect(gen?.resolvedPrompt).toBe('upbeat, energetic, commercial');

    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('music_bed');
    expect(asset?.mime).toBe('audio/mpeg');
    expect(asset?.durationS).toBeCloseTo(30, 3);
    const bytes = await new Response(await storage.get(asset!.storageKey)).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(MP3_BYTES);

    // Coste 0,02¢/s × 30 s = 0,6¢ → 1¢. UN cost_entry, unit='seconds', quantity=30 (los segundos enteros).
    expect(res.costCents).toBe(1);
    const costs = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.generationId, res.generation.id),
    });
    expect(costs).toHaveLength(1);
    expect(costs[0]?.unit).toBe('seconds');
    expect(costs[0]?.amountCents).toBe(1);
    expect(costs[0]?.quantity).toBe(30);
  });

  it('lyrics explícitas (jingle cantado): pasan tal cual al payload, NO se fuerza [inst]', async () => {
    const { getSubmitBody } = happyMusic('lyrics');
    await runGenerateMusic(deps(), {
      musicModelProfileId: musicProfile.id,
      mood: 'pop, catchy',
      durationSeconds: 15,
      lyrics: 'Buy our product now',
    });
    const body = getSubmitBody();
    expect(body?.lyrics).toBe('Buy our product now');
    expect(body?.duration).toBe(15);
  });

  it('CONTROL NEGATIVO: kind incorrecto (no-music) → falla ANTES de gastar (no submit)', async () => {
    // Un perfil que NO es de música (aquí un TTS) no debe generar un bed: fallo honesto ANTES de llamar.
    // NO se registra ningún handler de fal: si intentara llamar, msw reventaría (onUnhandledRequest:'error').
    const tts = await getModelProfileByEndpoint(tdb.db, 'fal-ai/kokoro');
    if (tts === undefined) throw new Error('perfil TTS no sembrado');
    const res = await runGenerateMusic(deps(), {
      musicModelProfileId: tts.id,
      mood: 'upbeat',
      durationSeconds: 30,
    }).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(Error);
    expect((res as Error).message).toMatch(/no un modelo de música/);
  });

  it('CONTROL NEGATIVO: output SIN audio → falla, generation `failed`, sin asset music_bed', async () => {
    const req = 'ACE-noaudio';
    const status = `https://queue.fal.run/${MUSIC_ENDPOINT}/requests/${req}/status`;
    const response = `https://queue.fal.run/${MUSIC_ENDPOINT}/requests/${req}`;
    server.use(
      http.post(`https://queue.fal.run/${MUSIC_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: req,
          status_url: status,
          response_url: response,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
      // Output SIN `audio` (p. ej. el finalizer de imagen se equivocó de modelo): FalResponseError.
      http.get(response, () => HttpResponse.json({ images: [{ url: 'https://x/y.png' }] })),
    );

    const res = await runGenerateMusic(deps(), {
      musicModelProfileId: musicProfile.id,
      mood: 'lofi, chill',
      durationSeconds: 30,
    }).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(Error);
    expect((res as Error).message).toMatch(/no trae audio/);

    const gens = await tdb.db.query.generation.findMany({
      where: (g, { eq }) => eq(g.modelProfileId, musicProfile.id),
    });
    const failed = gens.find((g) => g.status === 'failed');
    expect(failed).toBeDefined();
    const assets = await tdb.db.query.asset.findMany({
      where: (a, { eq }) => eq(a.generationId, failed!.id),
    });
    expect(assets).toHaveLength(0);
  });

  it('el catch de degradación NO enmascara la causa raíz: si el UPDATE de failed falla, sale el error de FAL', async () => {
    // Lección T1.8 (como broll/avatar): el catch marca `failed` en una tx; si ESA tx lanza (BD caída), su
    // error NO debe enterrar el `err` original de fal. Se fuerza AMBOS: (1) fal devuelve un output sin
    // audio → FalResponseError; (2) la tx de degradación del catch rechaza. El error que SALE debe ser el
    // de fal (contiene "no trae audio"), no el de la tx ("degrade boom").
    const req = 'ACE-maskcause';
    const status = `https://queue.fal.run/${MUSIC_ENDPOINT}/requests/${req}/status`;
    const response = `https://queue.fal.run/${MUSIC_ENDPOINT}/requests/${req}`;
    server.use(
      http.post(`https://queue.fal.run/${MUSIC_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: req,
          status_url: status,
          response_url: response,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(status, () => HttpResponse.json({ status: 'COMPLETED', request_id: req })),
      http.get(response, () => HttpResponse.json({ images: [{ url: 'https://x/y.png' }] })),
    );

    // db envuelto: delega todo al real EXCEPTO `transaction`, que rechaza (simula BD caída en el catch).
    // La tx de liquidación del happy path NUNCA se alcanza aquí (extractAudioOutput lanza antes), así que
    // el ÚNICO uso de `transaction` es la degradación del catch → este proxy solo afecta a esa ruta.
    const brokenTxDb = new Proxy(tdb.db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return () => Promise.reject(new Error('degrade boom (BD caída simulada)'));
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const err = await runGenerateMusic(
      { ...deps(), db: brokenTxDb },
      {
        musicModelProfileId: musicProfile.id,
        mood: 'ambient',
        durationSeconds: 30,
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('no trae audio');
    expect((err as Error).message).not.toContain('degrade boom');
  });
});
