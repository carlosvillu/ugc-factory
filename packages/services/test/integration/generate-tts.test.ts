// Preview de voz TTS-only cacheado (T4.6, §8.3): `runTtsOnly` sintetiza UNA muestra (sin ASR) y la
// cachea por `content_hash` scoped a `voice_preview=true`. La Entrega y la Verificación:
//  · botón ▶ reproduce una muestra → `runTtsOnly` genera un asset `tts_audio` + UN solo `cost_entry`
//    (chars, sin ASR — un preview no necesita timestamps);
//  · reproducirla N veces NO añade coste → la 2ª..N llamada hace CACHE-HIT (0 llamadas fal, 0
//    `cost_entry`, `cached:true`), comprobado contando el ledger antes/después.
//
// CERO red real (msw): los payloads TTS son el output REAL capturado en vivo de T4.5. El ASR NO se
// registra en msw a propósito — si `runTtsOnly` intentara encadenarlo, `onUnhandledRequest:'error'`
// haría fallar el test (prueba estructural de que el preview NO llama al ASR).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getSpendSummary,
  getModelProfileByEndpoint,
  listGenerationsByStatus,
  makeLocalStorageAdapter,
  seedGallery,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runTtsOnly, voiceSampleText } from '../../src/generate-audio';

const KOKORO_ENDPOINT = 'fal-ai/kokoro';

const REAL_TTS = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../core/test/fixtures/fal-asr/kokoro-en-tts.json'),
    'utf8',
  ),
) as { audio: { url: string } };
const AUDIO_URL = REAL_TTS.audio.url;
const WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

/** Registra SOLO el TTS (submit+poll+download) — NADA de ASR. Un contador de submits del TTS deja
 *  ver que la 2ª reproducción (cache-hit) NO vuelve a llamar a fal. */
function ttsOnly(reqSuffix: string): { ttsSubmits: () => number } {
  let submits = 0;
  const ttsReq = `TTS-${reqSuffix}`;
  const ttsStatus = `https://queue.fal.run/${KOKORO_ENDPOINT}/requests/${ttsReq}/status`;
  const ttsResponse = `https://queue.fal.run/${KOKORO_ENDPOINT}/requests/${ttsReq}`;
  server.use(
    http.post(`https://queue.fal.run/${KOKORO_ENDPOINT}`, () => {
      submits += 1;
      return HttpResponse.json({
        request_id: ttsReq,
        status_url: ttsStatus,
        response_url: ttsResponse,
        cancel_url: `${ttsResponse}/cancel`,
        status: 'IN_QUEUE',
      });
    }),
    http.get(ttsStatus, () => HttpResponse.json({ status: 'COMPLETED', request_id: ttsReq })),
    http.get(ttsResponse, () => HttpResponse.json(REAL_TTS)),
    http.get(AUDIO_URL, () =>
      HttpResponse.arrayBuffer(WAV_BYTES.buffer, { headers: { 'content-type': 'audio/wav' } }),
    ),
  );
  return { ttsSubmits: () => submits };
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let kokoroProfile: ModelProfile;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-tts' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-tts-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const kokoro = await getModelProfileByEndpoint(tdb.db, KOKORO_ENDPOINT);
  if (kokoro === undefined) throw new Error('perfil kokoro no sembrado');
  kokoroProfile = kokoro;
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
    // Key PEREZOSA (T4.6): `runTtsOnly` la resuelve solo en el cache-miss.
    falKey: () => Promise.resolve('fal-test-key-not-a-secret'),
    sleep: () => Promise.resolve(),
    falOptions: { pollIntervalMs: 0 },
  };
}

/** Cuenta las filas `cost_entry` de fal del mes en curso (el ledger de `/spend` agrega por aquí). */
async function falEntryCount(): Promise<number> {
  const summary = await getSpendSummary(tdb.db);
  const fal = summary.byProvider.find((p) => p.provider === 'fal');
  return fal?.entries ?? 0;
}

describe('runTtsOnly — preview de voz TTS-only cacheado (Verificación T4.6)', () => {
  it('genera un asset tts_audio y UN solo cost_entry de fal (sin ASR)', async () => {
    const probe = ttsOnly('gen-en');
    const before = await falEntryCount();

    const res = await runTtsOnly(deps(), {
      ttsProfile: kokoroProfile,
      ttsInputs: { voice: 'af_heart' },
      language: 'en',
    });

    expect(res.cached).toBe(false);
    expect(res.assetId).toBeTruthy();
    // UNA sola llamada al TTS, CERO al ASR (el ASR no está en msw: si se llamara, el test fallaría).
    expect(probe.ttsSubmits()).toBe(1);
    // EXACTAMENTE un cost_entry nuevo (el del TTS por chars) — no dos como el voiceover de producción.
    expect(await falEntryCount()).toBe(before + 1);
  });

  it('reproducir la misma muestra N veces NO añade coste (cache-hit: 0 fal, 0 cost_entry)', async () => {
    // Primera reproducción: genera y cachea.
    const probe = ttsOnly('cache-es');
    const first = await runTtsOnly(deps(), {
      ttsProfile: kokoroProfile,
      ttsInputs: { voice: 'af_bella' },
      language: 'es',
    });
    expect(first.cached).toBe(false);
    expect(probe.ttsSubmits()).toBe(1);

    const afterFirst = await falEntryCount();

    // Reproducciones 2..5: MISMA voz+idioma → mismo content_hash → CACHE-HIT. NO tocan fal ni el
    // ledger. Este es el corazón de la Verificación ("5 reproducciones no añaden coste").
    for (let i = 0; i < 4; i += 1) {
      const replay = await runTtsOnly(deps(), {
        ttsProfile: kokoroProfile,
        ttsInputs: { voice: 'af_bella' },
        language: 'es',
      });
      expect(replay.cached).toBe(true);
      expect(replay.costCents).toBe(0);
      expect(replay.assetId).toBe(first.assetId); // el MISMO asset, no uno nuevo
    }

    // NI una llamada más al TTS, NI un cost_entry más tras las 4 reproducciones extra.
    expect(probe.ttsSubmits()).toBe(1);
    expect(await falEntryCount()).toBe(afterFirst);

    // Y una sola generación `completed` para esa muestra (no 5).
    const completed = await listGenerationsByStatus(tdb.db, 'completed');
    const sameSample = completed.filter(
      (g) => g.voicePreview && g.resolvedPrompt === voiceSampleText('es'),
    );
    expect(sameSample).toHaveLength(1);
  });
});
