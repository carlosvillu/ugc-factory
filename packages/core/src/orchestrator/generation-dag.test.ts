// Topología del DAG de generación (T4.11 pass 2b-i): expansión por variante, node_keys limpios,
// variantId, `maxRetries` holgado en los N7, y las aristas de flujo de datos N7c←N7b, N7d←N7a. Todo
// determinista → corre en `pnpm gate`.
import { describe, expect, it } from 'vitest';
import { generationRunDefinition, GENERATION_NODE_KEYS } from './generation-dag';
import { validateDag } from './run-definition';
import { N7_MAX_RETRIES } from './executor';
import type { VariantGenerationPlan } from './generation-dag';
import type { RunNodeInput } from './run-definition';

/** Un plan de variante con los seis N7 + N8 + N9 presentes (config opaca de relleno: el builder no la mira). */
function fullVariant(variantId: string): VariantGenerationPlan {
  return {
    variantId,
    n6Config: { variantId },
    n7aConfig: { route: 'ai_packshot', briefId: 'b1' },
    n7bConfig: { scriptId: 's1' },
    n7cConfig: { avatarEndpoint: 'fal-ai/x' },
    n7dConfig: { scriptId: 's1' },
    n7fConfig: { scriptId: 's1', ctaEndpoint: 'fal-ai/x' },
    n7eConfig: { musicEndpoint: 'fal-ai/ace-step' },
    n8Config: { variantId },
    n9Config: { variantId },
  };
}

const K = GENERATION_NODE_KEYS;
const byKey = (nodes: RunNodeInput[], key: string): RunNodeInput | undefined =>
  nodes.find((n) => n.key === key);

describe('generationRunDefinition', () => {
  it('produce un DAG estructuralmente válido (pasa validateDag)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1'), fullVariant('v2')]);
    expect(validateDag(def)).toBeNull();
  });

  it('arranca en autopilot; el ÚNICO checkpoint es N9/QA (CP4, alwaysPause gana sobre autopilot)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    expect(def.autopilot).toBe(true);
    // N6/N7/N8 NO son checkpoints; solo N9 lo es.
    const checkpoints = def.nodes.filter((n) => n.isCheckpoint === true);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.nodeKey).toBe('N9');
  });

  it('N9 · CP4: checkpoint con alwaysPause ← [N8] (T5.5c): pausa aunque el run esté en autopilot', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    const n9 = byKey(def.nodes, `${K.n9}__v1`);
    expect(n9?.nodeKey).toBe('N9'); // node_key LIMPIO (el registro de executors resuelve por él)
    expect(n9?.variantId).toBe('v1');
    expect(n9?.dependsOn).toEqual([`${K.n8}__v1`]); // N9 ← [N8]: lee el qa_report que N8 persistió
    expect(n9?.isCheckpoint).toBe(true);
    // El override que HACE la pausa: sin él, N9 navegaría a `succeeded` bajo autopilot (control negativo
    // en el test de worker). GANA sobre `autopilot=true` (checkpoint.ts:shouldPause).
    expect(n9?.checkpointConfig).toEqual({ alwaysPause: true });
    // N9 no paga: NO fija maxRetries holgado (a diferencia de los N7).
    expect(n9?.maxRetries).toBeUndefined();
  });

  it('N9 solo se materializa si N8 está presente (sin máster no hay QA que hacer)', () => {
    // Un plan con n9Config pero SIN n8Config: N9 no se emite (no habría máster que validar).
    const def = generationRunDefinition('p', [
      {
        variantId: 'v1',
        n6Config: {},
        n7bConfig: {},
        n7cConfig: {},
        n9Config: { variantId: 'v1' },
      },
    ]);
    expect(def.nodes.some((n) => n.nodeKey === 'N9')).toBe(false);
  });

  it('EXPANDE por variante: N variantes → N sub-DAGs de 9 nodos (N6 + 6 N7 + N8 + N9)', () => {
    const def = generationRunDefinition('p', [
      fullVariant('v1'),
      fullVariant('v2'),
      fullVariant('v3'),
    ]);
    expect(def.nodes).toHaveLength(3 * 9);
    // Cada variante tiene sus 9 nodos con SU variantId.
    for (const v of ['v1', 'v2', 'v3']) {
      const nodesOfV = def.nodes.filter((n) => n.variantId === v);
      expect(nodesOfV).toHaveLength(9);
    }
  });

  it('N8 depende de los N7 de vídeo/voz/bed PRESENTES (N7b/N7c/N7d/N7f/N7e) + N6; NO de N7a', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    const n8 = byKey(def.nodes, `${K.n8}__v1`);
    // `n7Node` prepone N6 (raíz del sub-DAG) a todo nodo N7/N8; N8 añade sus productores de input
    // N7b/N7c/N7d/N7f/N7e. NO depende de N7a (sus keyframes los consumen N7d/N7f, no N8).
    expect(n8?.dependsOn?.slice().sort()).toEqual(
      [
        `${K.n6}__v1`,
        `${K.n7b}__v1`,
        `${K.n7c}__v1`,
        `${K.n7d}__v1`,
        `${K.n7f}__v1`,
        `${K.n7e}__v1`,
      ].sort(),
    );
    expect(n8?.dependsOn).not.toContain(`${K.n7a}__v1`);
  });

  it('N8 solo depende de los N7 PRESENTES (sin b-roll ni CTA → N8 no depende de N7d/N7f)', () => {
    const def = generationRunDefinition('p', [
      { variantId: 'v1', n6Config: {}, n7bConfig: {}, n7cConfig: {}, n8Config: {} },
    ]);
    const n8 = byKey(def.nodes, `${K.n8}__v1`);
    expect(n8?.dependsOn?.slice().sort()).toEqual(
      [`${K.n6}__v1`, `${K.n7b}__v1`, `${K.n7c}__v1`].sort(),
    );
    expect(n8?.dependsOn).not.toContain(`${K.n7d}__v1`);
    expect(n8?.dependsOn).not.toContain(`${K.n7f}__v1`);
  });

  it('node_key LIMPIO (§12) reutilizado entre variantes; la identidad está en variantId', () => {
    const def = generationRunDefinition('p', [fullVariant('v1'), fullVariant('v2')]);
    // Dos nodos N7c (uno por variante) con el MISMO node_key limpio, distinto variantId.
    const n7cNodes = def.nodes.filter((n) => n.nodeKey === K.n7c);
    expect(n7cNodes).toHaveLength(2);
    expect(n7cNodes.map((n) => n.variantId).sort()).toEqual(['v1', 'v2']);
    // El registro de executors resuelve por este node_key EXACTO → debe ser el limpio, sin sufijo.
    expect(n7cNodes.every((n) => n.nodeKey === 'N7c')).toBe(true);
  });

  it('N7c depende de N6 Y N7b (consume el audio del hook)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    const n7c = byKey(def.nodes, `${K.n7c}__v1`);
    expect(n7c?.dependsOn).toEqual([`${K.n6}__v1`, `${K.n7b}__v1`]);
  });

  it('N7d depende de N6 Y N7a (consume los keyframes)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    const n7d = byKey(def.nodes, `${K.n7d}__v1`);
    expect(n7d?.dependsOn).toEqual([`${K.n6}__v1`, `${K.n7a}__v1`]);
  });

  it('N7f (clip de CTA) depende de N6 Y N7a (anima el keyframe de product shot, como N7d)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    const n7f = byKey(def.nodes, `${K.n7f}__v1`);
    expect(n7f?.dependsOn).toEqual([`${K.n6}__v1`, `${K.n7a}__v1`]);
    // node_key LIMPIO 'N7f' (el registro de executors resuelve por él).
    expect(n7f?.nodeKey).toBe('N7f');
  });

  it('N7f sin N7a presente depende SOLO de N6 (surface honesto: su executor fallará al no hallar keyframe)', () => {
    const def = generationRunDefinition('p', [
      {
        variantId: 'v1',
        n6Config: { variantId: 'v1' },
        n7fConfig: { scriptId: 's1', ctaEndpoint: 'x' },
      },
    ]);
    expect(byKey(def.nodes, `${K.n7f}__v1`)?.dependsOn).toEqual([`${K.n6}__v1`]);
    expect(validateDag(def)).toBeNull();
  });

  it('N7a/N7b/N7e dependen SOLO de N6 (independientes entre sí)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    expect(byKey(def.nodes, `${K.n7a}__v1`)?.dependsOn).toEqual([`${K.n6}__v1`]);
    expect(byKey(def.nodes, `${K.n7b}__v1`)?.dependsOn).toEqual([`${K.n6}__v1`]);
    expect(byKey(def.nodes, `${K.n7e}__v1`)?.dependsOn).toEqual([`${K.n6}__v1`]);
  });

  it('N6 es la raíz del sub-DAG (sin deps)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    expect(byKey(def.nodes, `${K.n6}__v1`)?.dependsOn).toEqual([]);
  });

  it('MONEY: todo N7 fija maxRetries=N7_MAX_RETRIES; N6 NO (default de BD)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    for (const nodeKey of [K.n7a, K.n7b, K.n7c, K.n7d, K.n7f, K.n7e]) {
      const n = def.nodes.find((x) => x.nodeKey === nodeKey);
      expect(n?.maxRetries).toBe(N7_MAX_RETRIES);
    }
    // N6 es $0: sus fallos son transitorios normales, conserva el default (no fija maxRetries).
    expect(def.nodes.find((n) => n.nodeKey === K.n6)?.maxRetries).toBeUndefined();
  });

  it('omite los N7 no pedidos (receta/ruta) y mantiene la topología de los que están', () => {
    // Solo N6 + N7b + N7e (una variante sin imágenes ni b-roll): N7c NO depende de N7a/N7b ausentes.
    const def = generationRunDefinition('p', [
      {
        variantId: 'v1',
        n6Config: { variantId: 'v1' },
        n7bConfig: { scriptId: 's1' },
        n7eConfig: { musicEndpoint: 'x' },
      },
    ]);
    expect(def.nodes.map((n) => n.nodeKey).sort()).toEqual(['N6', 'N7b', 'N7e']);
    expect(validateDag(def)).toBeNull();
  });

  it('N7c sin N7b presente depende SOLO de N6 (surface honesto: su executor fallará al no hallar audio)', () => {
    // Plan incoherente (avatar sin voz): el builder no inventa una arista a un N7b inexistente.
    const def = generationRunDefinition('p', [
      { variantId: 'v1', n6Config: { variantId: 'v1' }, n7cConfig: { avatarEndpoint: 'x' } },
    ]);
    expect(byKey(def.nodes, `${K.n7c}__v1`)?.dependsOn).toEqual([`${K.n6}__v1`]);
    expect(validateDag(def)).toBeNull();
  });

  it('sin variantes ⇒ lanza (el run no tendría root)', () => {
    expect(() => generationRunDefinition('p', [])).toThrow(/no hay variantes/);
  });

  // ── LINAJE DEL RUN (T5.8, CU4): `kind` opcional para la regeneración parcial ─────────────────────────
  it('sin opts, el run NO fija kind (generación normal de CP3 → default full)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')]);
    expect(def.kind).toBeUndefined();
  });

  it('con opts (T5.8): el run lleva kind=regen (lo distingue en la run-list)', () => {
    const def = generationRunDefinition('p', [fullVariant('v1')], { kind: 'regen' });
    expect(def.kind).toBe('regen');
    // La identidad de variante viaja POR-NODO (no a nivel de run): cada N6/N7/N8/N9 la lleva. El linaje al
    // lote se alcanza vía `step_run.variant_id → ad_variant.batch_id` (no `pipeline_run.batch_id`).
    expect(byKey(def.nodes, `${K.n6}__v1`)?.variantId).toBe('v1');
    expect(validateDag(def)).toBeNull();
  });
});
