// Unit test (GATE, services:unit — SIN ffmpeg/c2patool) de los builders PUROS del pase final (T5.5) y de la
// función de decisión del QA. Cubre lo que NO necesita la imagen: que los args del encoder llevan el
// EXPORT_MASTER_PRESET (anti-T1.9: el encoder se configura desde la MISMA constante que el QA), que el
// manifest C2PA declara `trainedAlgorithmicMedia`, y —lo más importante— que CADA uno de los 8 checks del QA
// MUERDE en negativo (media-composition.md: "un QA que nunca falla no verifica nada"). Estas cláusulas
// deterministas quedan protegidas contra regresión para siempre (regla de trabajo 8 del planning).
import {
  buildFinalEncodeArgs,
  buildThumbnailArgs,
  buildC2paManifest,
  collectSpecParentAssetIds,
  escapeFilterPath,
  evaluateQa,
  EXPORT_MASTER_PRESET,
  type QaMeasurements,
} from './compose-variant';
import type { CompositionSpec } from '@ugc/core/contracts';
import { QaReportSchema, newUlid } from '@ugc/core/contracts';
import { describe, expect, test } from 'vitest';

const P = EXPORT_MASTER_PRESET;

// ── buildFinalEncodeArgs: anti-T1.9, el encoder se configura DESDE el preset ──────────────────────────────

describe('buildFinalEncodeArgs (anti-T1.9: args derivados del EXPORT_MASTER_PRESET)', () => {
  test('re-encoda el vídeo al preset de export (H.264 High, VBR 8–12 Mbps, +faststart) — NO -c:v copy', () => {
    const args = buildFinalEncodeArgs({
      inPath: 'in.mp4',
      assPath: 'cap.ass',
      outPath: 'out.mp4',
      copyAudio: true,
    });
    const joined = args.join(' ');
    // El vídeo se RE-ENCODA con el ENCODER del preset (el burn-in obliga, PRD l.276) — jamás -c:v copy. El
    // encoder sale de `P.videoEncoder` (misma constante que el QA), NO de un literal suelto que pudiera divergir.
    expect(args).toContain(P.videoEncoder);
    expect(joined).not.toContain('-c:v copy');
    // Los valores salen del preset (misma constante que el QA deriva sus esperados):
    expect(args).toContain('-profile:v');
    expect(args).toContain(P.h264Profile);
    expect(args).toContain('-pix_fmt');
    expect(args).toContain(P.pixFmt);
    expect(args).toContain('-b:v');
    expect(args).toContain(String(P.videoBitrateTarget));
    expect(args).toContain('-maxrate');
    expect(args).toContain(String(P.videoBitrateMax));
    expect(args).toContain('-bufsize');
    expect(args).toContain(String(P.vbvBufsize));
    // +faststart (Apéndice C).
    expect(args).toContain('-movflags');
    expect(args).toContain('+faststart');
  });

  test('quema el `.ass` con el filtro ass= cuando hay captions', () => {
    const args = buildFinalEncodeArgs({
      inPath: 'in.mp4',
      assPath: 'my captions.ass',
      outPath: 'out.mp4',
      copyAudio: true,
    });
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toContain('ass=');
    expect(vf).toContain('my captions.ass');
  });

  test('sin captions (assPath null): re-encoda igual pero SIN filtro ass=', () => {
    const args = buildFinalEncodeArgs({
      inPath: 'in.mp4',
      assPath: null,
      outPath: 'out.mp4',
      copyAudio: true,
    });
    expect(args).not.toContain('-vf');
    expect(args).toContain('libx264'); // se re-encoda igual (al preset de export)
  });

  test('copyAudio=true → -c:a copy (seam de regeneración parcial T5.8, el audio no cambió)', () => {
    const args = buildFinalEncodeArgs({
      inPath: 'in.mp4',
      assPath: null,
      outPath: 'out.mp4',
      copyAudio: true,
    });
    const caIdx = args.indexOf('-c:a');
    expect(caIdx).toBeGreaterThanOrEqual(0);
    expect(args[caIdx + 1]).toBe('copy');
    // No re-encoda el audio → no fija -b:a.
    expect(args).not.toContain('-b:a');
  });

  test('copyAudio=false → re-encoda el audio a AAC 128k 48k estéreo (del preset)', () => {
    const args = buildFinalEncodeArgs({
      inPath: 'in.mp4',
      assPath: null,
      outPath: 'out.mp4',
      copyAudio: false,
    });
    expect(args).toContain(P.audioCodec);
    expect(args).toContain('-b:a');
    expect(args).toContain(String(P.audioBitrate));
    expect(args).toContain('-ar');
    expect(args).toContain(String(P.audioSampleRate));
  });
});

describe('escapeFilterPath', () => {
  test("escapa `:` y `\\` y `'` (especiales del mini-lenguaje de -vf)", () => {
    expect(escapeFilterPath('/tmp/a:b.ass')).toBe('/tmp/a\\:b.ass');
    expect(escapeFilterPath("/tmp/o'x.ass")).toBe("/tmp/o\\'x.ass");
  });
});

describe('buildThumbnailArgs', () => {
  test('extrae UN frame al instante pedido', () => {
    const args = buildThumbnailArgs({ inPath: 'm.mp4', atSeconds: 3.5, outPath: 't.jpg' });
    expect(args).toContain('-vframes');
    expect(args[args.indexOf('-vframes') + 1]).toBe('1');
    expect(args).toContain('-ss');
    expect(args[args.indexOf('-ss') + 1]).toBe('3.500');
  });
});

// ── buildC2paManifest: el claim que TikTok / EU AI Act reconocen ──────────────────────────────────────────

describe('buildC2paManifest', () => {
  test('declara digitalSourceType: trainedAlgorithmicMedia + referencia el cert/clave inyectados', () => {
    const manifest = buildC2paManifest({
      privateKeyPath: '/keys/es256_private.key',
      signCertPath: '/keys/es256_certs.pem',
    });
    expect(manifest).toContain('trainedAlgorithmicMedia');
    expect(manifest).toContain('c2pa.created');
    expect(manifest).toContain('/keys/es256_private.key');
    expect(manifest).toContain('/keys/es256_certs.pem');
    const parsed = JSON.parse(manifest) as { alg: string; assertions: unknown[] };
    expect(parsed.alg).toBe('es256');
    expect(parsed.assertions).toHaveLength(1);
  });
});

// ── evaluateQa: el punto FIJO (todo pasa) + CADA check muerde en negativo ─────────────────────────────────

/** Métricas de un máster PERFECTO (todos los checks en pass). Cada test de negativo parte de aquí y rompe
 *  UN campo → assert de que EXACTAMENTE ese check pasa a `fail`. */
function goodMeasurements(): QaMeasurements {
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    videoCodec: 'h264',
    pixFmt: 'yuv420p',
    audioCodec: 'aac',
    audioSampleRate: 48_000,
    audioChannels: 2,
    audioBitrate: 128_000,
    videoDurationS: 20,
    audioDurationS: 20,
    loudnessLufs: -14,
    filesizeBytes: 10 * 1024 * 1024,
    captionViolations: 0,
  };
}

const VARIANT_MAX_S = 30;

describe('evaluateQa — punto fijo', () => {
  test('un máster perfecto: los 8 checks en pass, passed=true, score=100', () => {
    const report = evaluateQa(goodMeasurements(), VARIANT_MAX_S);
    expect(report.checks).toMatchObject({
      resolution: 'pass',
      fps: 'pass',
      codec: 'pass',
      duration: 'pass',
      loudness: 'pass',
      av_duration_diff: 'pass',
      captions_safe_zone: 'pass',
      filesize: 'pass',
    });
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
    // El report valida contra el contrato de core (lo que persiste la columna jsonb).
    expect(QaReportSchema.safeParse(report).success).toBe(true);
  });

  test('sin captions (violaciones null): captions_safe_zone es vacuous-pass', () => {
    const report = evaluateQa({ ...goodMeasurements(), captionViolations: null }, VARIANT_MAX_S);
    expect(report.checks.captions_safe_zone).toBe('pass');
    expect(report.passed).toBe(true);
  });
});

// El corazón del principio 9: cada check debe FALLAR ante su defecto. Un QA que nunca falla no verifica nada.
describe('evaluateQa — control negativo por check (cada uno MUERDE)', () => {
  test('resolution: 720×1280 → fail', () => {
    const r = evaluateQa({ ...goodMeasurements(), width: 720, height: 1280 }, VARIANT_MAX_S);
    expect(r.checks.resolution).toBe('fail');
    expect(r.passed).toBe(false);
    expect(r.score).toBeLessThan(100);
  });

  test('fps: 25 fps → fail', () => {
    const r = evaluateQa({ ...goodMeasurements(), fps: 25 }, VARIANT_MAX_S);
    expect(r.checks.fps).toBe('fail');
  });

  test('codec: vp9 → fail; pix_fmt yuv444p → fail', () => {
    expect(
      evaluateQa({ ...goodMeasurements(), videoCodec: 'vp9' }, VARIANT_MAX_S).checks.codec,
    ).toBe('fail');
    expect(
      evaluateQa({ ...goodMeasurements(), pixFmt: 'yuv444p' }, VARIANT_MAX_S).checks.codec,
    ).toBe('fail');
  });

  test('duration: supera el techo de la variante → fail', () => {
    // maxDurationS de la variante = 30; un máster de 45 s lo supera.
    const r = evaluateQa({ ...goodMeasurements(), videoDurationS: 45 }, VARIANT_MAX_S);
    expect(r.checks.duration).toBe('fail');
  });

  test('duration: supera el techo del preset (60 s) aunque la variante lo permitiera → fail', () => {
    // variante con maxDurationS=120 (imposible en la práctica), pero el preset topa en 60.
    const r = evaluateQa({ ...goodMeasurements(), videoDurationS: 90 }, 120);
    expect(r.checks.duration).toBe('fail');
  });

  test('loudness: −20 LUFS (fuera de −14 ±1.5) → fail', () => {
    const r = evaluateQa({ ...goodMeasurements(), loudnessLufs: -20 }, VARIANT_MAX_S);
    expect(r.checks.loudness).toBe('fail');
  });

  test('loudness: sin audio (null) → fail', () => {
    const r = evaluateQa({ ...goodMeasurements(), loudnessLufs: null }, VARIANT_MAX_S);
    expect(r.checks.loudness).toBe('fail');
  });

  test('av_duration_diff: audio 2 s más corto que el vídeo → fail', () => {
    const r = evaluateQa(
      { ...goodMeasurements(), videoDurationS: 20, audioDurationS: 18 },
      VARIANT_MAX_S,
    );
    expect(r.checks.av_duration_diff).toBe('fail');
  });

  test('av_duration_diff: audio presente pero sin duración medible (null) → fail', () => {
    // Un audio cuyo stream no reporta `duration` cae a `null` (no al contenedor): el check no puede
    // afirmar sincronía → `fail` OBSERVABLE, nunca un pase "gratis" contra la duración del contenedor.
    const r = evaluateQa({ ...goodMeasurements(), audioDurationS: null }, VARIANT_MAX_S);
    expect(r.checks.av_duration_diff).toBe('fail');
  });

  test('captions_safe_zone: 3 eventos fuera de la safe zone → fail', () => {
    const r = evaluateQa({ ...goodMeasurements(), captionViolations: 3 }, VARIANT_MAX_S);
    expect(r.checks.captions_safe_zone).toBe('fail');
  });

  test('filesize: 600 MB (> 500 MB) → fail', () => {
    const r = evaluateQa(
      { ...goodMeasurements(), filesizeBytes: 600 * 1024 * 1024 },
      VARIANT_MAX_S,
    );
    expect(r.checks.filesize).toBe('fail');
  });

  test('score baja proporcionalmente al nº de checks en fail', () => {
    // Rompe 2 de 8 checks → 6/8 = 75.
    const r = evaluateQa(
      { ...goodMeasurements(), fps: 25, filesizeBytes: 600 * 1024 * 1024 },
      VARIANT_MAX_S,
    );
    expect(r.score).toBe(75);
    expect(r.passed).toBe(false);
  });
});

// ── collectSpecParentAssetIds: el LINAJE del máster derivado del spec (§12, T5.7 lo recorre) ──────────────

describe('collectSpecParentAssetIds', () => {
  function seg(videoAsset: string, voAudio: string): CompositionSpec['segments'][number] {
    return { type: 'hook', videoAssets: [videoAsset], voAudio };
  }

  test('recoge clips + voces de todos los segmentos + el bed, en orden', () => {
    const v0 = newUlid();
    const a0 = newUlid();
    const v1 = newUlid();
    const a1 = newUlid();
    const bed = newUlid();
    const spec: CompositionSpec = {
      segments: [seg(v0, a0), seg(v1, a1)],
      music: { asset: bed, volume: 0.25, ducking: true, fadeOutS: 1 },
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
    };
    expect(collectSpecParentAssetIds(spec)).toEqual([v0, a0, v1, a1, bed]);
  });

  test('sin bed (music:null): solo clips + voces', () => {
    const v0 = newUlid();
    const a0 = newUlid();
    const spec: CompositionSpec = {
      segments: [seg(v0, a0)],
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
    };
    expect(collectSpecParentAssetIds(spec)).toEqual([v0, a0]);
  });

  test('deduplica un asset reusado en dos segmentos (aparece una vez)', () => {
    const shared = newUlid();
    const a0 = newUlid();
    const a1 = newUlid();
    const spec: CompositionSpec = {
      segments: [seg(shared, a0), seg(shared, a1)],
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
    };
    expect(collectSpecParentAssetIds(spec)).toEqual([shared, a0, a1]);
  });
});
