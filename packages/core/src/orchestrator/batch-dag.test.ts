// Protege la definición del DAG de lote (T2.6). Cada assert cubre un invariante del que depende que
// CP3 REAL funcione: que el run parsee (sin ciclos ni node_keys duplicados), que N5 sea el
// checkpoint de CP3 y que pause AUNQUE haya autopilot (es la puerta antes del gasto de generación),
// y que el `batchId` viaje en la config (sin él el executor no sabe qué lote guionizar).
import { describe, expect, it } from 'vitest';
import { AnalysisN5ConfigSchema, AnalysisN6ConfigSchema, batchRunDefinition } from './batch-dag';
import type { AnalysisN5Config } from './batch-dag';
import { shouldPause } from './checkpoint';
import { RunDefinitionSchema } from './run-definition';
import type { RunNodeInput } from './run-definition';

describe('batchRunDefinition', () => {
  it('es una definición de run VÁLIDA (parsea contra el schema)', () => {
    // Si el DAG parsea, `validateDag` (dentro del schema/createRun) garantizó que no hay ciclos,
    // deps colgantes ni node_keys duplicados.
    expect(() => RunDefinitionSchema.parse(batchRunDefinition('proj_01', 'bat_01'))).not.toThrow();
  });

  it('es un ÚNICO nodo N5, root (sin deps): el lote ya existe, no espera a nadie', () => {
    const def = batchRunDefinition('proj_01', 'bat_01');
    expect(def.nodes).toHaveLength(1);
    const n5 = def.nodes[0];
    expect(n5?.nodeKey).toBe('N5');
    // Root: el `ad_batch` ya está creado (lo creó la aprobación de CP2 en la misma tx que este run);
    // N5 arranca de inmediato, sin depender de ningún otro step.
    expect(n5?.dependsOn ?? []).toEqual([]);
  });

  it('el `batchId` viaja en la config de N5 (sin él no hay lote que guionizar)', () => {
    const def = batchRunDefinition('proj_01', 'bat_01');
    const n5 = def.nodes.find((n) => n.nodeKey === 'N5')?.config as AnalysisN5Config;
    expect(n5).toEqual({ batchId: 'bat_01' });
    // Y parsea contra su propio schema —el mismo que el executor usa para re-validar el jsonb opaco.
    expect(() => AnalysisN5ConfigSchema.parse(n5)).not.toThrow();
  });

  it('N5 es el CHECKPOINT de CP3', () => {
    // Sin `isCheckpoint`, N5 escribiría los guiones y el run pasaría directo a `succeeded` sin abrir
    // el editor: no habría CP3 que revisar ni aprobar, y las variantes nunca llegarían a `scripted`.
    const n5 = batchRunDefinition('proj_01', 'bat_01').nodes.find((n) => n.nodeKey === 'N5');
    expect(n5?.isCheckpoint).toBe(true);
  });

  it('N5 pausa AUNQUE el run vaya en autopilot: es la puerta antes de la generación (§7.1.b)', () => {
    // Mismo agujero que CP2: N6/N7 (generación de pago, T3.5/T4.11) corren aguas abajo de aprobar
    // CP3. Si N5 fuese un checkpoint NORMAL, con autopilot pasaría directo a `succeeded`, nadie
    // revisaría los guiones (ni resolvería un flag FTC bloqueante) y las variantes se generarían con
    // guiones sin aprobar. `alwaysPause` lo impide. El autopilot se puede encender A MITAD del run.
    const n5 = batchRunDefinition('proj_01', 'bat_01').nodes.find((n) => n.nodeKey === 'N5');
    const pauses = (node: RunNodeInput | undefined, autopilot: boolean): boolean =>
      shouldPause({
        isCheckpoint: node?.isCheckpoint ?? false,
        checkpointConfig: node?.checkpointConfig,
        autopilot,
      });

    expect(pauses(n5, true)).toBe(true);
    expect(pauses(n5, false)).toBe(true);
  });

  it('el run de lote NO es autopilot (CP3 es un checkpoint humano)', () => {
    expect(batchRunDefinition('proj_01', 'bat_01').autopilot).toBe(false);
  });

  it('AnalysisN5ConfigSchema rechaza un batchId vacío (control negativo)', () => {
    expect(AnalysisN5ConfigSchema.safeParse({ batchId: '' }).success).toBe(false);
    expect(AnalysisN5ConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe('AnalysisN6ConfigSchema (T3.5, esqueleto del compilador)', () => {
  it('acepta una variantId no vacía (el forward-pointer que F4 resolverá)', () => {
    expect(AnalysisN6ConfigSchema.safeParse({ variantId: 'var_01' }).success).toBe(true);
  });
  it('rechaza variantId vacía o ausente (control negativo)', () => {
    expect(AnalysisN6ConfigSchema.safeParse({ variantId: '' }).success).toBe(false);
    expect(AnalysisN6ConfigSchema.safeParse({}).success).toBe(false);
  });
});
