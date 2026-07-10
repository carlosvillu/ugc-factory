// Unit puro de los timeouts por tipo de nodo (T0.9): precedencia del override
// `config.timeout_ms` sobre el mapa por node_key sobre el default. Sin BD
// (unit-core.md). Cada rama de la Verificación de T0.9 (forzar 10 s vía config)
// queda protegida aquí como test permanente y gratuito.
import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_MS, TIMEOUT_BY_NODE_MS, timeoutAtFor, timeoutMsFor } from './timeout';

describe('timeoutMsFor', () => {
  it('usa el valor del mapa cuando el node_key tiene entrada y no hay override', () => {
    expect(timeoutMsFor('demo.hang', null)).toBe(TIMEOUT_BY_NODE_MS['demo.hang']);
    expect(timeoutMsFor('demo.sleep', {})).toBe(TIMEOUT_BY_NODE_MS['demo.sleep']);
  });

  it('cae al DEFAULT cuando el node_key no está en el mapa', () => {
    expect(timeoutMsFor('N7', null)).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutMsFor('desconocido', {})).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('el override config.timeout_ms GANA sobre el mapa (Verificación T0.9: 10 s)', () => {
    expect(timeoutMsFor('demo.hang', { timeout_ms: 10_000 })).toBe(10_000);
    // También gana sobre el default de un nodo sin entrada.
    expect(timeoutMsFor('N7', { timeout_ms: 1_234 })).toBe(1_234);
  });

  it('el override convive con otras claves de config (no exige strict object)', () => {
    expect(timeoutMsFor('demo.hang', { hang: true, timeout_ms: 5_000 })).toBe(5_000);
  });

  it('ignora un timeout_ms inválido y cae al mapa/default', () => {
    // No entero / no positivo / no numérico ⇒ no es override.
    expect(timeoutMsFor('demo.hang', { timeout_ms: 0 })).toBe(TIMEOUT_BY_NODE_MS['demo.hang']);
    expect(timeoutMsFor('demo.hang', { timeout_ms: -5 })).toBe(TIMEOUT_BY_NODE_MS['demo.hang']);
    expect(timeoutMsFor('demo.hang', { timeout_ms: 1.5 })).toBe(TIMEOUT_BY_NODE_MS['demo.hang']);
    expect(timeoutMsFor('N7', { timeout_ms: 'x' })).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('config null/undefined/no-objeto ⇒ sin override', () => {
    expect(timeoutMsFor('N7', null)).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutMsFor('N7', undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(timeoutMsFor('N7', 42)).toBe(DEFAULT_TIMEOUT_MS);
  });
});

describe('timeoutAtFor', () => {
  it('devuelve now + timeoutMs (respeta el override)', () => {
    const now = new Date('2026-07-10T00:00:00.000Z');
    const at = timeoutAtFor('demo.hang', { timeout_ms: 10_000 }, now);
    expect(at.getTime()).toBe(now.getTime() + 10_000);
  });

  it('sin override usa el mapa por node_key', () => {
    const now = new Date('2026-07-10T00:00:00.000Z');
    const at = timeoutAtFor('demo.sleep', null, now);
    expect(at.getTime()).toBe(now.getTime() + TIMEOUT_BY_NODE_MS['demo.sleep']!);
  });
});
