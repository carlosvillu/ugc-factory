// Verificación instrumentada INDEPENDIENTE de T5.3 (verifier, no el implementer).
// Flujo a través de la producción `composeMaster` (@ugc/services) con inputs sintéticos lavfi.
// Persiste los másters (con bed + sin bed), la rama del bed ducked, y EMITE los números crudos
// de ffmpeg -af ebur128 / astats / ffprobe. Corre DENTRO de la imagen del worker (ffmpeg real).
// NO reimplementa graphs: la medición fluye por composeMaster / buildDuckingGraph de producción.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { newUlid } from '@ugc/core/contracts';
import { buildDuckingGraph, composeMaster } from '@ugc/services';
import { makeMediaTestStorage, makeTestAudio, makeTestVideo } from '@ugc/test-utils/media';

const run = promisify(execFile);
const OUT = process.env.OUT_DIR ?? '/out';
const work = await mkdtemp(join(tmpdir(), 'verify-t53-'));
const p = (n) => join(work, n);

function makeStorageCtx() {
  const storage = makeMediaTestStorage(work);
  const keyToId = new Map();
  const seed = async (localPath, storageKey) => {
    const bytes = new Uint8Array(await readFile(localPath));
    await storage.put(storageKey, bytes, {});
    const id = newUlid();
    keyToId.set(id, storageKey);
    return id;
  };
  const resolveAssetKey = (id) => {
    const k = keyToId.get(id);
    if (k === undefined) throw new Error(`asset no sembrado: ${id}`);
    return k;
  };
  return { storage, seed, resolveAssetKey };
}

async function seg(ctx, i, secs, freq) {
  const v = await makeTestVideo({ out: p(`v-${i}.mp4`), width: 1080, height: 1920, fps: 30, seconds: secs });
  const a = await makeTestAudio({ out: p(`a-${i}.m4a`), seconds: secs, freq });
  const videoAsset = await ctx.seed(v, `v/${i}-${newUlid()}.mp4`);
  const voAudio = await ctx.seed(a, `a/${i}-${newUlid()}.m4a`);
  return { type: i === 0 ? 'hook' : i === 1 ? 'body' : 'cta', videoAsset, voAudio };
}

async function ebur128(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-']);
  const m = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/g)].at(-1);
  return { lufs: m ? Number(m[1]) : null, raw: stderr.split('\n').filter((l) => /Integrated|I:|LUFS|Summary/.test(l)).slice(-8).join('\n') };
}
async function rms(file, from, to) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-ss', String(from), '-to', String(to), '-i', file, '-af', 'astats', '-f', 'null', '-']);
  const m = [...stderr.matchAll(/RMS level dB:\s+(-?\d+(?:\.\d+)?|-?inf)/g)].at(-1);
  const raw = m ? m[1] : null;
  return raw === '-inf' ? -Infinity : raw === null ? null : Number(raw);
}
async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(j.format.duration),
    video: v && { codec: v.codec_name, res: `${v.width}x${v.height}`, fps: v.r_frame_rate, pix: v.pix_fmt, sar: v.sample_aspect_ratio },
    audio: a && { codec: a.codec_name, sr: a.sample_rate, ch: a.channels },
  };
}

const report = {};

// ── CLÁUSULA 1: concat de variante real (3 segmentos 2+3+2=7s) sin re-encode ──
{
  const ctx = makeStorageCtx();
  const segments = [await seg(ctx, 0, 2, 300), await seg(ctx, 1, 3, 360), await seg(ctx, 2, 2, 420)];
  const spec = { segments, music: null, output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 } };
  const { bytes } = await composeMaster({ storage: ctx.storage, resolveAssetKey: ctx.resolveAssetKey }, spec);
  const master = join(OUT, 'master-concat.mp4');
  await writeFile(master, bytes);
  report.concat = { expectedDurationS: 7, probe: await probe(master) };
}

// ── CLÁUSULA 2a: máster con voz + bed → -14 LUFS ±1 ──
{
  const ctx = makeStorageCtx();
  const segments = [await seg(ctx, 0, 3, 440), await seg(ctx, 1, 3, 440), await seg(ctx, 2, 3, 440)];
  const bed = await makeTestAudio({ out: p('bed.m4a'), seconds: 9, freq: 110 });
  const bedAsset = await ctx.seed(bed, `bed/${newUlid()}.m4a`);
  const spec = { segments, music: { asset: bedAsset, volume: 0.25, ducking: true, fadeOutS: 1 }, output: { width: 1080, height: 1920, fps: 30, maxDurationS: 9 } };
  const { bytes } = await composeMaster({ storage: ctx.storage, resolveAssetKey: ctx.resolveAssetKey }, spec);
  const master = join(OUT, 'master-bed.mp4');
  await writeFile(master, bytes);
  report.loudnessWithBed = { ...(await ebur128(master)), probe: await probe(master) };
}

// ── CLÁUSULA 2b: máster sin bed (solo voz) → -14 LUFS ±1 ──
{
  const ctx = makeStorageCtx();
  const segments = [await seg(ctx, 0, 3, 440), await seg(ctx, 1, 3, 440), await seg(ctx, 2, 3, 440)];
  const spec = { segments, music: null, output: { width: 1080, height: 1920, fps: 30, maxDurationS: 9 } };
  const { bytes } = await composeMaster({ storage: ctx.storage, resolveAssetKey: ctx.resolveAssetKey }, spec);
  const master = join(OUT, 'master-novo.mp4');
  await writeFile(master, bytes);
  report.loudnessNoBed = { ...(await ebur128(master)) };
}

// ── CLÁUSULA 3: ducking con buildDuckingGraph de PRODUCCIÓN (rama del bed ducked) ──
{
  const bed = await makeTestAudio({ out: p('d-bed.m4a'), seconds: 4, freq: 220 });
  const voice = await makeTestAudio({ out: p('d-voice.m4a'), seconds: 2, freq: 880, delaySeconds: 2 });
  const graph = buildDuckingGraph({ bedLabel: '0:a', voiceLabel: '1:a', outLabel: 'ducked' });
  const ducked = join(OUT, 'ducked.m4a');
  await run('ffmpeg', ['-y', '-i', bed, '-i', voice, '-filter_complex', graph, '-map', '[ducked]', ducked]);
  const before = await rms(ducked, 0.5, 1.5);
  const during = await rms(ducked, 2.5, 3.5);
  report.ducking = { graph, rmsBefore: before, rmsDuring: during, dropDb: before - during };
}

console.log(JSON.stringify(report, null, 2));
