// T5.8c · el troceo §7.5 dimensionado contra la narración MEDIDA (N7b), no contra la estimada del guion.
// LA CLÁUSULA que estos tests fijan (Verificación de T5.8c, «Playwright/tests»): «Σ duración de los clips
// de una escena ≥ narración real». Sin `sizeScenesToNarration` la Σ es la de la ESTIMACIÓN del guion
// (`countWords/2.5`), que el TTS real desborda → 1 clip de 8s contra 8.68s de narración → `FitError`.
import { describe, expect, test } from 'vitest';

import type { AdScene } from '../../contracts/ad-script';

import { segmentSceneIndices, sizeScenesToNarration } from './narration-sizing';
import { planGeneration, quantizeDurationToEnum } from './scene-planner';

function scene(over: Partial<AdScene> & Pick<AdScene, 'segment' | 'seconds'>): AdScene {
  return {
    t: 0,
    narration: 'narración',
    visual: 'visual',
    camera: 'camera',
    emotion: 'neutral',
    ...over,
  };
}

/** El enum REAL de veo3.1 i2v (`durations:[4,6,8]`, maxDuration 8) — el catálogo que rompió T5.9. */
const VEO_DURATIONS = [4, 6, 8] as const;
const VEO_MAX_DURATION = 8;

describe('sizeScenesToNarration — la aritmética por escena', () => {
  /** Una escena de body en el absoluto 0, sizeada contra la medida `m` (o sin medida si `m` es undefined). */
  const sizeOne = (estimated: number, m?: number): number => {
    const measured = new Map<number, number>(m === undefined ? [] : [[0, m]]);
    return sizeScenesToNarration(
      [scene({ segment: 'body', seconds: estimated })],
      [0],
      measured,
    )[0]!.seconds;
  };

  test('agranda la escena a la narración MEDIDA cuando la estimación se queda corta', () => {
    expect(sizeOne(6, 8.68)).toBe(8.68);
  });

  test('NUNCA encoge: una narración más corta que la estimación deja la escena intacta', () => {
    expect(sizeOne(6, 3.2)).toBe(6);
  });

  test('ignora medidas ausentes o no finitas (N7b sin cablear / probe corrupto)', () => {
    expect(sizeOne(6, undefined)).toBe(6);
    expect(sizeOne(6, Number.NaN)).toBe(6);
    expect(sizeOne(6, Number.POSITIVE_INFINITY)).toBe(6);
    expect(sizeOne(6, 0)).toBe(6);
  });

  test('`scene.t` NO se recalcula (deuda declarada en el docblock: nadie lo consume aguas abajo)', () => {
    const sized = sizeScenesToNarration(
      [scene({ segment: 'body', seconds: 6, t: 4 })],
      [0],
      new Map([[0, 8.68]]),
    );
    expect(sized[0]?.t).toBe(4);
  });
});

describe('segmentSceneIndices', () => {
  test('mapea el ordinal FILTRADO al índice ABSOLUTO del guion (hook·body·cta·body)', () => {
    const scenes = [
      scene({ segment: 'hook', seconds: 3 }),
      scene({ segment: 'body', seconds: 6 }),
      scene({ segment: 'cta', seconds: 3 }),
      scene({ segment: 'body', seconds: 6 }),
    ];
    expect(segmentSceneIndices(scenes, 'body')).toEqual([1, 3]);
    expect(segmentSceneIndices(scenes, 'cta')).toEqual([2]);
    expect(segmentSceneIndices(scenes, 'hook')).toEqual([0]);
  });
});

describe('Σ clips ≥ narración real (la cláusula de T5.8c)', () => {
  // El caso EXACTO del run real de T5.9 (`01KYA3ZFF5QQ5BQVRWW3Y93QQ0`): guion estima 6s para la escena de
  // body, el TTS real mide 8.68s. veo3.1 topa el clip a 8s → un solo clip NUNCA cubre la narración.
  const ESTIMATED_S = 6;
  const MEASURED_S = 8.68;

  function sumQuantizedClips(sceneSeconds: number): number {
    const plan = planGeneration(
      [scene({ segment: 'body', seconds: sceneSeconds })],
      VEO_MAX_DURATION,
    );
    return plan.clips.reduce(
      (acc, clip) => acc + quantizeDurationToEnum(clip.seconds, [...VEO_DURATIONS]),
      0,
    );
  }

  test('CONTROL NEGATIVO: dimensionar por la ESTIMACIÓN deja Σ clips < narración (el bug de T5.9)', () => {
    const plan = planGeneration(
      [scene({ segment: 'body', seconds: ESTIMATED_S })],
      VEO_MAX_DURATION,
    );
    expect(plan.clips).toHaveLength(1);
    // 1 clip de 6s contra 8.68s de narración = déficit 2.68s ≥ MAX_HOLD_DEFICIT_S (0.5) → FitError.
    expect(sumQuantizedClips(ESTIMATED_S)).toBeLessThan(MEASURED_S);
  });

  test('dimensionar por la narración MEDIDA produce ≥2 clips cuya Σ CUBRE la narración', () => {
    const scenes = [scene({ segment: 'body', seconds: ESTIMATED_S })];
    const sized = sizeScenesToNarration(scenes, [0], new Map([[0, MEASURED_S]]));
    const plan = planGeneration(sized, VEO_MAX_DURATION);

    expect(plan.clips.length).toBeGreaterThanOrEqual(2);
    expect(sumQuantizedClips(MEASURED_S)).toBeGreaterThanOrEqual(MEASURED_S);
    // Cada clip sigue respetando el tope del modelo (invariante §7.5 intacta).
    for (const clip of plan.clips) expect(clip.seconds).toBeLessThanOrEqual(VEO_MAX_DURATION);
    // Los `clipIndex` siguen siendo 0..n-1 → el salt de dedup `bodySceneIndex:clipIndex` no cambia.
    expect(plan.clips.map((c) => c.clipIndex)).toEqual([0, 1]);
  });

  test('el mapeo filtrado→absoluto sizea la escena de body correcta (no la voz de otra escena)', () => {
    // hook(3s) · body(6s) · cta(3s): N7b mide la voz del BODY (absoluto 1) en 8.68s.
    const scenes = [
      scene({ segment: 'hook', seconds: 3 }),
      scene({ segment: 'body', seconds: ESTIMATED_S }),
      scene({ segment: 'cta', seconds: 3 }),
    ];
    const bodyScenes = scenes.filter((s) => s.segment === 'body');
    const sized = sizeScenesToNarration(
      bodyScenes,
      segmentSceneIndices(scenes, 'body'),
      new Map([
        [0, 3.1],
        [1, MEASURED_S],
        [2, 2.9],
      ]),
    );
    expect(sized[0]?.seconds).toBe(MEASURED_S);
    expect(planGeneration(sized, VEO_MAX_DURATION).clips.length).toBeGreaterThanOrEqual(2);
  });
});
