// Test del discriminador PURO de limpieza de referencias de persona (T4.12 Pase B, regla de trabajo 8).
// Corre en `pnpm test` → `pnpm gate`, SIN Docker. Fija la regla que decide la cláusula 1 de la
// Verificación: qué referencias son sintéticas del seed (a borrar) y cuáles IA (a conservar).
import { describe, expect, it } from 'vitest';
import {
  MIN_AI_REFERENCES,
  partitionPersonaReferences,
  type ReferenceAssetLike,
} from './persona-reference-cleanup';

const synthetic = (id: string): ReferenceAssetLike => ({
  id,
  kind: 'reference_image',
  generationId: null,
});
const ai = (id: string): ReferenceAssetLike => ({
  id,
  kind: 'reference_image',
  generationId: `gen-${id}`,
});

describe('partitionPersonaReferences', () => {
  it('separa IA (generationId no-null) de sintéticas del seed (generationId null)', () => {
    const assets = [synthetic('s1'), synthetic('s2'), ai('a1'), ai('a2'), ai('a3')];
    const { aiRefIds, syntheticRefIds } = partitionPersonaReferences(assets);
    expect(aiRefIds).toEqual(['a1', 'a2', 'a3']);
    expect(syntheticRefIds).toEqual(['s1', 's2']);
  });

  it('una persona recién sembrada (solo sintéticas) da 0 IA y todas a borrar', () => {
    const { aiRefIds, syntheticRefIds } = partitionPersonaReferences([
      synthetic('s1'),
      synthetic('s2'),
    ]);
    expect(aiRefIds).toEqual([]);
    expect(syntheticRefIds).toEqual(['s1', 's2']);
  });

  it('una persona ya limpia (solo IA) no tiene nada que borrar', () => {
    const { aiRefIds, syntheticRefIds } = partitionPersonaReferences([ai('a1'), ai('a2')]);
    expect(aiRefIds).toEqual(['a1', 'a2']);
    expect(syntheticRefIds).toEqual([]);
  });

  it('IGNORA assets que no son reference_image (defensa: no toca otros kinds)', () => {
    const assets: ReferenceAssetLike[] = [
      { id: 'k1', kind: 'keyframe', generationId: null },
      ai('a1'),
      ai('a2'),
    ];
    const { aiRefIds, syntheticRefIds } = partitionPersonaReferences(assets);
    expect(aiRefIds).toEqual(['a1', 'a2']);
    expect(syntheticRefIds).toEqual([]); // el keyframe con generationId null NO se marca para borrar
  });

  it('lista vacía → ambos vacíos', () => {
    const { aiRefIds, syntheticRefIds } = partitionPersonaReferences([]);
    expect(aiRefIds).toEqual([]);
    expect(syntheticRefIds).toEqual([]);
  });

  it('MIN_AI_REFERENCES es 2 (§11: mismo sujeto en ≥2 encuadres = «activa»)', () => {
    expect(MIN_AI_REFERENCES).toBe(2);
  });
});
