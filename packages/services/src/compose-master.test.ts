// Unit tests de los BUILDERS PUROS de `compose-master` (T5.3): filtergraphs + args de concat. Corren en el
// gate (services:unit, SIN ffmpeg). Los tests de COMPORTAMIENTO (loudness real, ducking ≥6 dB, duración
// del concat) viven en la suite media (`apps/worker/test/media`, con ffmpeg de la imagen del worker).
//
// Estos asserts protegen las cláusulas DETERMINISTAS de la Verificación como tests permanentes (regla 8):
// que el concat use `-c copy` (sin re-encode → sin glitches) y que el graph de mezcla contenga
// `sidechaincompress` + `loudnorm I=-14` + `afade` según el spec.
import type { StorageAdapter } from '@ugc/core';
import type { CompositionSpec } from '@ugc/core/contracts';
import { newUlid } from '@ugc/core/contracts';
import { describe, expect, test } from 'vitest';

import {
  buildAudioConcatArgs,
  buildAudioMixGraph,
  buildConcatArgs,
  buildConcatListFile,
  buildDuckingGraph,
  buildMuxArgs,
  ComposeError,
  composeMaster,
  DUCKING_PARAMS,
  LOUDNORM_TARGET_I,
} from './compose-master';
import type { FfmpegRunner } from './extract-audio-track';

/** Storage EN MEMORIA (sin fs): `get` devuelve unos bytes cualesquiera como ReadableStream web. Basta para
 *  el test de error, que falla en el ffmpeg del concat ANTES de decodificar nada. */
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

describe('buildConcatArgs — concat demuxer con -c copy (T5.3)', () => {
  const args = buildConcatArgs('/tmp/list.txt', '/tmp/out.mp4');

  test('usa el concat DEMUXER (-f concat -safe 0), no el filtro concat', () => {
    expect(args).toContain('-f');
    expect(args[args.indexOf('-f') + 1]).toBe('concat');
    expect(args).toContain('-safe');
  });

  test('copia el vídeo SIN re-encode (-c:v copy) — la cláusula determinista de la Verificación', () => {
    const i = args.indexOf('-c:v');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('copy');
  });

  test('descarta el audio del concat de vídeo (-an): los normalizados van -an y el audio se mezcla aparte', () => {
    expect(args).toContain('-an');
  });
});

describe('buildConcatListFile — sintaxis del fichero de lista', () => {
  test('una línea file por segmento en orden', () => {
    const list = buildConcatListFile(['/a/seg-0.mp4', '/a/seg-1.mp4']);
    expect(list).toBe("file '/a/seg-0.mp4'\nfile '/a/seg-1.mp4'\n");
  });

  test('escapa las comillas simples en los paths', () => {
    const list = buildConcatListFile(["/a/it's.mp4"]);
    expect(list).toBe(String.raw`file '/a/it'\''s.mp4'` + '\n');
  });
});

describe('buildAudioConcatArgs — concat de la voz', () => {
  const args = buildAudioConcatArgs('/tmp/v.txt', '/tmp/voice.m4a');
  test('copia el audio sin re-encode y descarta vídeo', () => {
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    expect(args).toContain('-vn');
  });
});

describe('buildDuckingGraph — la MISMA pieza que renderiza el test de ducking (principio 9)', () => {
  test('conecta bed+voz por sidechaincompress con los PARÁMETROS de producción', () => {
    const graph = buildDuckingGraph({ bedLabel: '0:a', voiceLabel: '1:a', outLabel: 'ducked' });
    // T5.8a: el bed se estampa con `aformat=channel_layouts=stereo` ADYACENTE al sidechain (a un label
    // intermedio `bedfmt`) — sidechaincompress no negocia formatos con un main input `channel_layout=unknown`.
    expect(graph).toBe(
      `[0:a]aformat=channel_layouts=stereo[bedfmt];` +
        `[bedfmt][1:a]sidechaincompress=threshold=${String(DUCKING_PARAMS.threshold)}:` +
        `ratio=${String(DUCKING_PARAMS.ratio)}:attack=${String(DUCKING_PARAMS.attack)}:` +
        `release=${String(DUCKING_PARAMS.release)}:makeup=${String(DUCKING_PARAMS.makeup)}[ducked]`,
    );
  });

  test('T5.8a: estampa el channel_layout del bed ANTES del sidechaincompress (regresión de producción)', () => {
    // Guarda determinista del fix (regla de trabajo 8): el `aformat` DEBE preceder al `sidechaincompress` en
    // la rama del bed. Si alguien reordena y el aformat cae después (o desaparece), el bed `unknown` de
    // ace-step rompe el mux → este assert de gate lo caza sin ffmpeg.
    const graph = buildDuckingGraph({ bedLabel: 'bedvol', voiceLabel: '1:a', outLabel: 'ducked' });
    expect(graph).toContain('aformat=channel_layouts=stereo');
    expect(graph.indexOf('aformat=channel_layouts=stereo')).toBeLessThan(
      graph.indexOf('sidechaincompress='),
    );
  });

  test('las labels son parametrizables (test usa 0:a/1:a; producción sus propias labels)', () => {
    const graph = buildDuckingGraph({ bedLabel: 'bedvol', voiceLabel: '0:a', outLabel: 'ducked' });
    // La rama del bed arranca en `[bedvol]` (su aformat), la voz entra como sidechain, y cierra en [ducked].
    expect(graph.startsWith('[bedvol]aformat=channel_layouts=stereo')).toBe(true);
    expect(graph).toContain('[0:a]sidechaincompress=');
    expect(graph.endsWith('[ducked]')).toBe(true);
  });
});

describe('buildAudioMixGraph — la mezcla completa (§9.7)', () => {
  // El mux antepone el vídeo como input 0 → la voz es 1:a y el bed 2:a (los índices NO empiezan en 0).
  const inputs = { voiceInput: '1:a', bedInput: '2:a' };

  test('con bed + ducking: volume + sidechaincompress + afade out + loudnorm I=-14', () => {
    const graph = buildAudioMixGraph({
      hasBed: true,
      ...inputs,
      volume: 0.25,
      ducking: true,
      fadeOutS: 1.5,
      fadeStartS: 28.5,
    });
    expect(graph).toContain('volume=0.25');
    expect(graph).toContain('sidechaincompress=');
    expect(graph).toContain('afade=t=out:st=28.5:d=1.5');
    expect(graph).toContain(`loudnorm=I=${String(LOUDNORM_TARGET_I)}`);
  });

  test('referencia la voz/bed por los índices de audio del mux (1:a / 2:a), no 0:a/1:a', () => {
    const graph = buildAudioMixGraph({
      hasBed: true,
      ...inputs,
      volume: 0.25,
      ducking: true,
      fadeOutS: 1,
      fadeStartS: 8,
    });
    // El bed escala desde 2:a y la voz (sidechain + amix) desde 1:a — si se cablearan a 0:a/1:a, ffmpeg
    // fallaría con «Stream specifier :a matches no streams» (el input 0 es el vídeo, sin audio).
    expect(graph).toContain('[2:a]volume=');
    expect(graph).toContain('[1:a]'); // voz como sidechain / en el amix
    expect(graph).not.toContain('[0:a]');
  });

  test('con bed SIN ducking: no aparece sidechaincompress pero sí volume + loudnorm', () => {
    const graph = buildAudioMixGraph({
      hasBed: true,
      ...inputs,
      volume: 0.2,
      ducking: false,
      fadeOutS: 0,
      fadeStartS: 0,
    });
    expect(graph).toContain('volume=0.2');
    expect(graph).not.toContain('sidechaincompress');
    expect(graph).not.toContain('afade'); // fadeOutS=0 → sin fade
    expect(graph).toContain('loudnorm=');
  });

  test('sin bed (solo voz): la voz (1:a) se normaliza directa a loudnorm, sin volume/amix', () => {
    const graph = buildAudioMixGraph({
      hasBed: false,
      ...inputs,
      volume: 0,
      ducking: false,
      fadeOutS: 0,
      fadeStartS: 0,
    });
    expect(graph).toBe(`[1:a]loudnorm=I=${String(LOUDNORM_TARGET_I)}:TP=-1.5:LRA=11[mix]`);
    expect(graph).not.toContain('amix');
  });
});

describe('buildMuxArgs — el mux final del máster', () => {
  test('con bed: 3 inputs (vídeo, voz, bed), copia vídeo, re-encoda audio a AAC 48k', () => {
    const args = buildMuxArgs({
      videoPath: '/v.mp4',
      voicePath: '/voice.m4a',
      bedPath: '/bed.m4a',
      filterComplex: '[1:a]anull[mix]',
      durationS: 9,
      outPath: '/out.mp4',
    });
    expect(args.filter((a) => a === '-i')).toHaveLength(3);
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args).toContain('[mix]'); // se mapea la salida de la mezcla
  });

  test('sin bed: 2 inputs (vídeo, voz)', () => {
    const args = buildMuxArgs({
      videoPath: '/v.mp4',
      voicePath: '/voice.m4a',
      bedPath: null,
      filterComplex: '[1:a]loudnorm[mix]',
      durationS: 9,
      outPath: '/out.mp4',
    });
    expect(args.filter((a) => a === '-i')).toHaveLength(2);
  });

  test('fija la longitud con -t a la duración del vídeo (autoritativo), NO -shortest', () => {
    // -shortest recortaría el máster si la voz/bed fueran más cortos que el vídeo (un voiceover suele
    // serlo) → se perdería el final del vídeo. `-t <duración del vídeo>` lo preserva entero.
    const args = buildMuxArgs({
      videoPath: '/v.mp4',
      voicePath: '/voice.m4a',
      bedPath: null,
      filterComplex: '[1:a]loudnorm[mix]',
      durationS: 8.5,
      outPath: '/out.mp4',
    });
    expect(args).not.toContain('-shortest');
    expect(args[args.indexOf('-t') + 1]).toBe('8.500');
  });
});

describe('composeMaster — clase de error PROPIA (anti-T1.8)', () => {
  test('un ffmpeg con exit≠0 → ComposeError (no un error genérico ni de otra capa)', async () => {
    const storage = makeMemoryStorage();
    // Runner que SIEMPRE falla (simula un ffmpeg que rechaza el input). No hace shell-out real → corre en
    // el gate (services:unit, sin ffmpeg). El fallo ocurre en el PRIMER paso (concat de vídeo).
    const failingRunner: FfmpegRunner = () =>
      Promise.resolve({ code: 1, stderr: 'boom: bad input' });
    const spec: CompositionSpec = {
      segments: [{ type: 'hook', videoAsset: newUlid(), voAudio: newUlid() }],
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 9 },
    };
    await expect(
      composeMaster({ storage, resolveAssetKey: (id) => id, runner: failingRunner }, spec),
    ).rejects.toBeInstanceOf(ComposeError);
  });
});
