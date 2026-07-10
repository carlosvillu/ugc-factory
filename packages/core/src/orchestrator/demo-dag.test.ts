// Protege el andamiaje del DAG de demo del canvas (T0.11): los 7 comportamientos de
// la Verificación solo son alcanzables si el DAG tiene las afordancias correctas
// (un checkpoint normal, un checkpoint con alwaysPause, un nodo que falla siempre, y
// una cadena que deja un nodo skippable). Si alguien poda una de estas al tocar el
// DAG, este test lo caza antes de que la CUA falle silenciosa.
import { describe, expect, it } from 'vitest';
import { demoCanvasRunDefinition } from './demo-dag';
import { RunDefinitionSchema } from './run-definition';

describe('demoCanvasRunDefinition', () => {
  it('es una definición de run VÁLIDA (parsea contra el schema)', () => {
    const def = demoCanvasRunDefinition('proj_01');
    expect(() => RunDefinitionSchema.parse(def)).not.toThrow();
  });

  it('tiene un checkpoint NORMAL y uno con alwaysPause (autopilot + candado)', () => {
    const def = demoCanvasRunDefinition('proj_01');
    const checkpoints = def.nodes.filter((n) => n.isCheckpoint);
    expect(checkpoints).toHaveLength(2);
    // uno normal (sin alwaysPause) y uno con el candado.
    const normal = checkpoints.find((n) => !n.checkpointConfig);
    const locked = checkpoints.find(
      (n) => n.checkpointConfig && (n.checkpointConfig as { alwaysPause?: boolean }).alwaysPause,
    );
    expect(normal).toBeDefined();
    expect(locked).toBeDefined();
  });

  it('tiene un nodo que falla siempre (failRate=1) para el retry', () => {
    const def = demoCanvasRunDefinition('proj_01');
    const failing = def.nodes.find(
      (n) => (n.config as { failRate?: number } | undefined)?.failRate === 1,
    );
    expect(failing).toBeDefined();
  });

  it('el último nodo depende del que falla → queda skippable mientras aquél no succeeda', () => {
    const def = demoCanvasRunDefinition('proj_01');
    const failing = def.nodes.find(
      (n) => (n.config as { failRate?: number } | undefined)?.failRate === 1,
    )!;
    const skippable = def.nodes.find((n) => (n.dependsOn ?? []).includes(failing.key));
    expect(skippable).toBeDefined();
  });

  it('arranca en autopilot cuando se pide', () => {
    expect(demoCanvasRunDefinition('proj_01', { autopilot: true }).autopilot).toBe(true);
    expect(demoCanvasRunDefinition('proj_01').autopilot).toBe(false);
  });
});
