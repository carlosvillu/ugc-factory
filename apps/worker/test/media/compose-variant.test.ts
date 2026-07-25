// Suite MEDIA del PASE FINAL: encode+burn-in → C2PA → QA (T5.5, §9.7 N8/N9; media-composition.md §"Pase
// final, QA y C2PA"). Corre ffmpeg + c2patool de VERDAD — la única forma honesta de verificar el burn-in
// libass, el perfil de export, el loudnorm heredado, la firma C2PA y el QA sobre el fichero FIRMADO. Vive en
// `apps/worker/test/media/` → proyecto vitest `worker:media` (gated RUN_MEDIA, imagen del worker). NO forma
// parte de `pnpm test`.
//
// Esta suite (a diferencia de compose-master) importa TANTO `@ugc/services` (`composeVariant`) COMO el
// worker (`generateVariantAss`/`checkAssSafeZone` de src/captions): `worker:media` tiene root=apps/worker, así
// que puede cablear las funciones REALES de captions como los ports que `composeVariant` inyecta — services
// NO puede importar de apps/worker (composition roots hermanos), por eso la dependencia va por inyección.
//
// $0 estricto: los subtítulos se queman desde el word-timestamps REAL de T4.7b (ASR real committeado); el
// resto de la cadena son assets sintéticos lavfi. Cero llamadas a fal/anthropic/openai.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { CompositionSpec } from '@ugc/core/contracts';
import type { StorageAdapter } from '@ugc/core';
import { newUlid } from '@ugc/core/contracts';
import { WordTimestampsSchema, type WordTimestamps } from '@ugc/core/generation';
import { composeVariant, measureAndEvaluateQa, type ComposeVariantDeps } from '@ugc/services';
import {
  ffprobeJson,
  makeMediaTestStorage,
  makeTestAudio,
  makeTestVideo,
  measureIntegratedLufs,
} from '@ugc/test-utils/media';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { checkAssSafeZone } from '../../src/captions/safe-zone';
import { generateVariantAss } from '../../src/captions/variant-ass';
import { mediaToolsAvailable } from './setup';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
// El triplete real de T4.7b (vídeo+voz+ASR reales committeados). Solo se usa el word-timestamps (para las
// captions reales); los clips de la cadena son sintéticos.
const T47B_WORDS = join(HERE, '../../../../docs/verifications/T4.7b/word-timestamps.json');
// Las fixtures de firma C2PA de TEST (certs públicos de c2patool v0.9.12; NO secretos de producción).
const C2PA_KEY = join(HERE, '../../../../packages/services/test/fixtures/c2pa/es256_private.key');
const C2PA_CERT = join(HERE, '../../../../packages/services/test/fixtures/c2pa/es256_certs.pem');

let workDir: string;
let realWords: WordTimestamps;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ugc-variant-media-'));
  realWords = WordTimestampsSchema.parse(JSON.parse(await readFile(T47B_WORDS, 'utf8')));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const p = (name: string): string => join(workDir, name);

/** Runner real de ffmpeg (subproceso) — el default de composeVariant también lo es, pero se cablea explícito
 *  para que el test controle el cwd/tmp. */
const ffmpegRunner = async (args: string[]): Promise<{ code: number | null; stderr: string }> => {
  try {
    const { stderr } = await run('ffmpeg', args, { maxBuffer: 1024 * 1024 * 64 });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string; message?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? e.message ?? '' };
  }
};
const ffprobeRunner = async (
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> => {
  try {
    const { stdout, stderr } = await run('ffprobe', args, { maxBuffer: 1024 * 1024 * 64 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' };
  }
};
/** c2patool REAL de la imagen. */
const c2paSigner = async (args: string[]): Promise<{ code: number | null; stderr: string }> => {
  try {
    const { stderr } = await run('c2patool', args, { maxBuffer: 1024 * 1024 * 64 });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string; message?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? e.message ?? '' };
  }
};

/** Un "clip normalizado" sintético: perfil UNIFORME (1080×1920/30fps/H.264/yuv420p), el stand-in de T5.2. */
async function makeNormalizedSegment(out: string, seconds: number): Promise<string> {
  return makeTestVideo({ out, width: 1080, height: 1920, fps: 30, seconds, color: 'navy' });
}

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

/** Los deps reales de composeVariant: runners de la imagen + captions del worker + certs de test. */
function makeDeps(storage: StorageAdapter, keyToId: Map<string, string>): ComposeVariantDeps {
  return {
    storage,
    resolveAssetKey: (id) => {
      const k = keyToId.get(id);
      if (k === undefined) throw new Error(`asset no sembrado: ${id}`);
      return k;
    },
    runner: ffmpegRunner,
    ffprobe: ffprobeRunner,
    captionGenerator: generateVariantAss,
    safeZoneChecker: (ass) => checkAssSafeZone(ass).length,
    c2paSigner,
    loudnessMeter: measureIntegratedLufs,
    c2pa: { privateKeyPath: C2PA_KEY, signCertPath: C2PA_CERT, claimGenerator: 'UGC Factory Test' },
  };
}

describe.skipIf(!mediaToolsAvailable)('pase final: encode+burn-in → C2PA → QA (T5.5)', () => {
  test('compose end-to-end con captions reales → máster firmado + qa_report TODO en pass + C2PA trainedAlgorithmicMedia', async () => {
    const storage = makeMediaTestStorage(workDir);
    const keyToId = new Map<string, string>();

    // 3 segmentos ~3 s cada uno (9 s total, dentro de ≤60 s). Cada uno con voz de su duración (invariante
    // T5.3: voz==vídeo por segmento). Las voWords del PRIMER segmento son las REALES de T4.7b (ASR real);
    // los otros dos reusan las mismas palabras (el merge las offsetea) — el objetivo es un `.ass` real que
    // se quema, no el contenido semántico.
    const plan = [
      { type: 'hook', secs: 3 },
      { type: 'body', secs: 3 },
      { type: 'cta', secs: 3 },
    ] as const;
    const segments: CompositionSpec['segments'] = [];
    for (const [i, { type, secs }] of plan.entries()) {
      const v = await makeNormalizedSegment(p(`seg-${String(i)}.mp4`), secs);
      const a = await makeTestAudio({ out: p(`vo-${String(i)}.m4a`), seconds: secs, freq: 300 });
      const videoAsset = await seedAsset(storage, keyToId, v, `seg/${String(i)}.mp4`);
      const voAudio = await seedAsset(storage, keyToId, a, `vo/${String(i)}.m4a`);
      segments.push({ type, videoAssets: [videoAsset], voAudio, voWords: realWords });
    }

    const spec: CompositionSpec = {
      segments,
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
      captions: {
        style: 'karaoke',
        maxWordsPerPage: 3,
        platform: 'universal',
        position: 'safe_zone',
      },
    };

    const result = await composeVariant(makeDeps(storage, keyToId), spec);

    // El máster firmado escrito a disco para inspección con ffprobe/c2patool.
    const masterPath = p('master-signed.mp4');
    await writeFile(masterPath, result.masterBytes);

    // 1) qa_report: los 8 checks en pass (la fila `qa_report` de la Verificación).
    expect(result.qaReport.checks).toMatchObject({
      resolution: 'pass',
      fps: 'pass',
      codec: 'pass',
      duration: 'pass',
      loudness: 'pass',
      av_duration_diff: 'pass',
      captions_safe_zone: 'pass',
      filesize: 'pass',
    });
    expect(result.qaReport.passed).toBe(true);
    expect(result.qaReport.score).toBe(100);

    // El LINAJE del máster: los 6 assets origen (3 clips + 3 voces), en orden — lo que la persistencia
    // pondrá en `parent_asset_ids` (T5.7 lo recorre). Se deriva del spec, no se deja al caller.
    const expectedLineage = segments.flatMap((s) => [...s.videoAssets, s.voAudio]);
    expect(result.parentAssetIds).toEqual(expectedLineage);

    // 2) El máster firmado cumple el perfil de export (1080×1920/30fps/H.264/yuv420p) — el burn-in RE-ENCODÓ
    //    el vídeo (no copy) y c2patool preservó el contenedor.
    const probe = await ffprobeJson(masterPath);
    const v0 = probe.streams.find((s) => s.codec_type === 'video');
    expect(v0?.codec_name).toBe('h264');
    expect(v0?.width).toBe(1080);
    expect(v0?.height).toBe(1920);
    expect(v0?.pix_fmt).toBe('yuv420p');
    // El audio va `-c:a copy` desde el intermedio → AAC 48k estéreo.
    const a0 = probe.streams.find((s) => s.codec_type === 'audio');
    expect(a0?.codec_name).toBe('aac');

    // 3) +faststart PRESERVADO tras la firma (moov antes del mdat) — c2patool reescribe el MP4 pero no lo
    //    rompe para streaming (verificado en el spike; se re-verifica aquí sobre el output real).
    const bytes = result.masterBytes;
    const moov = indexOfAtom(bytes, 'moov');
    const mdat = indexOfAtom(bytes, 'mdat');
    expect(moov).toBeGreaterThan(0);
    expect(mdat).toBeGreaterThan(0);
    expect(moov).toBeLessThan(mdat);

    // 4) C2PA: el manifest existe y declara media generada por IA. OJO (hallazgo T5.5): el `c2patool --info`
    //    literal de la Verificación NO surface el claim en v0.9.12 (solo cuenta manifests/valida); el claim
    //    `trainedAlgorithmicMedia` aparece en el DUMP POR DEFECTO (sin flags) y en `--detailed`. Se asserta
    //    sobre el comando que SÍ lo muestra (dump por defecto).
    const { stdout: dump } = await run('c2patool', [masterPath], { maxBuffer: 1024 * 1024 * 64 });
    expect(dump).toContain('trainedAlgorithmicMedia');
    // `--info` valida la firma (aunque no muestre el claim): confirma que el manifest está bien formado.
    const { stdout: info } = await run('c2patool', [masterPath, '--info'], {
      maxBuffer: 1024 * 1024 * 64,
    });
    expect(info).toContain('Validated');
  });

  test('sin captions (captions:null): re-encoda igual al preset, captions_safe_zone es vacuous-pass', async () => {
    const storage = makeMediaTestStorage(workDir);
    const keyToId = new Map<string, string>();
    const v = await makeNormalizedSegment(p('nc-seg.mp4'), 3);
    const a = await makeTestAudio({ out: p('nc-vo.m4a'), seconds: 3 });
    const videoAsset = await seedAsset(storage, keyToId, v, 'nc/v.mp4');
    const voAudio = await seedAsset(storage, keyToId, a, 'nc/a.m4a');
    const spec: CompositionSpec = {
      segments: [{ type: 'hook', videoAssets: [videoAsset], voAudio }],
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
      captions: null,
    };
    const result = await composeVariant(makeDeps(storage, keyToId), spec);
    expect(result.qaReport.checks.captions_safe_zone).toBe('pass');
    expect(result.qaReport.passed).toBe(true);
    // Un thumbnail se produjo (bytes > 0).
    expect(result.thumbnailBytes.byteLength).toBeGreaterThan(0);
  });

  // ── QA EN NEGATIVO (media-composition.md: "un QA que nunca falla no verifica nada"): un máster DEFECTUOSO
  //    a propósito → el check correspondiente sale `fail`. Prueba que la CAPA DE MEDICIÓN (ffprobe/ebur128)
  //    alimenta la decisión, no solo la función pura del gate. Cada caso parte del MISMO encode "perfecto" y
  //    rompe UN parámetro → hace evidente qué distingue a cada máster malo. ─────────────────────────────

  /** Encoda un máster lavfi con un perfil de export sano, variando SOLO lo que un test negativo necesita romper
   *  (fps, tamaño, duración, o el volumen del audio). El resto (H.264 yuv420p, AAC 48k estéreo) es el perfil
   *  bueno → cada test aísla exactamente el defecto que prueba. */
  const makeBadMaster = async (
    name: string,
    opts: { fps?: number; size?: string; durationS?: number; volume?: number } = {},
  ): Promise<string> => {
    const { fps = 30, size = '1080x1920', durationS = 3, volume } = opts;
    const out = p(name);
    await run('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=navy:s=${size}:r=${String(fps)}:d=${String(durationS)}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=300:duration=${String(durationS)}`,
      ...(volume !== undefined ? ['-af', `volume=${String(volume)}`] : []),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(fps),
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      out,
    ]);
    return out;
  };

  const qaOf = (
    masterPath: string,
    args: { captionViolations: number; variantMaxDurationS: number },
  ) =>
    measureAndEvaluateQa(
      { ffprobe: ffprobeRunner, loudnessMeter: measureIntegratedLufs },
      { masterPath, ...args },
    );

  test('QA negativo: máster a 25 fps → fps=fail', async () => {
    const bad = await makeBadMaster('bad-fps.mp4', { fps: 25 });
    const report = await qaOf(bad, { captionViolations: 0, variantMaxDurationS: 30 });
    expect(report.checks.fps).toBe('fail');
    expect(report.passed).toBe(false);
  });

  test('QA negativo: máster a −20 LUFS → loudness=fail', async () => {
    // Audio muy silencioso (volume=0.02) → loudness integrado muy por debajo de −14.
    const bad = await makeBadMaster('bad-lufs.mp4', { volume: 0.02 });
    const report = await qaOf(bad, { captionViolations: 0, variantMaxDurationS: 30 });
    expect(report.checks.loudness).toBe('fail');
  });

  test('QA negativo: máster a 720×1280 → resolution=fail', async () => {
    const bad = await makeBadMaster('bad-res.mp4', { size: '720x1280' });
    const report = await qaOf(bad, { captionViolations: 0, variantMaxDurationS: 30 });
    expect(report.checks.resolution).toBe('fail');
  });

  test('QA negativo: captions fuera de la safe zone (violaciones > 0) → captions_safe_zone=fail', async () => {
    // Un máster perfecto, pero se le pasan violaciones > 0 (como si el .ass posicionara texto fuera). Prueba
    // que el veredicto sigue las violaciones REALES contadas por el check de T5.4, no un valor cableado.
    const ok = await makeBadMaster('ok-for-caption-neg.mp4');
    const report = await qaOf(ok, { captionViolations: 2, variantMaxDurationS: 30 });
    expect(report.checks.captions_safe_zone).toBe('fail');
  });

  test('QA negativo: duración > techo de la variante → duration=fail', async () => {
    // variante con techo 5 s; el máster mide 6 s → duration fail.
    const longMaster = await makeBadMaster('too-long.mp4', { durationS: 6 });
    const report = await qaOf(longMaster, { captionViolations: 0, variantMaxDurationS: 5 });
    expect(report.checks.duration).toBe('fail');
  });
});

/** Localiza el offset de un atom MP4 (4 bytes ASCII) en un buffer. Para el check de faststart (moov<mdat).
 *  Escaneo simple del nombre del atom; suficiente para distinguir el orden moov/mdat en un MP4 pequeño. */
function indexOfAtom(bytes: Uint8Array, atom: string): number {
  const needle = Array.from(atom, (c) => c.charCodeAt(0));
  for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    let hit = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}
