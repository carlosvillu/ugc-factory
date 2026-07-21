// VERIFIER independent media test for T5.5b (NOT the implementer's).
// Drives the REAL fitSegmentFile (product code) via @ugc/services, with MY OWN durations
// (so a fixture hardcoded to the implementer's 5.0/3.4/3.2/3.5/3.0 would NOT satisfy me),
// and adds the honesty checks the implementer's suite is missing:
//   (a) TRIM-AT-END: not merely duration≈target, but that the START of the clip is PRESERVED
//       (a -ss trim cutting the start would also hit the duration). Frame-sampling discriminant.
//   (b) HOLD: frozen tail + not-black + the held frame IS the LAST source frame (not just any frozen).
//   (c) ERROR: FitError thrown AND no output artifact written (runner never ran).
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { FitError, fitSegmentFile } from '@ugc/services';
import { ffprobeJson, makeTestVideo } from '@ugc/test-utils/media';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { mediaToolsAvailable } from './setup';

const run = promisify(execFile);
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ugc-fit-verify-'));
});
afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const p = (name: string): string => join(workDir, name);

async function durationOf(file: string): Promise<number> {
  const probe = await ffprobeJson(file);
  return Number(probe.format.duration);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const W = 1080;
const H = 1920;

async function frameAt(file: string, atS: number): Promise<Buffer> {
  const rawPath = p(`f-${String(atS)}-${String(Math.random()).slice(2, 8)}.rgb`);
  await run('ffmpeg', [
    '-y',
    '-i',
    file,
    '-ss',
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
  expect(buf.byteLength).toBe(W * H * 3);
  return buf;
}

function meanLuma(buf: Buffer): number {
  let s = 0;
  for (let i = 0; i < buf.byteLength; i++) s += buf[i] ?? 0;
  return s / buf.byteLength;
}

function meanAbsDiff(a: Buffer, b: Buffer): number {
  let s = 0;
  for (let i = 0; i < a.byteLength; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s / a.byteLength;
}

describe.skipIf(!mediaToolsAvailable)('VERIFIER — segment fitter T5.5b (independent)', () => {
  // (a) TRIM: my durations 6.0s clip → narration 2.7s. Sale ≈2.7s Y el ARRANQUE se preserva.
  test('(a) clip 6.0s + narration 2.7s → exactly 2.7s AND start preserved (trim al final)', async () => {
    const clip = await makeTestVideo({ out: p('a-clip.mp4'), seconds: 6, fps: 30 });
    const out = p('a-out.mp4');
    const res = await fitSegmentFile({}, { inPath: clip, outPath: out, narrationDurationS: 2.7 });
    expect(res.plan.kind).toBe('trim');

    const d = await durationOf(out);
    expect(Math.abs(d - 2.7)).toBeLessThanOrEqual(0.1);

    // DECISIVE: the frame at t=0.5 in the OUTPUT equals the frame at t=0.5 in the SOURCE.
    // A -ss trim (keeping the LAST 2.7s) would show source@3.8s at output t=0.5 → MAD large.
    const outStart = await frameAt(out, 0.5);
    const srcStart = await frameAt(clip, 0.5);
    const srcLateWhereSsWouldLand = await frameAt(clip, 3.8); // 6.0-2.7+0.5
    const madStart = meanAbsDiff(outStart, srcStart);
    const madCounter = meanAbsDiff(outStart, srcLateWhereSsWouldLand);
    // eslint-disable-next-line no-console
    console.log(
      `[VERIFY a] dur=${d.toFixed(3)} MAD(out@0.5,src@0.5)=${madStart.toFixed(3)} MAD(out@0.5,src@3.8)=${madCounter.toFixed(3)}`,
    );
    expect(madStart).toBeLessThan(2); // start preserved
    expect(madCounter).toBeGreaterThan(3); // clip really moves → the ≈0 above is nontrivial
  });

  // (b) HOLD: my durations 4.0s clip → narration 4.25s (deficit 0.25 < 0.5).
  test('(b) clip 4.0s + narration 4.25s (deficit 0.25) → 4.25s, tail = held LAST frame', async () => {
    const clip = await makeTestVideo({ out: p('b-clip.mp4'), seconds: 4, fps: 30 });
    const out = p('b-out.mp4');
    const res = await fitSegmentFile({}, { inPath: clip, outPath: out, narrationDurationS: 4.25 });
    expect(res.plan.kind).toBe('hold');

    const d = await durationOf(out);
    expect(Math.abs(d - 4.25)).toBeLessThanOrEqual(0.1);

    // Two frames inside the tail (clip ends ~4.0s; tail 4.0–4.25s) + a moving frame.
    const t1 = await frameAt(out, 4.1);
    const t2 = await frameAt(out, 4.2);
    const moving = await frameAt(out, 1.0);
    // The held tail should equal the LAST real source frame (~3.97s), not merely be frozen.
    const srcLast = await frameAt(clip, 3.95);
    const tailPair = meanAbsDiff(t1, t2);
    const tailVsMoving = meanAbsDiff(moving, t2);
    const tailVsSrcLast = meanAbsDiff(t2, srcLast);
    // eslint-disable-next-line no-console
    console.log(
      `[VERIFY b] dur=${d.toFixed(3)} MAD(tail1,tail2)=${tailPair.toFixed(3)} MAD(moving,tail)=${tailVsMoving.toFixed(3)} MAD(tail,srcLast)=${tailVsSrcLast.toFixed(3)} luma(tail)=${meanLuma(t1).toFixed(2)}`,
    );
    expect(tailPair).toBeLessThan(2); // tail frozen
    expect(tailVsMoving).toBeGreaterThan(3); // clip moved, tail did not (freeze real, not no-op)
    expect(meanLuma(t1)).toBeGreaterThan(20); // not black (not stop_mode=add)
    expect(tailVsSrcLast).toBeLessThan(2); // the held frame IS the last source frame
  });

  // (c) ERROR: my durations 4.0s clip → narration 4.8s (deficit 0.8 ≥ 0.5).
  test('(c) clip 4.0s + narration 4.8s (deficit 0.8) → FitError AND no output written', async () => {
    const clip = await makeTestVideo({ out: p('c-clip.mp4'), seconds: 4, fps: 30 });
    const out = p('c-out.mp4');
    await expect(
      fitSegmentFile({}, { inPath: clip, outPath: out, narrationDurationS: 4.8 }),
    ).rejects.toThrow(FitError);
    // File-system evidence the runner never ran: no artifact produced.
    expect(await fileExists(out)).toBe(false);
  });
});
