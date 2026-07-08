import { describe, expect, it } from 'vitest';
import { HealthStatusSchema } from './health';

describe('HealthStatusSchema', () => {
  it('acepta el payload canónico {ok:true, db:true} del healthcheck', () => {
    const parsed = HealthStatusSchema.parse({ ok: true, db: true });
    expect(parsed).toEqual({ ok: true, db: true });
  });

  it('acepta db:false (degradación: Postgres caído, app viva) — T0.2', () => {
    const parsed = HealthStatusSchema.parse({ ok: true, db: false });
    expect(parsed).toEqual({ ok: true, db: false });
  });

  it('acepta ok:false (estado degradado del proceso)', () => {
    expect(HealthStatusSchema.safeParse({ ok: false, db: false }).success).toBe(true);
  });

  const invalid: [name: string, input: unknown][] = [
    ['objeto vacío', {}],
    ['sin db (contrato incompleto desde T0.2)', { ok: true }],
    ['sin ok', { db: true }],
    ['ok como string', { ok: 'yes', db: true }],
    ['db como string', { ok: true, db: 'yes' }],
    ['ok numérico (nada de coerción)', { ok: 1, db: true }],
    ['db numérico (nada de coerción)', { ok: true, db: 1 }],
    ['null', null],
    ['array', [true]],
  ];

  it.each(invalid)('rechaza: %s', (_name, input) => {
    expect(HealthStatusSchema.safeParse(input).success).toBe(false);
  });

  it('elimina claves desconocidas: el contrato es la proyección exacta', () => {
    expect(HealthStatusSchema.parse({ ok: true, db: true, extra: 'x' })).toEqual({
      ok: true,
      db: true,
    });
  });
});
