import { describe, expect, it } from 'vitest';
import { HealthStatusSchema } from './health';

describe('HealthStatusSchema', () => {
  it('acepta el payload canónico {ok:true} del healthcheck', () => {
    const parsed = HealthStatusSchema.parse({ ok: true });
    expect(parsed).toEqual({ ok: true });
  });

  it('acepta ok:false (estado degradado, lo usará el healthcheck de BD en T0.2)', () => {
    expect(HealthStatusSchema.safeParse({ ok: false }).success).toBe(true);
  });

  const invalid: [name: string, input: unknown][] = [
    ['objeto vacío', {}],
    ['ok como string', { ok: 'yes' }],
    ['ok numérico (nada de coerción)', { ok: 1 }],
    ['null', null],
    ['array', [true]],
  ];

  it.each(invalid)('rechaza: %s', (_name, input) => {
    expect(HealthStatusSchema.safeParse(input).success).toBe(false);
  });

  it('elimina claves desconocidas: el contrato es la proyección exacta', () => {
    expect(HealthStatusSchema.parse({ ok: true, extra: 'x' })).toEqual({ ok: true });
  });
});
