// Unit tests del RE-MUX del export sin bed (T5.7, §14). Corren en el gate (services:unit, SIN ffmpeg): un
// runner FAKE captura los args y crea los ficheros de salida vacíos+1byte para que la orquestación siga. Lo
// que se PRUEBA aquí es la cláusula DETERMINISTA de la Verificación como test permanente (regla 8): que el
// re-mux COPIA el vídeo del máster (`-c:v copy`, NO re-encode) y NO añade el bed (rama sin bed del graph).
//
// El test de COMPORTAMIENTO (el stream de vídeo BYTE-IDÉNTICO entre máster y versión sin bed, con ffmpeg de
// verdad) vive en la suite media (`apps/worker/test/media/export-remux.test.ts`) — aquí no hay ffmpeg.
import { writeFile } from 'node:fs/promises';

import type { StorageAdapter } from '@ugc/core';
import type { CompositionSpec } from '@ugc/core/contracts';
import { newUlid } from '@ugc/core/contracts';
import { describe, expect, test } from 'vitest';

import { exportNoBedVersion, ExportRemuxError } from './export-remux';
import type { FfmpegRunner, FfprobeRunner } from './extract-audio-track';

/** Storage en memoria: `get` devuelve unos bytes cualesquiera (el runner es fake, no decodifica nada). */
function makeMemoryStorage(): StorageAdapter {
  const bytes = new Uint8Array([0, 1, 2, 3]);
  return {
    put: () => Promise.resolve({ bytes: bytes.byteLength, checksum: 'x' }),
    get: () =>
      Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      ),
    stat: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  };
}

/** ffprobe fake: devuelve siempre una duración válida (para el `-t` del mux). */
const fakeFfprobe: FfprobeRunner = () =>
  Promise.resolve({ code: 0, stdout: '7.000000\n', stderr: '' });

function makeSpec(segments = 2): CompositionSpec {
  return {
    segments: Array.from({ length: segments }, (_, i) => ({
      type: (['hook', 'body', 'cta'] as const)[i] ?? 'body',
      videoAsset: newUlid(),
      voAudio: newUlid(),
    })),
    music: { asset: newUlid(), volume: 0.25, ducking: true, fadeOutS: 1 },
    output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
  };
}

/** Firma fake: como c2patool, ESCRIBE el fichero de `-o` (el caller lo lee después). */
const OK_SIGN = async (args: string[]): Promise<{ code: number; stderr: string }> => {
  const oIdx = args.indexOf('-o');
  const out = oIdx >= 0 ? args[oIdx + 1] : undefined;
  if (out !== undefined) await writeFile(out, new Uint8Array([1, 2]));
  return { code: 0, stderr: '' };
};

const C2PA = { privateKeyPath: '/k.key', signCertPath: '/c.pem' };

describe('exportNoBedVersion — re-mux de audio (T5.7, §14)', () => {
  test('el MUX copia el vídeo del máster SIN re-encode (-c:v copy) y NO añade el bed', async () => {
    const calls: string[][] = [];
    // El runner fake CREA el fichero de salida (el último arg de cada llamada) con 1 byte, para que
    // readFile del resultado no falle. Captura los args.
    const runner: FfmpegRunner = async (args) => {
      calls.push(args);
      const out = args[args.length - 1];
      if (out !== undefined && out !== '-y') await writeFile(out, new Uint8Array([1]));
      return { code: 0, stderr: '' };
    };

    await exportNoBedVersion(
      {
        storage: makeMemoryStorage(),
        resolveAssetKey: (id) => `k/${id}`,
        c2paSigner: OK_SIGN,
        c2pa: C2PA,
        runner,
        ffprobe: fakeFfprobe,
      },
      { masterStorageKey: 'masters/x/master.mp4', spec: makeSpec() },
    );

    // El comando de MUX es el que lleva `-filter_complex` (el concat de voz no lo lleva).
    const muxCall = calls.find((c) => c.includes('-filter_complex'));
    expect(muxCall).toBeDefined();
    if (muxCall === undefined) return;

    // 1) El VÍDEO se copia sin re-encode — la cláusula central de §14 (sin re-render del vídeo).
    const cvIdx = muxCall.indexOf('-c:v');
    expect(cvIdx).toBeGreaterThanOrEqual(0);
    expect(muxCall[cvIdx + 1]).toBe('copy');

    // 2) SIN bed: el mux recibe SOLO 2 inputs (vídeo del máster + voz), NO 3 (no hay `-i` del bed). El
    //    filtergraph es la rama `hasBed:false` (voz sola → loudnorm), sin `amix` ni `sidechaincompress`.
    const inputCount = muxCall.filter((a) => a === '-i').length;
    expect(inputCount).toBe(2);
    const fc = muxCall[muxCall.indexOf('-filter_complex') + 1] ?? '';
    expect(fc).toContain('loudnorm=I=-14');
    expect(fc).not.toContain('amix');
    expect(fc).not.toContain('sidechaincompress');
  });

  test('la voz se concatena con el demuxer de audio (-c:a copy -vn) antes del mux', async () => {
    const calls: string[][] = [];
    const runner: FfmpegRunner = async (args) => {
      calls.push(args);
      const out = args[args.length - 1];
      if (out !== undefined && out !== '-y') await writeFile(out, new Uint8Array([1]));
      return { code: 0, stderr: '' };
    };

    await exportNoBedVersion(
      {
        storage: makeMemoryStorage(),
        resolveAssetKey: (id) => `k/${id}`,
        c2paSigner: OK_SIGN,
        c2pa: C2PA,
        runner,
        ffprobe: fakeFfprobe,
      },
      { masterStorageKey: 'masters/x/master.mp4', spec: makeSpec() },
    );

    // El concat de VOZ: `-f concat` + `-c:a copy` + `-vn` (no lleva filter_complex).
    const concatCall = calls.find((c) => c.includes('-f') && c[c.indexOf('-f') + 1] === 'concat');
    expect(concatCall).toBeDefined();
    if (concatCall === undefined) return;
    expect(concatCall).toContain('-vn');
    const caIdx = concatCall.indexOf('-c:a');
    expect(concatCall[caIdx + 1]).toBe('copy');
  });

  test('re-FIRMA C2PA la versión sin bed (§15.3: C2PA en todo export)', async () => {
    let signed = false;
    const runner: FfmpegRunner = async (args) => {
      const out = args[args.length - 1];
      if (out !== undefined && out !== '-y') await writeFile(out, new Uint8Array([1]));
      return { code: 0, stderr: '' };
    };
    const c2paSigner = async (args: string[]): Promise<{ code: number; stderr: string }> => {
      signed = true;
      // c2patool escribe el fichero de `-o`.
      const oIdx = args.indexOf('-o');
      if (oIdx >= 0 && args[oIdx + 1] !== undefined)
        await writeFile(args[oIdx + 1]!, new Uint8Array([1, 2]));
      return { code: 0, stderr: '' };
    };

    const result = await exportNoBedVersion(
      {
        storage: makeMemoryStorage(),
        resolveAssetKey: (id) => `k/${id}`,
        c2paSigner,
        c2pa: C2PA,
        runner,
        ffprobe: fakeFfprobe,
      },
      { masterStorageKey: 'masters/x/master.mp4', spec: makeSpec() },
    );
    expect(signed).toBe(true);
    expect(result.mime).toBe('video/mp4');
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  // ── Errores TIPADOS y distinguibles (anti-T1.8): cada fase falla con su clase/fase, no un catch genérico. ──

  test('LANZA ExportRemuxError con phase=mux cuando ffmpeg del mux falla', async () => {
    const runner: FfmpegRunner = async (args) => {
      // El concat de voz pasa (crea su salida); el mux (el que lleva filter_complex) falla.
      const out = args[args.length - 1];
      if (args.includes('-filter_complex')) return { code: 1, stderr: 'mux boom' };
      if (out !== undefined && out !== '-y') await writeFile(out, new Uint8Array([1]));
      return { code: 0, stderr: '' };
    };

    await expect(
      exportNoBedVersion(
        {
          storage: makeMemoryStorage(),
          resolveAssetKey: (id) => `k/${id}`,
          c2paSigner: OK_SIGN,
          c2pa: C2PA,
          runner,
          ffprobe: fakeFfprobe,
        },
        { masterStorageKey: 'm', spec: makeSpec() },
      ),
    ).rejects.toMatchObject({ name: 'ExportRemuxError', phase: 'mux' });
  });

  test('LANZA ExportRemuxError con phase=sign cuando c2patool falla (no lo colapsa con un fallo de mux)', async () => {
    const runner: FfmpegRunner = async (args) => {
      const out = args[args.length - 1];
      if (out !== undefined && out !== '-y') await writeFile(out, new Uint8Array([1]));
      return { code: 0, stderr: '' };
    };
    const c2paSigner = (): Promise<{ code: number; stderr: string }> =>
      Promise.resolve({ code: 3, stderr: 'sign boom' });

    const err = await exportNoBedVersion(
      {
        storage: makeMemoryStorage(),
        resolveAssetKey: (id) => `k/${id}`,
        c2paSigner,
        c2pa: C2PA,
        runner,
        ffprobe: fakeFfprobe,
      },
      { masterStorageKey: 'm', spec: makeSpec() },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportRemuxError);
    expect((err as ExportRemuxError).phase).toBe('sign');
  });
});
