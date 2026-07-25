// Suite MEDIA del CONCAT INTRA-ESCENA (T5.8c, §7.5; media-composition.md §"Entorno"). Corre ffmpeg de
// VERDAD — la única forma honesta de verificar que la cadena `concat → fit` produce lo que T5.8c promete.
// El bug de T5.8a fue exactamente probar el builder de STRINGS sin ffmpeg: aquí se prueba el fichero.
//
// EL CASO REAL QUE ARREGLA (run de T5.9, `01KYA3ZFF5QQ5BQVRWW3Y93QQ0`): una escena de body con narración de
// 8,68 s cuyo clip de vídeo mide 6 s. veo3.1 topa el clip a 8 s → un solo clip NUNCA cubre la narración →
// `fitSegmentFile` lanza `FitError` (correctamente, anti-T1.8) y N8 no compone NADA. §7.5 ya trocea la
// escena en 2 clips y N7d los genera Y LOS PAGA los dos, pero la composición usaba solo el `clipIndex 0`.
//
// LOS TRES CASOS (la Verificación de T5.8c, cláusula de composición + control negativo):
//   (a) 2 clips (6 s + 6 s) concatenados = 12 s ≥ narración 8,68 s → el fitter RECORTA a 8,68 s. SIN FitError.
//   (b) el vídeo de escena concatenado dura EXACTAMENTE la suma de sus clips (ningún clip se pierde).
//   (c) CONTROL NEGATIVO: UN SOLO clip de 6 s contra la misma narración de 8,68 s → `FitError` SIGUE
//       MORDIENDO. El fix no relaja el umbral de 0,5 s: hace que el vídeo cubra la narración.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { concatSceneClipsFile, FitError, fitSegmentFile } from '@ugc/services';
import { ffprobeJson, makeTestVideo } from '@ugc/test-utils/media';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { mediaToolsAvailable } from './setup';

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ugc-scene-concat-media-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
});

const p = (name: string): string => join(workDir, name);

async function durationOf(file: string): Promise<number> {
  const probe = await ffprobeJson(file);
  return Number(probe.format.duration);
}

/** El caso REAL del run de T5.9: narración medida 8,68 s, clips de b-roll topados a 6 s por el modelo. */
const NARRATION_S = 8.68;
const CLIP_S = 6;

describe.skipIf(!mediaToolsAvailable)('concat intra-escena antes del fitter (T5.8c)', () => {
  test('escena troceada: 2 clips concatenados CUBREN la narración → el fitter RECORTA, sin FitError', async () => {
    // `testsrc2` (con MOVIMIENTO, no color sólido): un concat mal hecho —p.ej. usando solo un clip— se
    // distinguiría por la duración, y el movimiento garantiza que los frames del 2º clip son contenido real.
    const clip0 = await makeTestVideo({ out: p('c0.mp4'), seconds: CLIP_S, fps: 30 });
    const clip1 = await makeTestVideo({ out: p('c1.mp4'), seconds: CLIP_S, fps: 30 });

    const scenePath = p('scene.mp4');
    await concatSceneClipsFile({}, { inPaths: [clip0, clip1], outPath: scenePath });

    // (b) El vídeo de escena dura la SUMA de sus clips: ninguno se perdió (la fuga de dinero cerrada, medida
    //     en segundos de vídeo real, no en refs de BD).
    const sceneDuration = await durationOf(scenePath);
    expect(sceneDuration).toBeGreaterThanOrEqual(CLIP_S * 2 - 0.15);
    expect(sceneDuration).toBeLessThanOrEqual(CLIP_S * 2 + 0.15);
    // Y por tanto CUBRE la narración que un solo clip no cubría.
    expect(sceneDuration).toBeGreaterThan(NARRATION_S);

    // (a) El fitter, sobre el vídeo de ESCENA, recorta (plan `trim`) en vez de lanzar.
    const fittedPath = p('fitted.mp4');
    const fitted = await fitSegmentFile(
      {},
      { inPath: scenePath, outPath: fittedPath, narrationDurationS: NARRATION_S },
    );
    expect(fitted.plan.kind).toBe('trim');
    const fittedDuration = await durationOf(fittedPath);
    expect(fittedDuration).toBeGreaterThanOrEqual(NARRATION_S - 0.1);
    expect(fittedDuration).toBeLessThanOrEqual(NARRATION_S + 0.1);
  });

  test('CONTROL NEGATIVO: UN SOLO clip corto contra la MISMA narración → FitError SIGUE mordiendo', async () => {
    // El mismo clip de 6 s y la misma narración de 8,68 s, pero SIN el 2º clip que concatenar (el desajuste
    // reintroducido). El umbral de 0,5 s NO se relajó: déficit 2,68 s → FitError. Si este test se pusiera
    // verde, el fix habría tapado el bug en vez de arreglarlo (anti-T1.8, principio 9).
    const lonely = await makeTestVideo({ out: p('lonely.mp4'), seconds: CLIP_S, fps: 30 });
    await expect(
      fitSegmentFile(
        {},
        { inPath: lonely, outPath: p('lonely-fitted.mp4'), narrationDurationS: NARRATION_S },
      ),
    ).rejects.toBeInstanceOf(FitError);
  });

  test('3 clips: el concat escala a cualquier troceo §7.5 y preserva el ORDEN temporal', async () => {
    // Colores DISTINTOS por clip → el orden es observable en el fichero (no solo en los args).
    const a = await makeTestVideo({ out: p('o-a.mp4'), seconds: 2, fps: 30, color: 'red' });
    const b = await makeTestVideo({ out: p('o-b.mp4'), seconds: 2, fps: 30, color: 'green' });
    const c = await makeTestVideo({ out: p('o-c.mp4'), seconds: 2, fps: 30, color: 'blue' });

    const out = p('scene-3.mp4');
    await concatSceneClipsFile({}, { inPaths: [a, b, c], outPath: out });

    const d = await durationOf(out);
    expect(d).toBeGreaterThanOrEqual(6 - 0.2);
    expect(d).toBeLessThanOrEqual(6 + 0.2);
  });
});
