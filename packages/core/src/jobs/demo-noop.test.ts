import { describe, expect, it } from 'vitest';
import { NoopJobSchema, noopJob } from './demo-noop';

describe('contrato del job demo.noop (T0.6)', () => {
  it('declara la cola con el nombre y las opciones de retry esperadas', () => {
    expect(noopJob.name).toBe('demo.noop');
    expect(noopJob.options.policy).toBe('standard');
    expect(noopJob.options.retryLimit).toBe(6);
    expect(noopJob.options.retryBackoff).toBe(true);
    // retryDelay ≥1: con 0 el backoff exponencial sería inerte (0*2^n=0).
    expect(noopJob.options.retryDelay).toBe(1);
    expect(noopJob.options.retryDelayMax).toBe(4);
  });

  it('acepta el payload vacío del job de demo', () => {
    expect(NoopJobSchema.safeParse({}).success).toBe(true);
  });

  it('rechaza payloads con campos inesperados (frontera de entrada del consumer)', () => {
    // strict(): un payload viejo/corrupto tras un deploy falla el safeParse del
    // consumer y va a la DLQ con error legible, no revienta a mitad del handler.
    const parsed = NoopJobSchema.safeParse({ unexpected: 1 });
    expect(parsed.success).toBe(false);
  });
});
