// Suite MEDIA del segment fitter (T5.5b, §9.7 N8 l.288; testing/references/media-composition.md §"Entorno").
// Corre ffmpeg de VERDAD — la única forma honesta de verificar el recorte EXACTO a la narración y el hold
// del último frame (frames IDÉNTICOS, no relleno negro). Vive en `apps/worker/test/media/` → proyecto
// vitest `worker:media` (gated por RUN_MEDIA, con ffmpeg/ffprobe de la imagen del worker). NO forma parte
// de `pnpm test`.
//
// El fitter es PATHS-ONLY (file-in/file-out): no toca storage. Los inputs son 100 % sintéticos `lavfi`
// (prohibido comitear binarios). Se usa `testsrc2` (MOVIMIENTO) —no color sólido— para el caso hold: solo
// con movimiento un frame CLONADO se distingue de un relleno negro o de una re-decodificación del clip.
//
// Los 3 casos de la Verificación de T5.5b:
//   (a) clip 5,0 s + narración 3,4 s → sale EXACTAMENTE 3,4 s (ffprobe, trim al final).
//   (b) clip 3,2 s + narración 3,5 s (déficit 0,3 <0,5) → sale 3,5 s, los últimos 0,3 s son el ÚLTIMO
//       frame holdeado (frames idénticos entre sí y NO negros — muestreo de píxeles).
//   (c) déficit ≥0,5 s → LANZA FitError (no tapa un desajuste grosero de generación).
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { FitError, fitSegmentFile } from '@ugc/services';
import { ffprobeJson, makeTestVideo, makeTestVideoWithVoice } from '@ugc/test-utils/media';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { mediaToolsAvailable } from './setup';

const run = promisify(execFile);

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ugc-fit-media-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const p = (name: string): string => join(workDir, name);

/** Mide la duración (segundos) de un fichero con ffprobe (formato). */
async function durationOf(file: string): Promise<number> {
  const probe = await ffprobeJson(file);
  return Number(probe.format.duration);
}

/** Extrae UN frame en el instante `atS` a un raw RGB24 y devuelve sus bytes. `size` es WxH del clip
 *  (por defecto el sintético 1080×1920). Se usa para comparar frames del hold (idénticos ⟺ clonados). */
async function frameAt(file: string, atS: number, width = 1080, height = 1920): Promise<Buffer> {
  const rawPath = p(`frame-${String(atS)}-${String(Math.random()).slice(2, 8)}.rgb`);
  await run('ffmpeg', [
    '-y',
    '-i',
    file,
    '-ss', // seek de SALIDA (tras `-i`): frame-accurate (el seek de entrada es solo keyframe-accurate).
    atS.toFixed(3),
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    rawPath,
  ]);
  const buf = await readFile(rawPath);
  // Sanidad: un frame RGB24 de WxH pesa W*H*3 bytes.
  expect(buf.byteLength).toBe(width * height * 3);
  return buf;
}

/** La media del canal (0..255) sobre el frame — para descartar que un frame sea NEGRO (media ~0). */
function meanLuma(buf: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buf.byteLength; i++) {
    sum += buf[i] ?? 0;
  }
  return sum / buf.byteLength;
}

/** Diferencia media absoluta por byte entre dos frames RGB (0..255). ~0 ⟺ frames visualmente IGUALES (la
 *  cola congelada del hold), grande ⟺ frames distintos (contenido en movimiento). No se exige igualdad de
 *  BYTES: dos frames distintos de una región congelada H.264 (B-frames, QP variable) no son byte-idénticos
 *  aunque sean el MISMO frame fuente — el discriminante honesto de «congelado» es la MAGNITUD de la
 *  diferencia, no la igualdad exacta. */
function meanAbsDiff(a: Buffer, b: Buffer): number {
  let s = 0;
  for (let i = 0; i < a.byteLength; i++) {
    s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  }
  return s / a.byteLength;
}

describe.skipIf(!mediaToolsAvailable)('segment fitter — recorte + hold (T5.5b)', () => {
  // ── (a) TRIM: clip 5,0 s + narración 3,4 s → sale EXACTAMENTE 3,4 s ──────────────────────────────────
  test('(a) clip 5,0 s con narración 3,4 s → sale exactamente 3,4 s (trim al final)', async () => {
    const clip = await makeTestVideo({ out: p('a-clip.mp4'), seconds: 5, fps: 30 });
    const out = p('a-out.mp4');
    const res = await fitSegmentFile({}, { inPath: clip, outPath: out, narrationDurationS: 3.4 });

    expect(res.plan.kind).toBe('trim');
    const d = await durationOf(out);
    // Recorte EXACTO a la narración. Tolerancia estrecha (±0,1 s): el re-encode alinea a frame, pero un
    // `-c copy` (keyframe) desviaría MUCHO más — esto es justo lo que el re-encode compra.
    expect(Math.abs(d - 3.4)).toBeLessThanOrEqual(0.1);
  });

  // ── (b) HOLD: clip 3,2 s + narración 3,5 s (déficit 0,3 <0,5) → 3,5 s con último frame holdeado ──────
  test('(b) clip 3,2 s con narración 3,5 s (déficit 0,3) → 3,5 s, últimos 0,3 s = último frame holdeado', async () => {
    // `testsrc2` = MOVIMIENTO: sin él, un frame clonado no se distingue de un relleno negro ni de una
    // re-decodificación. El clip mide ~3,2 s (déficit ~0,3 s → hold).
    const clip = await makeTestVideo({ out: p('b-clip.mp4'), seconds: 3.2, fps: 30 });
    const out = p('b-out.mp4');
    const res = await fitSegmentFile({}, { inPath: clip, outPath: out, narrationDurationS: 3.5 });

    expect(res.plan.kind).toBe('hold');
    const d = await durationOf(out);
    expect(Math.abs(d - 3.5)).toBeLessThanOrEqual(0.1);

    // Dos frames DENTRO de la cola holdeada (el clip acaba ~3,2 s; la cola es 3,2–3,5 s) + un frame de la
    // región EN MOVIMIENTO del clip original (1,0 s). El control se apoya en la MAGNITUD de la diferencia:
    //   · los dos frames de la cola son ~iguales (MAD≈0) → la cola está CONGELADA (el último frame clonado).
    //   · el frame en movimiento difiere MUCHO de la cola (MAD grande) → el clip TENÍA movimiento, así que
    //     una cola congelada es una propiedad NO trivial (un black-pad o un fitter no-op fallarían este par).
    const f1 = await frameAt(out, 3.3);
    const f2 = await frameAt(out, 3.45);
    const moving = await frameAt(out, 1.0);
    // MAD entre dos frames de la cola ≈ 0 (frozen). Umbral <2 (no 0: H.264 lossy no reconstruye byte a
    // byte, pero dos frames del MISMO frame fuente difieren ~0,003 de media — medido en la imagen).
    expect(meanAbsDiff(f1, f2)).toBeLessThan(2);
    // El frame en movimiento difiere de la cola → el clip se movía y la cola NO (freeze real). El
    // `testsrc2` cambia de forma sutil en RGB (MAD medida ~5,6 entre 1,0 s y la cola); umbral >3 separa
    // limpiamente ese movimiento real del ruido ~0,003 de dos frames congelados — un black-pad o un fitter
    // no-op (que dejaría movimiento en la cola) NO superarían este par (cola≈moving ⇒ tailPair grande).
    expect(meanAbsDiff(moving, f2)).toBeGreaterThan(3);
    // Y NO negro (un `tpad=stop_mode=add` rellenaría con negro y la duración cuadraría igual — este assert
    // distingue clone de black-pad). Un frame de `testsrc2` tiene luma media claramente >0.
    expect(meanLuma(f1)).toBeGreaterThan(20);
  });

  // ── (c) DÉFICIT GROSERO ≥0,5 s → LANZA (no tapa el desajuste) ─────────────────────────────────────────
  test('(c) déficit >0,5 s (clip 3,0 s, narración 3,7 s) → lanza FitError, no tapa el desajuste', async () => {
    const clip = await makeTestVideo({ out: p('c-clip.mp4'), seconds: 3.0, fps: 30 });
    const out = p('c-out.mp4');
    // Margen claro (0,7 s) para no rozar el boundary con ruido de medición de ffprobe (el boundary exacto
    // 0,5 lo prueba el unit test del gate sobre `planFit`, sin ruido).
    await expect(
      fitSegmentFile({}, { inPath: clip, outPath: out, narrationDurationS: 3.7 }),
    ).rejects.toThrow(FitError);
  });

  // ── El audio embebido se PRESERVA (VEED lleva voz que T5.2 extrae aguas abajo) ───────────────────────
  test('el trim preserva la pista de audio del clip (no la descarta con -an)', async () => {
    // Un clip con audio embebido (vídeo en movimiento + tono), como un avatar VEED.
    const clip = await makeTestVideoWithVoice({
      out: p('d-clip.mp4'),
      width: 1080,
      height: 1920,
      fps: 30,
      seconds: 5,
    });
    const out = p('d-out.mp4');
    await fitSegmentFile({}, { inPath: clip, outPath: out, narrationDurationS: 3.4 });
    const probe = await ffprobeJson(out);
    const hasAudio = probe.streams.some((s) => s.codec_type === 'audio');
    expect(hasAudio).toBe(true);
  });
});
