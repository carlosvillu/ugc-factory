// Integración del PATH DE COSTE INYECTABLE (T0.12) contra Postgres real: el executor
// de demo, cuando su `config` lleva `costCents`, registra el cargo en `cost_entry`
// vía el `recordCost` cableado por el composition root. Es el reachability gate del
// ledger — el verifier lanza runs de demo con SUS importes en la config y `/spend`
// los suma. Este test protege la cadena DemoConfigSchema(strictObject) → executor →
// recordCost contra un drift silencioso (p.ej. si un campo desapareciera del schema
// el executor dejaría de facturar y solo el verifier lo vería).
//
// Se prueba el executor directamente con un `recordCost` real ligado a la BD clonada
// (no un run completo: el path de coste vive ENTERO en el executor; el consumer solo
// lo invoca). Es el floor barato que el advisor pidió, sin arrastrar pg-boss.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { getSpendSummary, recordCost } from '@ugc/db';
import { makeDemoExecutor, randomDemoFail } from '../../src/executors/demo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'demo-cost' });
});

afterAll(async () => {
  await tdb.close();
});

describe('executor de demo — coste inyectable por config (T0.12)', () => {
  it('registra un cost_entry cuando la config lleva costCents (path de éxito)', async () => {
    const executor = makeDemoExecutor({
      shouldFail: randomDemoFail,
      recordCost: (input) => recordCost(tdb.db, input),
    });

    // Config con coste inyectado (los importes son los que el verifier elegiría).
    await executor({
      config: { costCents: 4321, costProvider: 'fal', costQuantity: 30, costUnit: 'seconds' },
    });

    const summary = await getSpendSummary(tdb.db);
    expect(summary.totalCents).toBe(4321);
    const fal = summary.byProvider.find((p) => p.provider === 'fal');
    expect(fal).toEqual({
      provider: 'fal',
      amountCents: 4321,
      quantity: 30,
      entries: 1,
      unit: 'seconds',
    });
  });

  it('sin costCents en la config NO registra ningún cargo', async () => {
    const tdb2 = await createTestDatabase({ label: 'demo-cost-none' });
    try {
      const executor = makeDemoExecutor({
        shouldFail: randomDemoFail,
        recordCost: (input) => recordCost(tdb2.db, input),
      });
      await executor({ config: { sleepMs: 0 } }); // config sin coste
      const summary = await getSpendSummary(tdb2.db);
      expect(summary.totalCents).toBe(0);
      expect(summary.byProvider).toEqual([]);
    } finally {
      await tdb2.close();
    }
  });

  it('costProvider por defecto es "other" cuando no se especifica', async () => {
    const tdb2 = await createTestDatabase({ label: 'demo-cost-default' });
    try {
      const executor = makeDemoExecutor({
        shouldFail: randomDemoFail,
        recordCost: (input) => recordCost(tdb2.db, input),
      });
      await executor({ config: { costCents: 100 } });
      const summary = await getSpendSummary(tdb2.db);
      expect(summary.byProvider[0]?.provider).toBe('other');
      expect(summary.totalCents).toBe(100);
    } finally {
      await tdb2.close();
    }
  });
});
