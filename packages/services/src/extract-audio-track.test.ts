// Unit del wrapper de extracción de audio con ffmpeg (T4.7b). El `spawn` de ffmpeg es INYECTABLE: aquí
// se prueba con un runner FAKE (éxito escribe un WAV; fallo devuelve exit≠0), NUNCA con ffmpeg real — el
// gate no corre ffmpeg (igual que no construye la imagen Docker). La extracción REAL contra el binario de
// la imagen del worker la verifica el verifier vía el smoke. Estos tests blindan la LÓGICA del wrapper:
// materializar→ffmpeg→leer→limpiar, y la TAXONOMÍA de error (AudioExtractionError con exitCode+stderr).
import { readFile, writeFile } from 'node:fs/promises';

import type { StorageAdapter } from '@ugc/core';
import { describe, expect, it, vi } from 'vitest';

import {
  AudioExtractionError,
  extractAudioTrack,
  probeVideoDurationSeconds,
  VideoProbeError,
  type FfmpegRunner,
  type FfprobeRunner,
} from './extract-audio-track';

/** Un StorageAdapter mínimo que sirve `videoBytes` en `get` y no persiste nada. */
function fakeStorage(videoBytes: Uint8Array): StorageAdapter {
  return {
    get: () =>
      Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(videoBytes);
            controller.close();
          },
        }),
      ),
    put: () => Promise.resolve({ bytes: 0, checksum: 'x' }),
    stat: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  };
}

describe('extractAudioTrack — extracción de audio con ffmpeg (T4.7b)', () => {
  it('éxito: corre ffmpeg con -vn, escribe el WAV de salida, lo lee y limpia los temps', async () => {
    const wavBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]); // "RIFF" + payload
    // El runner fake SIMULA a ffmpeg: escribe el WAV en el `outPath` (último arg) y devuelve exit 0.
    const ffmpeg: FfmpegRunner = vi.fn(async (args: string[]) => {
      const outPath = args.at(-1) ?? '';
      await writeFile(outPath, wavBytes);
      return { code: 0, stderr: '' };
    });

    const res = await extractAudioTrack(
      { storage: fakeStorage(new Uint8Array([9, 9, 9])), ffmpeg },
      { storageKey: 'clip.mp4' },
    );

    expect(res.mime).toBe('audio/wav');
    expect(Array.from(res.bytes)).toEqual(Array.from(wavBytes));
    // Se le pasó `-vn` (descartar vídeo) y el input materializado. `calls[0]` es la lista de argumentos
    // de la 1ª invocación; el runner recibe UN argumento (el array de args de ffmpeg) → `calls[0][0]`.
    const calledArgs = (ffmpeg as unknown as { mock: { calls: [string[]][] } }).mock.calls[0]?.[0];
    expect(calledArgs).toContain('-vn');
    expect(calledArgs?.some((a) => a.endsWith('in.mp4'))).toBe(true);
  });

  it('ffmpeg exit≠0 → AudioExtractionError con exitCode y stderr (NO FalResponseError)', async () => {
    const ffmpeg: FfmpegRunner = () =>
      Promise.resolve({ code: 1, stderr: 'Invalid data found when processing input' });

    const err = await extractAudioTrack(
      { storage: fakeStorage(new Uint8Array([1])), ffmpeg },
      { storageKey: 'broken.mp4' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AudioExtractionError);
    const ae = err as AudioExtractionError;
    expect(ae.exitCode).toBe(1);
    expect(ae.stderr).toMatch(/Invalid data/);
  });

  it('binario ausente (spawn error, code null) → AudioExtractionError con exitCode null', async () => {
    const ffmpeg: FfmpegRunner = () =>
      Promise.resolve({ code: null, stderr: 'spawn ffmpeg ENOENT' });

    const err = await extractAudioTrack(
      { storage: fakeStorage(new Uint8Array([1])), ffmpeg },
      { storageKey: 'clip.mp4' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AudioExtractionError);
    expect((err as AudioExtractionError).exitCode).toBeNull();
    expect((err as AudioExtractionError).stderr).toMatch(/ENOENT/);
  });

  it('ffmpeg produce un WAV de 0 bytes (clip sin pista de audio) → AudioExtractionError', async () => {
    const ffmpeg: FfmpegRunner = vi.fn(async (args: string[]) => {
      const outPath = args.at(-1) ?? '';
      await writeFile(outPath, new Uint8Array([])); // 0 bytes
      return { code: 0, stderr: '' };
    });

    const err = await extractAudioTrack(
      { storage: fakeStorage(new Uint8Array([1])), ffmpeg },
      { storageKey: 'silent.mp4' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AudioExtractionError);
    expect((err as AudioExtractionError).message).toMatch(/0 bytes/);
  });

  it('limpia los temps aunque ffmpeg falle (no deja basura en /tmp)', async () => {
    let capturedInPath = '';
    const ffmpeg: FfmpegRunner = (args: string[]) => {
      // Capturar el temp file de entrada (arg tras `-i`) para comprobar que se borró luego.
      const i = args.indexOf('-i');
      capturedInPath = args[i + 1] ?? '';
      return Promise.resolve({ code: 1, stderr: 'boom' });
    };

    await extractAudioTrack(
      { storage: fakeStorage(new Uint8Array([1])), ffmpeg },
      { storageKey: 'clip.mp4' },
    ).catch(() => undefined);

    // El temp de entrada ya no existe (el `finally` limpió el directorio entero).
    const stillThere = await readFile(capturedInPath).then(
      () => true,
      () => false,
    );
    expect(stillThere).toBe(false);
  });
});

describe('probeVideoDurationSeconds — medir duración con ffprobe (T4.7b)', () => {
  it('éxito: parsea la duración (segundos) del stdout de ffprobe', async () => {
    const ffprobe: FfprobeRunner = () =>
      Promise.resolve({ code: 0, stdout: '12.34\n', stderr: '' });

    const seconds = await probeVideoDurationSeconds(
      { storage: fakeStorage(new Uint8Array([9, 9, 9])), ffprobe },
      { storageKey: 'clip.mp4' },
    );

    expect(seconds).toBeCloseTo(12.34, 2);
  });

  it('pide format=duration a ffprobe sobre el input materializado', async () => {
    const ffprobe: FfprobeRunner = vi.fn(() =>
      Promise.resolve({ code: 0, stdout: '5\n', stderr: '' }),
    );

    await probeVideoDurationSeconds(
      { storage: fakeStorage(new Uint8Array([1])), ffprobe },
      { storageKey: 'clip.mp4' },
    );

    const args = (ffprobe as unknown as { mock: { calls: [string[]][] } }).mock.calls[0]?.[0];
    expect(args).toContain('format=duration');
    expect(args?.some((a) => a.endsWith('in.mp4'))).toBe(true);
  });

  it('ffprobe exit≠0 → VideoProbeError con exitCode y stderr (NO AudioExtractionError)', async () => {
    const ffprobe: FfprobeRunner = () =>
      Promise.resolve({ code: 1, stdout: '', stderr: 'Invalid data found when processing input' });

    const err = await probeVideoDurationSeconds(
      { storage: fakeStorage(new Uint8Array([1])), ffprobe },
      { storageKey: 'broken.mp4' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VideoProbeError);
    expect(err).not.toBeInstanceOf(AudioExtractionError);
    expect((err as VideoProbeError).exitCode).toBe(1);
    expect((err as VideoProbeError).stderr).toMatch(/Invalid data/);
  });

  it('stdout no parseable (vacío / no numérico) → VideoProbeError', async () => {
    const ffprobe: FfprobeRunner = () => Promise.resolve({ code: 0, stdout: 'N/A\n', stderr: '' });

    const err = await probeVideoDurationSeconds(
      { storage: fakeStorage(new Uint8Array([1])), ffprobe },
      { storageKey: 'clip.mp4' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VideoProbeError);
    expect((err as VideoProbeError).message).toMatch(/duración válida/);
  });

  it('duración cero o negativa → VideoProbeError (no una duración utilizable)', async () => {
    const ffprobe: FfprobeRunner = () => Promise.resolve({ code: 0, stdout: '0\n', stderr: '' });

    const err = await probeVideoDurationSeconds(
      { storage: fakeStorage(new Uint8Array([1])), ffprobe },
      { storageKey: 'clip.mp4' },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VideoProbeError);
  });

  it('limpia los temps aunque ffprobe falle (no deja basura en /tmp)', async () => {
    let capturedInPath = '';
    const ffprobe: FfprobeRunner = (args: string[]) => {
      capturedInPath = args.at(-1) ?? '';
      return Promise.resolve({ code: 1, stdout: '', stderr: 'boom' });
    };

    await probeVideoDurationSeconds(
      { storage: fakeStorage(new Uint8Array([1])), ffprobe },
      { storageKey: 'clip.mp4' },
    ).catch(() => undefined);

    const stillThere = await readFile(capturedInPath).then(
      () => true,
      () => false,
    );
    expect(stillThere).toBe(false);
  });
});
