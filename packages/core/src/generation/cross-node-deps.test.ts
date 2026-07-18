// Unit del resolver CROSS-NODE (T4.11, §9.6). LÓGICA PURA. Prueba que N7c deriva SU audio de la dep N7b
// y N7d SUS keyframes de la dep N7a — discriminando por SCHEMA — y que un cross-node roto REVIENTA antes
// de gastar. El aislamiento por variante REAL (A no consume B) se prueba en integración (con el consumer
// resolviendo `ctx.deps` desde `step.dependsOn`); aquí se cubre la unidad pura.
import { describe, expect, it } from 'vitest';
import { PermanentStepError } from '../orchestrator/executor';
import { deriveHookAudioAssetId, deriveKeyframeAssetIds, findN7bDep } from './cross-node-deps';
import type { N7aOutput, N7bOutput } from '../contracts/step-outputs';

function n7bDep(output: N7bOutput): { outputRefs: unknown } {
  return { outputRefs: output };
}
function n7aDep(output: N7aOutput): { outputRefs: unknown } {
  return { outputRefs: output };
}

const N7B: N7bOutput = {
  scriptId: 'script_A',
  language: 'es',
  clips: [
    {
      sceneIndex: 0,
      generationId: 'g0',
      assetId: 'audio_hook_A',
      durationSeconds: 4,
      wordCount: 8,
      ttsCostCents: 1,
      asrCostCents: 1,
    },
    {
      sceneIndex: 1,
      generationId: 'g1',
      assetId: 'audio_body_A',
      durationSeconds: 6,
      wordCount: 12,
      ttsCostCents: 1,
      asrCostCents: 1,
    },
  ],
};
const N7A: N7aOutput = {
  route: 'ai_packshot',
  syntheticProduct: true,
  shots: [
    { generationId: 'gA', assetId: 'keyframe_A0', costCents: 2 },
    { generationId: 'gB', assetId: 'keyframe_A1', costCents: 2 },
  ],
};

/** La dep N7b resuelta (con el guard de ambigüedad de `findN7bDep`), que `deriveHookAudioAssetId`
 *  consume. Lanza en el propio test si el resolver no la encuentra (evita el `!` en cada assert). */
function resolveN7b(deps: readonly { outputRefs: unknown }[]): N7bOutput {
  const n7b = findN7bDep(deps);
  if (n7b === undefined) throw new Error('test setup: no N7b dep resolved');
  return n7b;
}

describe('findN7bDep (descubrimiento de la dep N7b, discriminación por SCHEMA)', () => {
  it('sin dep N7b (path stepless) → undefined (el executor cae a su config)', () => {
    expect(findN7bDep([])).toBeUndefined();
    // Una dep que NO valida como N7b (otro artefacto) tampoco cuenta.
    expect(findN7bDep([{ outputRefs: { foo: 'bar' } }])).toBeUndefined();
  });

  it('discrimina por SCHEMA: ignora una dep N7a y encuentra la N7b entre varias', () => {
    expect(findN7bDep([n7aDep(N7A), n7bDep(N7B)])?.scriptId).toBe('script_A');
  });

  it('DOS deps que validan como N7b → PermanentStepError (cableado ambiguo)', () => {
    expect(() => findN7bDep([n7bDep(N7B), n7bDep(N7B)])).toThrow(PermanentStepError);
  });
});

describe('deriveHookAudioAssetId (N7c ← N7b, sobre el output ya resuelto)', () => {
  it('elige el audio de la escena del HOOK por su sceneIndex, NO ciegamente clips[0]', () => {
    // Si el hook fuese la escena 1 (no la 0), el audio correcto es el de la escena 1.
    expect(deriveHookAudioAssetId(N7B, 1)).toBe('audio_body_A');
    // Y con el hook en la escena 0, el de la 0.
    expect(deriveHookAudioAssetId(N7B, 0)).toBe('audio_hook_A');
  });

  it('output N7b SIN el clip del hook → PermanentStepError (no anima con audio equivocado)', () => {
    // El hook pide sceneIndex 5, que N7b no cubrió: reventar ANTES de gastar en vídeo.
    expect(() => deriveHookAudioAssetId(N7B, 5)).toThrow(PermanentStepError);
  });

  it('encadenado con findN7bDep (el camino real del executor N7c)', () => {
    expect(deriveHookAudioAssetId(resolveN7b([n7aDep(N7A), n7bDep(N7B)]), 0)).toBe('audio_hook_A');
  });
});

describe('deriveKeyframeAssetIds (N7d ← N7a)', () => {
  it('deriva TODOS los assetId de los shots de la dep N7a', () => {
    expect(deriveKeyframeAssetIds([n7aDep(N7A)])).toEqual(['keyframe_A0', 'keyframe_A1']);
  });

  it('sin dep N7a (stepless) → undefined (el executor cae a su config)', () => {
    expect(deriveKeyframeAssetIds([])).toBeUndefined();
    expect(deriveKeyframeAssetIds([{ outputRefs: { nope: 1 } }])).toBeUndefined();
  });

  it('dep N7a sin shots → PermanentStepError (b-roll i2v sin keyframe no se genera)', () => {
    const empty: N7aOutput = { route: 'ai_packshot', syntheticProduct: true, shots: [] };
    expect(() => deriveKeyframeAssetIds([n7aDep(empty)])).toThrow(PermanentStepError);
  });

  it('discrimina por SCHEMA: ignora la dep N7b y encuentra la N7a', () => {
    expect(deriveKeyframeAssetIds([n7bDep(N7B), n7aDep(N7A)])).toEqual([
      'keyframe_A0',
      'keyframe_A1',
    ]);
  });
});

// ── AISLAMIENTO A/B a nivel de PURO (el mordisco REAL vive en integración, ver el test de aislamiento
//    con el consumer) — aquí se demuestra que el resolver mira SOLO las deps que se le pasan: si a N7c de
//    la variante A se le pasan las deps de A, jamás puede devolver el audio de B (no está en la lista).
describe('aislamiento por lista de deps (unidad)', () => {
  it('con solo las deps de A, el audio derivado es de A — el de B es inalcanzable', () => {
    const n7bB: N7bOutput = {
      ...N7B,
      scriptId: 'script_B',
      clips: [{ ...N7B.clips[0]!, assetId: 'audio_hook_B' }],
    };
    // Se resuelve SOLO la dep de A: el resolver no tiene forma de ver 'audio_hook_B'.
    expect(deriveHookAudioAssetId(resolveN7b([n7bDep(N7B)]), 0)).toBe('audio_hook_A');
    // Control positivo del propio test: si se pasara la dep de B, devolvería la de B (no es tautológico).
    expect(deriveHookAudioAssetId(resolveN7b([n7bDep(n7bB)]), 0)).toBe('audio_hook_B');
  });
});
