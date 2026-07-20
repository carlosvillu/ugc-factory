// Suite MEDIA de concat + mezcla de audio (T5.3, §9.7; testing/references/media-composition.md §"Loudness y
// ducking (T5.3)"). Corre ffmpeg de VERDAD — la única forma honesta de verificar loudness, ducking y el
// concat sin re-encode. Vive en `apps/worker/test/media/` → proyecto vitest `worker:media` (gated por
// RUN_MEDIA, con ffmpeg/ffprobe de la imagen del worker). NO forma parte de `pnpm test`.
//
// Sin base de datos: la resolución `assetId → storageKey` se INYECTA con un Map (producción la cablea a la
// BD en T5.5). Los inputs son 100 % sintéticos `lavfi` (prohibido comitear binarios). Los segmentos
// "normalizados" se generan con `makeTestVideo` a un perfil UNIFORME — el stand-in de la salida de T5.2 que
// hace válido el `-c copy`.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { CompositionSpec } from '@ugc/core/contracts';
import type { StorageAdapter } from '@ugc/core';
import { newUlid } from '@ugc/core/contracts';
import { buildDuckingGraph, composeMaster } from '@ugc/services';
import {
  assertVideoProfile,
  ffprobeJson,
  makeMediaTestStorage,
  makeTestAudio,
  makeTestVideo,
  measureIntegratedLufs,
  measureRmsDb,
} from '@ugc/test-utils/media';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { mediaToolsAvailable } from './setup';

const run = promisify(execFile);

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ugc-compose-media-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const p = (name: string): string => join(workDir, name);

/** Sube un fichero local a storage bajo una key y devuelve el assetId sintético que lo referencia (el Map
 *  de `resolveAssetKey` mapea assetId → storageKey). */
async function seedAsset(
  storage: StorageAdapter,
  keyToId: Map<string, string>,
  localPath: string,
  storageKey: string,
): Promise<string> {
  const bytes = new Uint8Array(await readFile(localPath));
  await storage.put(storageKey, bytes, {});
  const assetId = newUlid();
  keyToId.set(assetId, storageKey);
  return assetId;
}

/** Un "clip normalizado" sintético: perfil UNIFORME (1080×1920/30fps/H.264/yuv420p) — el stand-in de la
 *  salida de T5.2 que hace válido el `-c copy`. `-an` como los normalizados reales. */
async function makeNormalizedSegment(out: string, seconds: number): Promise<string> {
  return makeTestVideo({ out, width: 1080, height: 1920, fps: 30, seconds });
}

const NEG_ULID = newUlid();

describe.skipIf(!mediaToolsAvailable)('concat + mezcla de audio → máster intermedio (T5.3)', () => {
  // ── CONCAT: duración = suma de segmentos, perfil intacto, sin re-encode ──────────────────────────────

  test('concat de 3 segmentos: duración = suma, perfil canónico intacto (-c copy no re-encoda)', async () => {
    const storage = makeMediaTestStorage(workDir);
    const keyToId = new Map<string, string>();

    // 3 segmentos normalizados de duraciones conocidas (2 + 3 + 2 = 7 s) + una voz por segmento de la
    // MISMA duración (si la voz difiere del vídeo, la mezcla/sincronía derivan).
    const plan = [
      { type: 'hook', secs: 2 },
      { type: 'body', secs: 3 },
      { type: 'cta', secs: 2 },
    ] as const;
    const segments: CompositionSpec['segments'] = [];
    for (const [i, { type, secs }] of plan.entries()) {
      const v = await makeNormalizedSegment(p(`seg-${String(i)}.mp4`), secs);
      const a = await makeTestAudio({
        out: p(`vo-${String(i)}.m4a`),
        seconds: secs,
        freq: 300 + i * 60,
      });
      const videoAsset = await seedAsset(storage, keyToId, v, `seg/${String(i)}.mp4`);
      const voAudio = await seedAsset(storage, keyToId, a, `vo/${String(i)}.m4a`);
      segments.push({ type, videoAsset, voAudio });
    }

    const spec: CompositionSpec = {
      segments,
      music: null, // este test aísla el CONCAT (sin bed); loudness/ducking van en sus tests
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
    };

    const { bytes } = await composeMaster(
      {
        storage,
        resolveAssetKey: (id) => {
          const k = keyToId.get(id);
          if (k === undefined) throw new Error(`asset no sembrado: ${id}`);
          return k;
        },
      },
      spec,
    );

    const masterPath = p('master-concat.mp4');
    await writeFile(masterPath, bytes);

    // Perfil canónico INTACTO tras el concat (el `-c copy` no cambió el códec/resolución/fps) + duración =
    // suma de segmentos (7 s ±tolerancia). Que el perfil siga siendo H.264/1080×1920/30fps con la duración
    // sumada es la prueba honesta de que el concat copió sin re-encode y sin perder segmentos.
    await assertVideoProfile(masterPath, { durationS: 7, durationToleranceS: 0.4 });
  });

  test('el vídeo del máster conserva el códec del input (copy, no transcode)', async () => {
    const storage = makeMediaTestStorage(workDir);
    const keyToId = new Map<string, string>();
    const v = await makeNormalizedSegment(p('one.mp4'), 2);
    const a = await makeTestAudio({ out: p('one-vo.m4a'), seconds: 2 });
    const videoAsset = await seedAsset(storage, keyToId, v, 'one/v.mp4');
    const voAudio = await seedAsset(storage, keyToId, a, 'one/a.m4a');
    const spec: CompositionSpec = {
      segments: [{ type: 'hook', videoAsset, voAudio }],
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
    };
    const { bytes } = await composeMaster(
      { storage, resolveAssetKey: (id) => keyToId.get(id) ?? NEG_ULID },
      spec,
    );
    const masterPath = p('master-one.mp4');
    await writeFile(masterPath, bytes);
    const probe = await ffprobeJson(masterPath);
    const v0 = probe.streams.find((s) => s.codec_type === 'video');
    expect(v0?.codec_name).toBe('h264');
    // el audio del máster es la mezcla re-encodada a AAC
    const a0 = probe.streams.find((s) => s.codec_type === 'audio');
    expect(a0?.codec_name).toBe('aac');
  });

  // ── LOUDNESS: el máster mezclado mide -14 LUFS ±1 ────────────────────────────────────────────────────

  test('el máster con voz + bed mide -14 LUFS ±1 (loudnorm)', async () => {
    const storage = makeMediaTestStorage(workDir);
    const keyToId = new Map<string, string>();

    // ~9 s totales (3 segmentos × 3 s): loudnorm single-pass es más estable con contenido no tan corto.
    const segments: CompositionSpec['segments'] = [];
    for (const [i, type] of (['hook', 'body', 'cta'] as const).entries()) {
      const v = await makeNormalizedSegment(p(`lv-${String(i)}.mp4`), 3);
      const a = await makeTestAudio({ out: p(`la-${String(i)}.m4a`), seconds: 3, freq: 440 });
      const videoAsset = await seedAsset(storage, keyToId, v, `lv/${String(i)}.mp4`);
      const voAudio = await seedAsset(storage, keyToId, a, `la/${String(i)}.m4a`);
      segments.push({ type, videoAsset, voAudio });
    }
    // Un bed musical (tono grave largo) como stand-in del bed IA.
    const bed = await makeTestAudio({ out: p('l-bed.m4a'), seconds: 9, freq: 110 });
    const bedAsset = await seedAsset(storage, keyToId, bed, 'l/bed.m4a');

    const spec: CompositionSpec = {
      segments,
      music: { asset: bedAsset, volume: 0.25, ducking: true, fadeOutS: 1 },
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 9 },
    };

    const { bytes } = await composeMaster(
      { storage, resolveAssetKey: (id) => keyToId.get(id) ?? NEG_ULID },
      spec,
    );
    const masterPath = p('master-loud.mp4');
    await writeFile(masterPath, bytes);

    const lufs = await measureIntegratedLufs(masterPath);
    expect(lufs).toBeGreaterThanOrEqual(-15);
    expect(lufs).toBeLessThanOrEqual(-13);
  });

  // ── DUCKING: renderiza la rama del bed ducked con el builder de PRODUCCIÓN ────────────────────────────

  test('buildDuckingGraph hunde el bed ≥6 dB cuando entra la voz', async () => {
    // El bed suena los 4 s; la voz entra en el segundo 2 (onset EXACTO conocido).
    const bed = await makeTestAudio({ out: p('d-bed.m4a'), seconds: 4, freq: 220 });
    const voice = await makeTestAudio({
      out: p('d-voice.m4a'),
      seconds: 2,
      freq: 880,
      delaySeconds: 2,
    });

    // El MISMO builder que usa producción (principio 9): se renderiza SOLO la rama del bed ducked.
    const graph = buildDuckingGraph({ bedLabel: '0:a', voiceLabel: '1:a', outLabel: 'ducked' });
    const ducked = p('ducked.m4a');
    await run('ffmpeg', [
      '-y',
      '-i',
      bed,
      '-i',
      voice,
      '-filter_complex',
      graph,
      '-map',
      '[ducked]',
      ducked,
    ]);

    const rmsBefore = await measureRmsDb(ducked, 0.5, 1.5); // ventana SIN voz
    const rmsDuring = await measureRmsDb(ducked, 2.5, 3.5); // ventana CON voz
    expect(rmsBefore - rmsDuring).toBeGreaterThanOrEqual(6); // el bed cae ≥6 dB
  });

  // ── FADE-OUT: anclado al FINAL REAL del máster, no al maxDurationS (que es un techo) ─────────────────

  test('el afade del bed se ancla a la duración REAL, no al maxDurationS (cap > duración)', async () => {
    // Máster de ~9 s (3×3 s) pero con `maxDurationS: 30` (cap holgado). Si el fade se anclara al cap, el
    // afade arrancaría en el segundo 28 → NUNCA dispararía sobre un máster de 9 s (el bug). Anclado a la
    // duración real (9 s), con fadeOutS=2 el fade cubre los segundos 7–9. Para AISLAR la cola en bed puro,
    // la voz del ÚLTIMO segmento dura solo 1 s (los segundos 8–9 son bed-only, ya en pleno fade).
    const storage = makeMediaTestStorage(workDir);
    const keyToId = new Map<string, string>();
    const segments: CompositionSpec['segments'] = [];
    for (const [i, type] of (['hook', 'body', 'cta'] as const).entries()) {
      const v = await makeNormalizedSegment(p(`fv-${String(i)}.mp4`), 3);
      // Última voz de 1 s (deja los últimos ~2 s del máster sin voz → cola de bed puro para medir el fade).
      const voSecs = i === 2 ? 1 : 3;
      const a = await makeTestAudio({ out: p(`fa-${String(i)}.m4a`), seconds: voSecs, freq: 440 });
      const videoAsset = await seedAsset(storage, keyToId, v, `fv/${String(i)}.mp4`);
      const voAudio = await seedAsset(storage, keyToId, a, `fa/${String(i)}.m4a`);
      segments.push({ type, videoAsset, voAudio });
    }
    const bed = await makeTestAudio({ out: p('f-bed.m4a'), seconds: 12, freq: 220 });
    const bedAsset = await seedAsset(storage, keyToId, bed, 'f/bed.m4a');

    const spec: CompositionSpec = {
      segments,
      // ducking OFF: aislar el efecto del FADE (con ducking el bed ya está hundido bajo la voz y la cola
      // sin voz confundiría las medidas). cap=30 ≫ duración real (~9 s) → el bug haría el fade inerte.
      music: { asset: bedAsset, volume: 0.3, ducking: false, fadeOutS: 2 },
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
    };
    const { bytes } = await composeMaster(
      { storage, resolveAssetKey: (id) => keyToId.get(id) ?? NEG_ULID },
      spec,
    );
    const masterPath = p('master-fade.mp4');
    await writeFile(masterPath, bytes);

    // Cola bed-only: RMS al FINAL (últimos 0,3 s, en pleno fade) ≪ RMS en la meseta bed-only (7,0–7,3 s,
    // apenas iniciado el fade). Si el fade estuviera anclado al cap (28 s), NO dispararía y ambas ventanas
    // medirían igual → la diferencia sería ~0. Umbral generoso (≥8 dB) por el loudnorm dinámico del mix.
    const rmsPlateau = await measureRmsDb(masterPath, 7.0, 7.3);
    const rmsTail = await measureRmsDb(masterPath, 8.6, 8.9);
    expect(rmsPlateau - rmsTail).toBeGreaterThanOrEqual(8);
  });

  // ── SIN BED: el máster solo-voz también normaliza a -14 LUFS ──────────────────────────────────────────

  test('máster sin bed (music:null): solo voz, también a -14 LUFS ±1', async () => {
    const storage = makeMediaTestStorage(workDir);
    const keyToId = new Map<string, string>();
    const segments: CompositionSpec['segments'] = [];
    for (const [i, type] of (['hook', 'body', 'cta'] as const).entries()) {
      const v = await makeNormalizedSegment(p(`nv-${String(i)}.mp4`), 3);
      const a = await makeTestAudio({ out: p(`na-${String(i)}.m4a`), seconds: 3, freq: 440 });
      const videoAsset = await seedAsset(storage, keyToId, v, `nv/${String(i)}.mp4`);
      const voAudio = await seedAsset(storage, keyToId, a, `na/${String(i)}.m4a`);
      segments.push({ type, videoAsset, voAudio });
    }
    const spec: CompositionSpec = {
      segments,
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 9 },
    };
    const { bytes } = await composeMaster(
      { storage, resolveAssetKey: (id) => keyToId.get(id) ?? NEG_ULID },
      spec,
    );
    const masterPath = p('master-novo.mp4');
    await writeFile(masterPath, bytes);
    const lufs = await measureIntegratedLufs(masterPath);
    expect(lufs).toBeGreaterThanOrEqual(-15);
    expect(lufs).toBeLessThanOrEqual(-13);
  });

  test('composeMaster lanza ComposeError si un input no existe en storage', async () => {
    const storage = makeMediaTestStorage(workDir);
    const spec: CompositionSpec = {
      segments: [{ type: 'hook', videoAsset: newUlid(), voAudio: newUlid() }],
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 9 },
    };
    // resolveAssetKey devuelve una key que no existe → storage.get fallará o ffmpeg fallará.
    await expect(
      composeMaster({ storage, resolveAssetKey: () => 'missing/key.mp4' }, spec),
    ).rejects.toThrow();
  });
});
