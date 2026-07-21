// Unit tests de la lógica PURA del segment fitter (T5.5b): `planFit` (decisión trim/hold/error), los args
// de `buildFitArgs`, y el CONTROL NEGATIVO del wrapper (déficit ≥0,5 s → lanza `FitError` SIN llegar a
// ffmpeg). Corren en el gate (services:unit, SIN ffmpeg): la aritmética del déficit y el throw son
// deterministas y gratuitos → viven como tests permanentes (regla de trabajo 8). El COMPORTAMIENTO real
// (recorte exacto por ffprobe, hold del último frame con frames idénticos) vive en la suite media
// (`apps/worker/test/media/fit-segment.test.ts`, con ffmpeg de la imagen del worker).
import { describe, expect, test, vi } from 'vitest';

import type { FfmpegRunner, FfprobeRunner } from './extract-audio-track';
import { buildFitArgs, fitSegmentFile, FitError, MAX_HOLD_DEFICIT_S, planFit } from './fit-segment';

/** Un ffprobe FAKE que devuelve `seconds` como duración (stdout = el número, exit 0). */
function fakeFfprobe(seconds: number): FfprobeRunner {
  return () => Promise.resolve({ code: 0, stdout: `${String(seconds)}\n`, stderr: '' });
}

describe('planFit (decisión PURA trim/hold/error)', () => {
  test('clip MÁS LARGO que la narración → trim al target de la narración', () => {
    expect(planFit({ clipDurationS: 5.0, narrationDurationS: 3.4 })).toEqual({
      kind: 'trim',
      targetS: 3.4,
    });
  });

  test('clip = narración → trim (no hay déficit)', () => {
    expect(planFit({ clipDurationS: 3.5, narrationDurationS: 3.5 })).toEqual({
      kind: 'trim',
      targetS: 3.5,
    });
  });

  test('déficit <0,5 s → hold del último frame por el déficit', () => {
    const plan = planFit({ clipDurationS: 3.2, narrationDurationS: 3.5 });
    expect(plan.kind).toBe('hold');
    if (plan.kind !== 'hold') throw new Error('esperado hold');
    expect(plan.deficitS).toBeCloseTo(0.3, 6);
    expect(plan.targetS).toBe(3.5);
  });

  // ── BOUNDARY del umbral: la frontera exacta 0,5 s decide hold vs error ────────────────────────────────
  test('déficit 0,49 s (<0,5) → hold', () => {
    const plan = planFit({ clipDurationS: 3.01, narrationDurationS: 3.5 });
    expect(plan.kind).toBe('hold');
  });

  test('déficit 0,50 s (=0,5, NO <0,5) → error (el umbral es estricto: ≥0,5 lanza)', () => {
    const plan = planFit({ clipDurationS: 3.0, narrationDurationS: 3.5 });
    expect(plan.kind).toBe('error');
    if (plan.kind !== 'error') throw new Error('esperado error');
    expect(plan.deficitS).toBeCloseTo(0.5, 6);
  });

  test('déficit GRANDE (0,7 s) → error', () => {
    expect(planFit({ clipDurationS: 3.0, narrationDurationS: 3.7 }).kind).toBe('error');
  });

  test('MAX_HOLD_DEFICIT_S es 0,5 s (§9.7 l.288)', () => {
    expect(MAX_HOLD_DEFICIT_S).toBe(0.5);
  });
});

describe('buildFitArgs (builder PURO de args de ffmpeg)', () => {
  test('trim: `-t <target>` como opción de SALIDA, re-encode, SIN `-ss` ni `-vf`', () => {
    const args = buildFitArgs({
      inPath: '/in.mp4',
      outPath: '/out.mp4',
      plan: { kind: 'trim', targetS: 3.4 },
    });
    // `-t 3.400` tras el `-i` (recorte al final); NUNCA `-ss` (que cortaría el arranque).
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-vf');
    const tIdx = args.indexOf('-t');
    expect(tIdx).toBeGreaterThan(args.indexOf('/in.mp4'));
    expect(args[tIdx + 1]).toBe('3.400');
    // Re-encode (NO `-c copy`): un `-c copy` cortaría en el keyframe → duración imprecisa.
    expect(args).not.toContain('copy');
    expect(args).toContain('libx264');
    // NO se descarta el audio (VEED lleva voz embebida que T5.2 extrae aguas abajo).
    expect(args).not.toContain('-an');
  });

  test('hold: `tpad=stop_mode=clone:stop_duration=<déficit>` + `-t <target>`', () => {
    const args = buildFitArgs({
      inPath: '/in.mp4',
      outPath: '/out.mp4',
      plan: { kind: 'hold', deficitS: 0.3, targetS: 3.5 },
    });
    const vfIdx = args.indexOf('-vf');
    expect(vfIdx).toBeGreaterThanOrEqual(0);
    expect(args[vfIdx + 1]).toBe('tpad=stop_mode=clone:stop_duration=0.300');
    // El `-t` acota la salida EXACTA a la narración (tpad puede sobre-extender por redondeo del framerate).
    expect(args[args.indexOf('-t') + 1]).toBe('3.500');
    expect(args).toContain('libx264');
  });

  // El plan `error` NO es un caso de `buildFitArgs`: su param está estrechado a `trim`/`hold` (el TIPO
  // prohíbe el estado inválido), así que el "no emitir un comando inválido" lo garantiza el compilador, no
  // una rama-throw en runtime. El déficit grosero se testea end-to-end en `fitSegmentFile` (abajo).
});

describe('fitSegmentFile (wrapper, control negativo del déficit)', () => {
  test('déficit ≥0,5 s → lanza FitError y el runner de ffmpeg NUNCA se invoca', async () => {
    const runner = vi.fn<FfmpegRunner>(() => Promise.resolve({ code: 0, stderr: '' }));
    await expect(
      fitSegmentFile(
        { runner, ffprobe: fakeFfprobe(3.0) }, // clip mide 3,0 s
        { inPath: '/in.mp4', outPath: '/out.mp4', narrationDurationS: 3.7 }, // narración 3,7 → déficit 0,7
      ),
    ).rejects.toThrow(FitError);
    // El control negativo MUERDE: un desajuste grosero NO llega a ffmpeg (no se tapa con un hold largo).
    expect(runner).not.toHaveBeenCalled();
  });

  test('trim: mide el clip, corre ffmpeg con `-t <narración>`, devuelve plan trim', async () => {
    const runner = vi.fn<FfmpegRunner>(() => Promise.resolve({ code: 0, stderr: '' }));
    const res = await fitSegmentFile(
      { runner, ffprobe: fakeFfprobe(5.0) }, // clip 5,0 s
      { inPath: '/in.mp4', outPath: '/out.mp4', narrationDurationS: 3.4 },
    );
    expect(res.plan.kind).toBe('trim');
    expect(runner).toHaveBeenCalledTimes(1);
    const args = runner.mock.calls[0]?.[0] ?? [];
    expect(args[args.indexOf('-t') + 1]).toBe('3.400');
    expect(args).not.toContain('-vf');
  });

  test('hold: déficit <0,5 s → corre ffmpeg con tpad, devuelve plan hold', async () => {
    const runner = vi.fn<FfmpegRunner>(() => Promise.resolve({ code: 0, stderr: '' }));
    const res = await fitSegmentFile(
      { runner, ffprobe: fakeFfprobe(3.2) }, // clip 3,2 s
      { inPath: '/in.mp4', outPath: '/out.mp4', narrationDurationS: 3.5 }, // déficit 0,3
    );
    expect(res.plan.kind).toBe('hold');
    const args = runner.mock.calls[0]?.[0] ?? [];
    const vf = args[args.indexOf('-vf') + 1] ?? '';
    expect(vf).toContain('tpad=stop_mode=clone');
  });

  test('ffmpeg exit ≠0 → FitError con el exit code', async () => {
    const runner = vi.fn<FfmpegRunner>(() => Promise.resolve({ code: 1, stderr: 'boom' }));
    await expect(
      fitSegmentFile(
        { runner, ffprobe: fakeFfprobe(5.0) },
        { inPath: '/in.mp4', outPath: '/out.mp4', narrationDurationS: 3.4 },
      ),
    ).rejects.toThrow(FitError);
  });

  test('ffprobe devuelve basura → FitError (no una duración válida)', async () => {
    const runner = vi.fn<FfmpegRunner>(() => Promise.resolve({ code: 0, stderr: '' }));
    const badProbe: FfprobeRunner = () => Promise.resolve({ code: 0, stdout: 'N/A\n', stderr: '' });
    await expect(
      fitSegmentFile(
        { runner, ffprobe: badProbe },
        { inPath: '/in.mp4', outPath: '/out.mp4', narrationDurationS: 3.4 },
      ),
    ).rejects.toThrow(FitError);
    expect(runner).not.toHaveBeenCalled();
  });
});
