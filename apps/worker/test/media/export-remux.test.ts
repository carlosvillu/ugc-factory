// Suite MEDIA del EXPORT DUAL con/sin bed (T5.7, §14). Corre ffmpeg + c2patool de VERDAD — la ÚNICA forma
// honesta de verificar la cláusula central de la Verificación: las dos versiones de audio salen del MISMO
// máster SIN re-encode del vídeo. Vive en `apps/worker/test/media/` → proyecto `worker:media` (gated por
// RUN_MEDIA). NO forma parte de `pnpm test`.
//
// EL ASSERT QUE MUERDE (brief T5.7): el stream de VÍDEO de la versión sin bed es BYTE-IDÉNTICO al del máster
// (mismo hash MD5 del stream copiado con `-map 0:v -c copy -f md5`), y mismo codec/nb_frames/time_base por
// ffprobe. «Dos ficheros existen» o «misma duración» pasaría un re-encode roto — por eso se hashea el stream.
//
// El "máster" es sintético: se compone con `composeMaster` (bed incluido) desde clips/voces `lavfi` (coste
// $0, prohibido comitear binarios). exportNoBedVersion lo trata como el máster final persistido (le copia el
// vídeo y le sustituye el audio por la voz sola). La firma C2PA usa los certs de TEST públicos (no secretos).
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { CompositionSpec } from '@ugc/core/contracts';
import type { StorageAdapter } from '@ugc/core';
import { newUlid } from '@ugc/core/contracts';
import { composeMaster, exportNoBedVersion } from '@ugc/services';
import {
  ffprobeJson,
  makeMediaTestStorage,
  makeTestAudio,
  makeTestVideo,
} from '@ugc/test-utils/media';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { mediaToolsAvailable } from './setup';

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const C2PA_KEY = join(HERE, '../../../../packages/services/test/fixtures/c2pa/es256_private.key');
const C2PA_CERT = join(HERE, '../../../../packages/services/test/fixtures/c2pa/es256_certs.pem');

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ugc-export-remux-media-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const p = (name: string): string => join(workDir, name);

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
const c2paSigner = async (args: string[]): Promise<{ code: number | null; stderr: string }> => {
  try {
    const { stderr } = await run('c2patool', args, { maxBuffer: 1024 * 1024 * 64 });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string; message?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? e.message ?? '' };
  }
};

async function makeNormalizedSegment(out: string, seconds: number): Promise<string> {
  return makeTestVideo({ out, width: 1080, height: 1920, fps: 30, seconds, color: 'teal' });
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

/** El hash MD5 del STREAM DE VÍDEO copiado (`-map 0:v -c copy -f md5`). Idéntico ⟺ los bytes del stream de
 *  vídeo son los mismos, aunque el contenedor/audio difieran. Es la prueba honesta de «sin re-render». */
async function videoStreamMd5(file: string): Promise<string> {
  const { stdout } = await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-map',
      '0:v',
      '-c',
      'copy',
      '-f',
      'md5',
      '-',
    ],
    { maxBuffer: 1024 * 1024 * 64 },
  );
  return stdout.trim();
}

describe.skipIf(!mediaToolsAvailable)(
  'export dual con/sin bed → mismo vídeo, audio distinto (T5.7, §14)',
  () => {
    test('la versión SIN bed tiene el MISMO stream de vídeo que el máster (byte-idéntico, sin re-encode) y audio distinto', async () => {
      const storage = makeMediaTestStorage(workDir);
      const keyToId = new Map<string, string>();

      // 2 segmentos (2 + 3 = 5 s), voz de su duración + un bed musical → un máster CON bed (el stand-in del
      // máster final persistido). exportNoBedVersion tratará su vídeo como el que hay que COPIAR.
      const plan = [
        { type: 'hook', secs: 2 },
        { type: 'body', secs: 3 },
      ] as const;
      const segments: CompositionSpec['segments'] = [];
      for (const [i, { type, secs }] of plan.entries()) {
        const v = await makeNormalizedSegment(p(`seg-${String(i)}.mp4`), secs);
        const a = await makeTestAudio({
          out: p(`vo-${String(i)}.m4a`),
          seconds: secs,
          freq: 320 + i * 40,
        });
        const videoAsset = await seedAsset(storage, keyToId, v, `seg/${String(i)}.mp4`);
        const voAudio = await seedAsset(storage, keyToId, a, `vo/${String(i)}.m4a`);
        segments.push({ type, videoAsset, voAudio });
      }
      const bedLocal = await makeTestAudio({ out: p('bed.m4a'), seconds: 5, freq: 110 });
      const bedAsset = await seedAsset(storage, keyToId, bedLocal, 'bed/bed.m4a');

      const resolveAssetKey = (id: string): string => {
        const k = keyToId.get(id);
        if (k === undefined) throw new Error(`asset no sembrado: ${id}`);
        return k;
      };

      const spec: CompositionSpec = {
        segments,
        music: { asset: bedAsset, volume: 0.25, ducking: true, fadeOutS: 1 },
        output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
      };

      // 1) Componer el "máster" CON bed (stand-in del máster final) y subirlo a storage.
      const master = await composeMaster(
        { storage, resolveAssetKey, runner: ffmpegRunner, ffprobe: ffprobeRunner },
        spec,
      );
      const masterKey = 'masters/x/master.mp4';
      await storage.put(masterKey, master.bytes, { mime: 'video/mp4' });
      const masterPath = p('master.mp4');
      await writeFile(masterPath, master.bytes);

      // 2) Producir la versión SIN bed (re-mux de audio).
      const noBed = await exportNoBedVersion(
        {
          storage,
          resolveAssetKey,
          c2paSigner,
          c2pa: {
            privateKeyPath: C2PA_KEY,
            signCertPath: C2PA_CERT,
            claimGenerator: 'UGC Factory Test',
          },
          runner: ffmpegRunner,
          ffprobe: ffprobeRunner,
        },
        { masterStorageKey: masterKey, spec },
      );
      const noBedPath = p('nobed.mp4');
      await writeFile(noBedPath, noBed.bytes);

      // 3) EL ASSERT CENTRAL: el stream de VÍDEO es byte-idéntico (mismo MD5) → no hubo re-encode del vídeo.
      const masterVideoMd5 = await videoStreamMd5(masterPath);
      const noBedVideoMd5 = await videoStreamMd5(noBedPath);
      expect(noBedVideoMd5).toBe(masterVideoMd5);

      // 4) Y los metadatos del stream de vídeo COINCIDEN (codec, nb_frames, time_base) — refuerzo del hash.
      const masterProbe = await ffprobeJson(masterPath);
      const noBedProbe = await ffprobeJson(noBedPath);
      const mv = masterProbe.streams.find((s) => s.codec_type === 'video');
      const nv = noBedProbe.streams.find((s) => s.codec_type === 'video');
      expect(nv?.codec_name).toBe(mv?.codec_name);
      expect(nv?.time_base).toBe(mv?.time_base);
      expect(nv?.nb_frames).toBe(mv?.nb_frames);
      expect(nv?.width).toBe(mv?.width);
      expect(nv?.height).toBe(mv?.height);

      // 5) SANITY de que el audio SÍ cambió (el máster lleva bed, la versión sin bed no): la duración de audio
      //    puede coincidir, pero el stream de audio NO es el mismo → su hash difiere. Confirma que el re-mux
      //    realmente sustituyó la pista (no copió el audio del máster por accidente).
      const audioMd5 = async (file: string): Promise<string> => {
        const { stdout } = await run(
          'ffmpeg',
          ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-'],
          { maxBuffer: 1024 * 1024 * 64 },
        );
        return stdout.trim();
      };
      expect(await audioMd5(noBedPath)).not.toBe(await audioMd5(masterPath));

      // 6) La versión sin bed lleva firma C2PA (§15.3: C2PA en todo export). c2patool --info no debe fallar.
      const { stdout: info } = await run('c2patool', [noBedPath, '--info'], {
        maxBuffer: 1024 * 1024 * 64,
      });
      expect(info.toLowerCase()).toContain('manifest');
    }, 120_000);
  },
);
