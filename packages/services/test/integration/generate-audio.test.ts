// Cadena COMPLETA de la Verificación de T4.5 (regla de trabajo 8): el servicio de generación de AUDIO
// encadena DOS llamadas fal (TTS → ASR, HTTP mockeado con msw — CERO red real, cero gasto) y persiste:
//  · `generation` TTS submitting→submitted→completed, con las URLs TAL CUAL fal las devuelve;
//  · el .wav del output descargado a NUESTRO storage como `asset` kind='tts_audio';
//  · los `word_timestamps` del ASR SELLADOS sobre ESE mismo asset (el ASR no es asset propio);
//  · DOS `cost_entry` provider='fal' (TTS por chars + ASR por minutos — anti-doble-cobro);
//  · cobertura del 100% de las palabras (un ASR con una palabra sin tiempo → falla, control negativo).
//
// Los payloads de los mocks son el output ASR/TTS REAL capturado en vivo (fixtures fal-asr/): el arnés
// nunca más cómodo que la realidad (principio 9 testing) — el doble emite lo que emite el productor.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createAsset,
  getAsset,
  getGeneration,
  getModelProfileByEndpoint,
  getSpendSummary,
  listGenerationsByStatus,
  makeLocalStorageAdapter,
  seedGallery,
  updateGeneration,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import {
  WordTimestampsSchema,
  computeWordCoverage,
  type WordTimestamps,
} from '@ugc/core/generation';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runGenerateAudio } from '../../src/generate-audio';

const TTS_ENDPOINT = 'fal-ai/kokoro';
const ELEVEN_ENDPOINT = 'fal-ai/elevenlabs/tts/turbo-v2.5';
const ASR_ENDPOINT = 'fal-ai/elevenlabs/speech-to-text';

// El output ASR/TTS REAL capturado en vivo (mismos ficheros que los unit de core).
const REAL_ASR = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../core/test/fixtures/fal-asr/kokoro-en-asr.json'),
    'utf8',
  ),
) as WordTimestamps;
const REAL_TTS = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../core/test/fixtures/fal-asr/kokoro-en-tts.json'),
    'utf8',
  ),
) as { audio: { url: string } };

const AUDIO_URL = REAL_TTS.audio.url;
// Un .wav mínimo (bytes válidos): el StorageAdapter calcula bytes+checksum sobre esto.
const WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

/** Registra el camino feliz de la CADENA: submit+poll del TTS, descarga del .wav, submit+poll del ASR.
 *  Cada llamada usa un request_id CANARIO propio (las URLs de status/response se derivan de él y msw
 *  las atiende exactas — un cliente que reconstruyera la URL reventaría con onUnhandledRequest:'error'). */
function happyChain(reqSuffix: string): void {
  const ttsReq = `TTS-${reqSuffix}`;
  const asrReq = `ASR-${reqSuffix}`;
  const ttsStatus = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}/status`;
  const ttsResponse = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}`;
  const asrStatus = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}/status`;
  const asrResponse = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}`;
  server.use(
    // TTS
    http.post(`https://queue.fal.run/${TTS_ENDPOINT}`, () =>
      HttpResponse.json({
        request_id: ttsReq,
        status_url: ttsStatus,
        response_url: ttsResponse,
        cancel_url: `${ttsResponse}/cancel`,
        status: 'IN_QUEUE',
      }),
    ),
    http.get(ttsStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: ttsReq })),
    http.get(ttsResponse, () => HttpResponse.json(REAL_TTS)),
    // Descarga del audio (URL pública que el TTS emitió)
    http.get(AUDIO_URL, () =>
      HttpResponse.arrayBuffer(WAV_BYTES.buffer, { headers: { 'content-type': 'audio/wav' } }),
    ),
    // ASR
    http.post(`https://queue.fal.run/${ASR_ENDPOINT}`, () =>
      HttpResponse.json({
        request_id: asrReq,
        status_url: asrStatus,
        response_url: asrResponse,
        cancel_url: `${asrResponse}/cancel`,
        status: 'IN_QUEUE',
      }),
    ),
    http.get(asrStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: asrReq })),
    http.get(asrResponse, () => HttpResponse.json(REAL_ASR)),
  );
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let ttsProfile: ModelProfile;
let elevenProfile: ModelProfile;
let asrProfile: ModelProfile;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-audio' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-audio-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const tts = await getModelProfileByEndpoint(tdb.db, TTS_ENDPOINT);
  const eleven = await getModelProfileByEndpoint(tdb.db, ELEVEN_ENDPOINT);
  const asr = await getModelProfileByEndpoint(tdb.db, ASR_ENDPOINT);
  if (tts === undefined || eleven === undefined || asr === undefined)
    throw new Error('perfiles TTS/ASR no sembrados');
  ttsProfile = tts;
  elevenProfile = eleven;
  asrProfile = asr;
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

describe('runGenerateAudio — cadena TTS→ASR end-to-end (Verificación T4.5)', () => {
  it('CONTROL: el TTS de ELEVENLABS recibe la narración en `text`, NO en `prompt` (por-proveedor)', async () => {
    // Verificado en vivo (2026-07-16): kokoro usa `prompt`, elevenlabs usa `text`. Mandar `prompt` a
    // elevenlabs sintetizaría su default (voz "Rachel" leyendo texto vacío) y quemaría dinero sin la
    // narración. Este test captura el BODY del submit a la ruta de elevenlabs y exige `text` con la
    // narración y NADA en `prompt`. Reintroducir el hardcode `prompt` haría este assert caer (control
    // negativo del bug que el camino solo-inglés no manifestaba).
    const narration = 'El futuro pertenece a quienes trabajan duro.';
    let ttsBody: Record<string, unknown> | undefined;
    const ttsReq = 'ELEVEN-textfield';
    const asrReq = 'ASR-textfield';
    const ttsStatus = `https://queue.fal.run/${ELEVEN_ENDPOINT}/requests/${ttsReq}/status`;
    const ttsResponse = `https://queue.fal.run/${ELEVEN_ENDPOINT}/requests/${ttsReq}`;
    const asrStatus = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}/status`;
    const asrResponse = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}`;
    server.use(
      http.post(`https://queue.fal.run/${ELEVEN_ENDPOINT}`, async ({ request }) => {
        ttsBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          request_id: ttsReq,
          status_url: ttsStatus,
          response_url: ttsResponse,
          status: 'IN_QUEUE',
        });
      }),
      http.get(ttsStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: ttsReq })),
      // elevenlabs devuelve mp3 (verificado en vivo): mismo shape {audio:{url,content_type}}.
      http.get(ttsResponse, () =>
        HttpResponse.json({ audio: { url: AUDIO_URL, content_type: 'audio/mpeg' } }),
      ),
      http.get(AUDIO_URL, () =>
        HttpResponse.arrayBuffer(WAV_BYTES.buffer, { headers: { 'content-type': 'audio/mpeg' } }),
      ),
      http.post(`https://queue.fal.run/${ASR_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: asrReq,
          status_url: asrStatus,
          response_url: asrResponse,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(asrStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: asrReq })),
      http.get(asrResponse, () => HttpResponse.json(REAL_ASR)),
    );

    const res = await runGenerateAudio(deps(), {
      ttsModelProfileId: elevenProfile.id,
      asrModelProfileId: asrProfile.id,
      narration,
      ttsInputs: { voice: 'Rachel' },
      asrLanguageCode: 'spa',
    });
    expect(res.generation.status).toBe('completed');
    // El body del submit a elevenlabs lleva la narración en `text`, NUNCA en `prompt`.
    expect(ttsBody?.text).toBe(narration);
    expect(ttsBody).not.toHaveProperty('prompt');
    // El asset del mp3 quedó como tts_audio (extension mp3 por el content_type).
    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('tts_audio');
    expect(asset?.mime).toBe('audio/mpeg');
  });

  it('genera voiceover: asset tts_audio con word_timestamps sellados + 2 cost_entry', async () => {
    happyChain('happy');
    const before = (await getSpendSummary(tdb.db)).totalCents;

    const res = await runGenerateAudio(deps(), {
      ttsModelProfileId: ttsProfile.id,
      asrModelProfileId: asrProfile.id,
      narration: 'The future belongs to those who work hard and dream big.',
      ttsInputs: { voice: 'af_heart', speed: 1 },
      asrLanguageCode: 'eng',
    });

    // La generación TTS quedó completed.
    const gen = await getGeneration(tdb.db, res.generation.id);
    expect(gen?.status).toBe('completed');
    expect(gen?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // duration_s derivada del ASR (último end = 3.179).
    expect(gen?.durationS).toBeCloseTo(3.179, 3);

    // El asset es AUDIO (kind='tts_audio'), NO 'keyframe' — la barrera contra reusar el finalizer de
    // imagen. Los bytes del .wav están en NUESTRO storage.
    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('tts_audio');
    expect(asset?.generationId).toBe(res.generation.id);
    expect(asset?.durationS).toBeCloseTo(3.179, 3);
    const bytes = await new Response(await storage.get(asset!.storageKey)).arrayBuffer();
    expect(new Uint8Array(bytes)).toEqual(WAV_BYTES);

    // WORD TIMESTAMPS sellados sobre ESE asset (el ASR no es asset propio). Válidos y cobertura 100%.
    const wt = WordTimestampsSchema.parse(asset?.wordTimestamps);
    const cov = computeWordCoverage(wt);
    expect(cov.fullyCovered).toBe(true);
    expect(cov.wordCount).toBe(11);
    expect(res.wordCount).toBe(11);

    // DOS cost_entry (anti-doble-cobro): TTS (chars) + ASR (minutos). Con el clip corto ambos redondean
    // a 0¢ (55 chars, 3,2 s), pero son DOS filas distinguibles por unit. Se comprueba que el servicio
    // reporta ambas unidades de coste distintas.
    expect(res.ttsCostCents).toBe(0); // 56 chars a 2¢/1k → 0¢
    expect(res.asrCostCents).toBe(0); // 3,179 s a 3¢/min → 0¢
    // Los importes de este clip son 0¢, así que el total no cambia; la existencia de las 2 filas se
    // afirma en el test de un clip más largo abajo (donde los importes son > 0).
    expect((await getSpendSummary(tdb.db)).totalCents).toBe(before);
  });

  it('las DOS cost_entry existen y son distinguibles por unit (chars vs minutes)', async () => {
    // Narración LARGA para que los importes salgan > 0 y las dos filas sean observables en el ledger.
    // ~1500 chars → TTS 3¢; el ASR de este mock reporta 3.179 s (el fixture) → 0¢, pero su fila existe.
    happyChain('twocost');
    const narration = 'palabra '.repeat(200).trim(); // 1599 chars
    const res = await runGenerateAudio(deps(), {
      ttsModelProfileId: ttsProfile.id,
      asrModelProfileId: asrProfile.id,
      narration,
      ttsInputs: { voice: 'af_heart' },
    });
    // TTS: 1599 chars a 2¢/1k = round(3.198) = 3¢.
    expect(res.ttsCostCents).toBe(3);

    // Consulta directa del ledger: DOS filas para esta generación, con units 'chars' (TTS) y
    // 'seconds' (ASR — `quantity` es INTEGER, así que la duración se guarda en segundos enteros).
    const rows = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.generationId, res.generation.id),
    });
    expect(rows).toHaveLength(2);
    const units = rows.map((r) => r.unit).sort();
    expect(units).toEqual(['chars', 'seconds']);
    const chars = rows.find((r) => r.unit === 'chars');
    expect(chars?.amountCents).toBe(3);
    expect(chars?.provider).toBe('fal');
  });

  it('BUG#2/#3: si otra ruta ya llevó la fila a `completed`, la liquidación NO la voltea a `failed` (no-op gracioso)', async () => {
    // Simula el mundo concurrente de T4.11 (webhook+poll+sweeper): mientras esta llamada corre el ASR,
    // OTRA ruta finaliza la MISMA generación (marca `completed` + crea su asset). Cuando la liquidación
    // de ESTA llamada re-chequea `completed` bajo el lock, DEBE hacer no-op gracioso (devolver el asset
    // ajeno), NUNCA lanzar — un throw caería en el catch y VOLTEARÍA a `failed` una fila legítimamente
    // `completed` (con su asset + sus cost_entries). Reintroducir el `throw` en la rama alreadyFinalized
    // (o el `failed` incondicional del catch) haría que este test cayera: la fila terminaría `failed`.
    const narration = 'concurrent-finalize-narration';
    const ttsReq = 'TTS-concurrent';
    const asrReq = 'ASR-concurrent';
    const ttsStatus = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}/status`;
    const ttsResponse = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}`;
    const asrStatus = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}/status`;
    const asrResponse = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}`;
    server.use(
      http.post(`https://queue.fal.run/${TTS_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: ttsReq,
          status_url: ttsStatus,
          response_url: ttsResponse,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(ttsStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: ttsReq })),
      http.get(ttsResponse, () => HttpResponse.json(REAL_TTS)),
      http.get(AUDIO_URL, () =>
        HttpResponse.arrayBuffer(WAV_BYTES.buffer, { headers: { 'content-type': 'audio/wav' } }),
      ),
      http.post(`https://queue.fal.run/${ASR_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: asrReq,
          status_url: asrStatus,
          response_url: asrResponse,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(asrStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: asrReq })),
      // Al leer el resultado del ASR (JUSTO antes de la liquidación), OTRA ruta finaliza la fila: la
      // marca `completed` y le crea su asset tts_audio. Cuando la tx de liquidación de esta llamada
      // adquiera el lock, verá `completed` → no-op gracioso.
      http.get(asrResponse, async () => {
        const [gen] = await tdb.db.query.generation.findMany({
          where: (g, { eq }) => eq(g.resolvedPrompt, narration),
        });
        if (gen) {
          const put = await storage.put(`generations/${gen.id}/concurrent.wav`, WAV_BYTES, {
            mime: 'audio/wav',
          });
          await createAsset(tdb.db, {
            kind: 'tts_audio',
            storageKey: `generations/${gen.id}/concurrent.wav`,
            mime: 'audio/wav',
            bytes: put.bytes,
            checksum: put.checksum,
            durationS: 3.179,
            generationId: gen.id,
          });
          await updateGeneration(tdb.db, gen.id, { status: 'completed', completedAt: new Date() });
        }
        return HttpResponse.json(REAL_ASR);
      }),
    );

    const res = await runGenerateAudio(deps(), {
      ttsModelProfileId: ttsProfile.id,
      asrModelProfileId: asrProfile.id,
      narration,
      ttsInputs: { voice: 'af_heart' },
    });

    // La fila sigue `completed` (NO volteada a failed): el no-op gracioso respetó el estado ajeno.
    expect(res.generation.status).toBe('completed');
    const gen = await getGeneration(tdb.db, res.generation.id);
    expect(gen?.status).toBe('completed');
    // El servicio devolvió el asset de la ruta ganadora (no re-creó uno) → assetId resuelve a una fila.
    const asset = await getAsset(tdb.db, res.assetId);
    expect(asset?.kind).toBe('tts_audio');
  });

  it('CONTROL NEGATIVO: ASR con una palabra SIN tiempo → falla, generation `failed`, sin sellar', async () => {
    // Un output ASR con una `word` sin start/end viola la cobertura 100%. El servicio DEBE lanzar y
    // dejar la generación `failed` (nunca completed con timestamps a medias). Reintroducir "aceptar
    // cobertura parcial" haría que este test cayera.
    const ttsReq = 'TTS-partial';
    const asrReq = 'ASR-partial';
    const ttsStatus = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}/status`;
    const ttsResponse = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}`;
    const asrStatus = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}/status`;
    const asrResponse = `https://queue.fal.run/${ASR_ENDPOINT}/requests/${asrReq}`;
    const narration = `${'palabra '.repeat(200).trim()} hola mundo`; // >1k chars → TTS 3¢ observable
    const PARTIAL_ASR = {
      text: 'hola mundo',
      words: [
        { text: 'hola', start: 0, end: 0.4, type: 'word', speaker_id: null },
        { text: 'mundo', start: null, end: null, type: 'word', speaker_id: null }, // SIN tiempo
      ],
    };
    server.use(
      http.post(`https://queue.fal.run/${TTS_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: ttsReq,
          status_url: ttsStatus,
          response_url: ttsResponse,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(ttsStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: ttsReq })),
      http.get(ttsResponse, () => HttpResponse.json(REAL_TTS)),
      http.get(AUDIO_URL, () =>
        HttpResponse.arrayBuffer(WAV_BYTES.buffer, { headers: { 'content-type': 'audio/wav' } }),
      ),
      http.post(`https://queue.fal.run/${ASR_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: asrReq,
          status_url: asrStatus,
          response_url: asrResponse,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(asrStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: asrReq })),
      http.get(asrResponse, () => HttpResponse.json(PARTIAL_ASR)),
    );

    await expect(
      runGenerateAudio(deps(), {
        ttsModelProfileId: ttsProfile.id,
        asrModelProfileId: asrProfile.id,
        narration,
        ttsInputs: { voice: 'ef_dora' },
      }),
    ).rejects.toThrow(/cobertura/i);

    // La generación quedó `failed` (nunca completed), sin asset sellado.
    const gens = await tdb.db.query.generation.findMany({
      where: (g, { eq }) => eq(g.resolvedPrompt, narration),
    });
    expect(gens[0]?.status).toBe('failed');
    // Pero el gasto del TTS (facturado antes del ASR) SIGUE registrado: cobertura fallida no borra el
    // dinero ya gastado. Una fila de coste (TTS chars), NO la del ASR (nunca se selló).
    const costs = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.generationId, gens[0]!.id),
    });
    expect(costs).toHaveLength(1);
    expect(costs[0]?.unit).toBe('chars');
  });

  it('BUG#1: el ASR FALLA tras un TTS exitoso → cost_entry del TTS EXISTE y la generación es `failed`', async () => {
    // El fallo más real de la cadena: el TTS se facturó y descargó, pero la 2ª llamada (ASR) revienta
    // (500). El gasto del TTS es DINERO YA HECHO → su cost_entry DEBE persistir (record-first, no atado
    // al éxito de la cadena). Y la generación NO puede quedar `completed` (no hay timestamps → no es un
    // deliverable usable): queda `failed`, honesta, con el gasto del TTS visible en /spend.
    // CONTROL NEGATIVO de este test: si se revierte el fix (mover el recordCost del TTS de vuelta a la
    // tx final), el ASR-500 aborta esa tx → el cost_entry del TTS NO se escribe → este assert cae ROJO.
    const narration = `asrfail ${'palabra '.repeat(200).trim()}`; // >1k chars, único → TTS 3¢ observable
    const ttsReq = 'TTS-asrfail';
    const ttsStatus = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}/status`;
    const ttsResponse = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}`;
    server.use(
      http.post(`https://queue.fal.run/${TTS_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: ttsReq,
          status_url: ttsStatus,
          response_url: ttsResponse,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(ttsStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: ttsReq })),
      http.get(ttsResponse, () => HttpResponse.json(REAL_TTS)),
      http.get(AUDIO_URL, () =>
        HttpResponse.arrayBuffer(WAV_BYTES.buffer, { headers: { 'content-type': 'audio/wav' } }),
      ),
      // El submit del ASR revienta con 500 (fal caído / rate limit agotado): la cadena no puede seguir.
      http.post(
        `https://queue.fal.run/${ASR_ENDPOINT}`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );

    const res = await runGenerateAudio(deps(), {
      ttsModelProfileId: ttsProfile.id,
      asrModelProfileId: asrProfile.id,
      narration,
      ttsInputs: { voice: 'af_heart' },
    }).catch((e: unknown) => e);
    expect(res).toBeInstanceOf(Error);

    // La generación de ESTE test (por su resolved_prompt único) quedó `failed`, NUNCA `completed`.
    const gens = await tdb.db.query.generation.findMany({
      where: (g, { eq }) => eq(g.resolvedPrompt, narration),
    });
    expect(gens).toHaveLength(1);
    expect(gens[0]?.status).toBe('failed');

    // Y su cost_entry del TTS EXISTE (gasto YA hecho, visible), con unit='chars' y amount 3¢. NO hay
    // fila del ASR (nunca se llegó a facturar). Es la señal de que el TTS se registró record-first.
    const costs = await tdb.db.query.costEntry.findMany({
      where: (c, { eq }) => eq(c.generationId, gens[0]!.id),
    });
    expect(costs).toHaveLength(1);
    expect(costs[0]?.unit).toBe('chars');
    expect(costs[0]?.amountCents).toBe(3);
    expect(costs[0]?.provider).toBe('fal');
    // No se selló ningún asset (la liquidación nunca corrió).
    const assets = await tdb.db.query.asset.findMany({
      where: (a, { eq }) => eq(a.generationId, gens[0]!.id),
    });
    expect(assets).toHaveLength(0);
  });

  it('CONTROL NEGATIVO: output TTS SIN audio (images[] por error) → falla, sin ASR ni asset', async () => {
    // Si el TTS devolviera un output de imagen (contrato equivocado), el servicio DEBE lanzar en la
    // validación de audio — NO seguir a la descarga/ASR. Es la barrera que impide reusar el finalizer
    // de imagen: `extractAudioOutput({images:[...]})` es null.
    const ttsReq = 'TTS-noaudio';
    const ttsStatus = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}/status`;
    const ttsResponse = `https://queue.fal.run/${TTS_ENDPOINT}/requests/${ttsReq}`;
    server.use(
      http.post(`https://queue.fal.run/${TTS_ENDPOINT}`, () =>
        HttpResponse.json({
          request_id: ttsReq,
          status_url: ttsStatus,
          response_url: ttsResponse,
          status: 'IN_QUEUE',
        }),
      ),
      http.get(ttsStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: ttsReq })),
      http.get(ttsResponse, () => HttpResponse.json({ images: [{ url: 'https://x/y.png' }] })),
    );
    await expect(
      runGenerateAudio(deps(), {
        ttsModelProfileId: ttsProfile.id,
        asrModelProfileId: asrProfile.id,
        narration: 'sin audio',
        ttsInputs: { voice: 'af_heart' },
      }),
    ).rejects.toThrow(/no trae audio/i);
    const failed = await listGenerationsByStatus(tdb.db, 'failed');
    expect(failed.some((g) => g.resolvedPrompt === 'sin audio')).toBe(true);
  });
});
