// Unit puro de `shouldPause` (T0.8, §7.1.b): la decisión de pausa en un checkpoint
// según is_checkpoint + autopilot + override per-nodo. Sin BD (unit-core.md).
import { describe, expect, it } from 'vitest';
import { shouldPause } from './checkpoint';

describe('shouldPause', () => {
  it('un nodo NO-checkpoint nunca pausa (con o sin autopilot)', () => {
    expect(shouldPause({ isCheckpoint: false, checkpointConfig: null, autopilot: false })).toBe(
      false,
    );
    expect(shouldPause({ isCheckpoint: false, checkpointConfig: null, autopilot: true })).toBe(
      false,
    );
  });

  it('un checkpoint SIN autopilot pausa', () => {
    expect(shouldPause({ isCheckpoint: true, checkpointConfig: null, autopilot: false })).toBe(
      true,
    );
  });

  it('un checkpoint CON autopilot NO pausa (autopilot suprime la pausa)', () => {
    expect(shouldPause({ isCheckpoint: true, checkpointConfig: null, autopilot: true })).toBe(
      false,
    );
  });

  it('override alwaysPause GANA sobre autopilot: el checkpoint pausa aunque autopilot esté on', () => {
    expect(
      shouldPause({ isCheckpoint: true, checkpointConfig: { alwaysPause: true }, autopilot: true }),
    ).toBe(true);
  });

  it('alwaysPause=false con autopilot NO pausa (el override no fuerza pausa)', () => {
    expect(
      shouldPause({
        isCheckpoint: true,
        checkpointConfig: { alwaysPause: false },
        autopilot: true,
      }),
    ).toBe(false);
  });

  it('checkpointConfig con shape inesperado ⇒ se trata como sin override (conservador: pausa si no autopilot)', () => {
    // Un config corrupto no debe saltarse la aprobación por un typo.
    expect(shouldPause({ isCheckpoint: true, checkpointConfig: 42, autopilot: false })).toBe(true);
    expect(shouldPause({ isCheckpoint: true, checkpointConfig: 42, autopilot: true })).toBe(false);
  });
});
