// PLANNER DE ESCENAS §7.5 (T3.6) — assert (d): una escena que excede `maxDuration` produce el
// TROCEO esperado en el plan de generación, NO un error en runtime. Cubre contra el catálogo REAL
// (OmniHuman maxDuration:30, latentsync maxDuration:40) y con maxDuration sintéticas pequeñas para
// forzar el caso de 3 clips (unit-core.md §8 lo exige) sin depender del catálogo sembrado.
//
// La aritmética: `ceil(seconds / maxDuration)` clips de igual duración que suman `seconds`, cada
// uno ≤ maxDuration (la invariante primaria de §7.5). Ver la cabecera de scene-planner.ts para la
// reconciliación con la prosa "2 clips" de §7.5.
import { describe, expect, it } from 'vitest';
import type { AdScene } from '../../contracts/ad-script';
import { planScene, planGeneration, quantizeDurationToEnum } from './scene-planner';

function makeScene(overrides: Partial<AdScene> = {}): AdScene {
  return {
    t: 0,
    seconds: 5,
    segment: 'body',
    narration: 'apply the serum',
    visual: 'aplicación',
    camera: 'handheld',
    emotion: 'convencida',
    ...overrides,
  };
}

describe('planScene — troceo §7.5 (assert (d))', () => {
  // CONTROL NEGATIVO de (d): escena ≤ maxDuration ⇒ 1 clip (NO sobre-trocea).
  it('escena de 8s con maxDuration 30 (OmniHuman real) ⇒ 1 clip sin trocear', () => {
    const plan = planScene(makeScene({ seconds: 8 }), 30);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0]!.seconds).toBe(8);
    expect(plan.clips[0]!.clipCount).toBe(1);
  });

  it('escena EXACTAMENTE igual a maxDuration ⇒ 1 clip (frontera: no trocea)', () => {
    const plan = planScene(makeScene({ seconds: 30 }), 30);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0]!.seconds).toBe(30);
  });

  it('escena = maxDuration + epsilon ⇒ 2 clips (frontera: acaba de exceder)', () => {
    const plan = planScene(makeScene({ seconds: 30.5 }), 30);
    expect(plan.clips).toHaveLength(2);
    expect(plan.clips.every((c) => c.seconds <= 30)).toBe(true);
  });

  // El caso "2 clips" que la prosa de §7.5 nombra: escena > maxDuration y ≤ 2×maxDuration.
  it('escena de 12s con maxDuration 10 ⇒ 2 clips ≤10s que suman 12', () => {
    const plan = planScene(makeScene({ seconds: 12 }), 10);
    expect(plan.clips).toHaveLength(2);
    expect(plan.clips.every((c) => c.seconds <= 10)).toBe(true);
    expect(plan.clips.reduce((s, c) => s + c.seconds, 0)).toBeCloseTo(12, 6);
  });

  // El caso de 3 clips (unit-core.md §8): escena > 2×maxDuration. `ceil` lo produce y CADA clip
  // sigue ≤ maxDuration — que es lo que un tope duro de 2 clips VIOLARÍA.
  it('escena de 25s con maxDuration 10 ⇒ 3 clips ≤10s que suman 25 (no 2 clips de 12,5s)', () => {
    const plan = planScene(makeScene({ seconds: 25 }), 10);
    expect(plan.clips).toHaveLength(3);
    expect(plan.clips.every((c) => c.seconds <= 10)).toBe(true);
    expect(plan.clips.reduce((s, c) => s + c.seconds, 0)).toBeCloseTo(25, 6);
  });

  it('los clips troceados encadenan su ventana temporal desde t de la escena', () => {
    const plan = planScene(makeScene({ t: 3, seconds: 24 }), 10);
    expect(plan.clips).toHaveLength(3);
    expect(plan.clips[0]!.t).toBe(3);
    expect(plan.clips[1]!.t).toBeCloseTo(3 + 8, 6);
    expect(plan.clips[2]!.t).toBeCloseTo(3 + 16, 6);
    // clipIndex/clipCount marcados para que N7 sepa que es un troceo.
    expect(plan.clips.map((c) => c.clipIndex)).toEqual([0, 1, 2]);
    expect(plan.clips.every((c) => c.clipCount === 3)).toBe(true);
  });

  it('sin maxDuration (el modelo no declara tope) ⇒ 1 clip con la duración completa', () => {
    const plan = planScene(makeScene({ seconds: 90 }), undefined);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0]!.seconds).toBe(90);
  });

  it('preserva el segment de la escena en cada clip', () => {
    const plan = planScene(makeScene({ segment: 'hook', seconds: 25 }), 10);
    expect(plan.clips.every((c) => c.segment === 'hook')).toBe(true);
  });
});

describe('quantizeDurationToEnum — cuantización al enum del modelo (T4.8, N7d)', () => {
  const VEO_I2V = [4, 6, 8] as const;

  it('redondea HACIA ARRIBA al valor mínimo del enum ≥ seconds', () => {
    expect(quantizeDurationToEnum(5, VEO_I2V)).toBe(6);
    expect(quantizeDurationToEnum(7, VEO_I2V)).toBe(8);
    expect(quantizeDurationToEnum(4.1, VEO_I2V)).toBe(6);
  });

  it('un valor EXACTO del enum se devuelve tal cual (no salta al siguiente)', () => {
    expect(quantizeDurationToEnum(4, VEO_I2V)).toBe(4);
    expect(quantizeDurationToEnum(6, VEO_I2V)).toBe(6);
    expect(quantizeDurationToEnum(8, VEO_I2V)).toBe(8);
  });

  it('por debajo del mínimo del enum ⇒ el mínimo (nunca baja de 4s)', () => {
    expect(quantizeDurationToEnum(2, VEO_I2V)).toBe(4);
    expect(quantizeDurationToEnum(0.5, VEO_I2V)).toBe(4);
  });

  it('por encima del máximo del enum ⇒ clamp al máximo (defensa; el troceo ya topa a max)', () => {
    expect(quantizeDurationToEnum(9, VEO_I2V)).toBe(8);
    expect(quantizeDurationToEnum(100, VEO_I2V)).toBe(8);
  });

  it('enum de un solo valor (Veo R2V, fijo 8s) ⇒ SIEMPRE ese valor', () => {
    expect(quantizeDurationToEnum(3, [8])).toBe(8);
    expect(quantizeDurationToEnum(8, [8])).toBe(8);
    expect(quantizeDurationToEnum(12, [8])).toBe(8);
  });

  it('enum desordenado se ordena antes de cuantizar (no depende del orden del catálogo)', () => {
    expect(quantizeDurationToEnum(5, [8, 4, 6])).toBe(6);
  });

  it('enum vacío es un bug de datos → lanza (no un default silencioso)', () => {
    expect(() => quantizeDurationToEnum(5, [])).toThrow(/vacío/);
  });
});

describe('planGeneration — plan de guion completo', () => {
  it('trocea solo las escenas que exceden maxDuration y aplana los clips en orden', () => {
    const scenes: AdScene[] = [
      makeScene({ t: 0, seconds: 5, segment: 'hook' }),
      makeScene({ t: 5, seconds: 25, segment: 'body' }), // se trocea en 3 con maxDuration 10
      makeScene({ t: 30, seconds: 4, segment: 'cta' }),
    ];
    const plan = planGeneration(scenes, 10);
    expect(plan.scenes.map((sp) => sp.clips.length)).toEqual([1, 3, 1]);
    expect(plan.clips).toHaveLength(5);
    // Ningún clip excede maxDuration (§7.5 invariante primaria).
    expect(plan.clips.every((c) => c.seconds <= 10)).toBe(true);
  });
});
