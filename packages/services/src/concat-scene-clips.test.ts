// Unit del CONCAT INTRA-ESCENA (T5.8c, gate `services:unit`, SIN ffmpeg). Ejerce el builder PURO de args y
// el wrapper file-in/file-out con runner inyectado. El comportamiento REAL sobre media (que el vídeo
// concatenado dura Σ(clips) y que por tanto el fitter recorta en vez de lanzar `FitError`) lo prueba la
// suite media con ffmpeg REAL (`apps/worker/test/media/concat-scene-clips.test.ts`, `RUN_MEDIA=1`) — el
// grafo de strings solo no verifica composición (la lección de T5.8a).
import { describe, expect, test, vi } from 'vitest';

import { buildSceneConcatArgs, concatSceneClipsFile, SceneConcatError } from './concat-scene-clips';
import { buildFitArgs, INTERMEDIATE_ENCODE_ARGS } from './fit-segment';

describe('buildSceneConcatArgs', () => {
  test('encadena los inputs EN ORDEN y usa el filtro concat de solo vídeo', () => {
    const args = buildSceneConcatArgs({ inPaths: ['/a.mp4', '/b.mp4'], outPath: '/out.mp4' });

    // Los `-i` van en el orden recibido (= orden de `clipIndex` = orden temporal).
    expect(args.filter((_a, i) => args[i - 1] === '-i')).toEqual(['/a.mp4', '/b.mp4']);
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toBe('[0:v][1:v]concat=n=2:v=1:a=0[v]');
    expect(args).toContain('-an'); // b-roll/CTA son silenciosos; la voz la mezcla composeMaster
    expect(args.at(-1)).toBe('/out.mp4');
  });

  test('escala a 3+ clips (una escena puede necesitar más de 2, §7.5)', () => {
    const args = buildSceneConcatArgs({
      inPaths: ['/a.mp4', '/b.mp4', '/c.mp4'],
      outPath: '/o.mp4',
    });
    expect(args[args.indexOf('-filter_complex') + 1]).toBe('[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]');
  });

  test('re-encoda casi-lossless (NO `-c copy`): los clips CRUDOS de N7 no son uniformes', () => {
    const args = buildSceneConcatArgs({ inPaths: ['/a.mp4', '/b.mp4'], outPath: '/o.mp4' });
    expect(args).not.toContain('copy');
    expect(args.join(' ')).toContain(INTERMEDIATE_ENCODE_ARGS.join(' '));
  });

  test('usa EL MISMO perfil de intermedios que el fitter (una sola verdad, no dos tuplas)', () => {
    // La cabecera del módulo afirma «mismo perfil que buildFitArgs». Este test lo hace VERDAD: si alguien
    // cambiara el perfil en un sitio y no en el otro, la cadena metería un cambio de perfil silencioso
    // entre el concat intra-escena y el fitter.
    const concat = buildSceneConcatArgs({ inPaths: ['/a.mp4', '/b.mp4'], outPath: '/o.mp4' });
    const fit = buildFitArgs({
      inPath: '/a.mp4',
      outPath: '/o.mp4',
      plan: { kind: 'trim', targetS: 3 },
    });
    for (const args of [concat, fit]) {
      expect(args.join(' ')).toContain(INTERMEDIATE_ENCODE_ARGS.join(' '));
    }
  });

  test('LANZA con <2 clips: un segmento de un solo clip NO pasa por el concat', () => {
    expect(() => buildSceneConcatArgs({ inPaths: ['/a.mp4'], outPath: '/o.mp4' })).toThrow(
      SceneConcatError,
    );
    expect(() => buildSceneConcatArgs({ inPaths: [], outPath: '/o.mp4' })).toThrow(
      SceneConcatError,
    );
  });
});

describe('concatSceneClipsFile', () => {
  test('invoca ffmpeg UNA vez y resuelve cuando sale con código 0', async () => {
    const runner = vi.fn().mockResolvedValue({ code: 0, stderr: '' });
    await concatSceneClipsFile({ runner }, { inPaths: ['/a.mp4', '/b.mp4'], outPath: '/o.mp4' });
    expect(runner).toHaveBeenCalledTimes(1);
    // El out del comando ES el `outPath` pedido (el caller lo conoce; la función no lo devuelve).
    expect((runner.mock.calls[0]?.[0] as string[]).at(-1)).toBe('/o.mp4');
  });

  test('LANZA SceneConcatError con exitCode+stderr si ffmpeg falla (clase propia, anti-T1.8)', async () => {
    const runner = vi.fn().mockResolvedValue({ code: 1, stderr: 'boom: invalid data' });
    await expect(
      concatSceneClipsFile({ runner }, { inPaths: ['/a.mp4', '/b.mp4'], outPath: '/o.mp4' }),
    ).rejects.toMatchObject({ name: 'SceneConcatError', exitCode: 1 });
  });
});
