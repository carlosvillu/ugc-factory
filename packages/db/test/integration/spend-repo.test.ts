// Roundtrip real del ledger de gasto (T0.12) contra el clon de Testcontainers
// (db-integration.md §6): `recordCost` inserta cargos, y las lecturas agregadas
// (`getSpendSummary`) los suman EXACTAMENTE en céntimos enteros — la suma exacta es
// requisito duro de la Verificación. La cláusula "suma exacta" se codifica aquí como
// test permanente (regla de trabajo 8): un `real`/float rompería estos equalities.
//
// Cada test usa su propia BD clonada (createTestDatabase) → aislado, sin interferir
// con otros ledgers. Los importes son céntimos ENTEROS elegidos para que la suma sea
// verificable a mano.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { getSpendSummary, recordCost, seedMonthlyBudgetIfAbsent } from '../../src/repos/spend.repo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'spend-repo' });
});

afterAll(async () => {
  await tdb.close(); // OBLIGATORIO: sin esto el proceso de vitest no termina.
});

describe('spend repo — recordCost (T0.12)', () => {
  it('inserta una fila con céntimos enteros y refs null por defecto', async () => {
    const entry = await recordCost(tdb.db, {
      provider: 'fal',
      amountCents: 1234,
      quantity: 42,
      unit: 'seconds',
    });
    expect(entry.id).toHaveLength(26); // PK ULID
    expect(entry.provider).toBe('fal');
    expect(entry.amountCents).toBe(1234);
    expect(typeof entry.amountCents).toBe('number'); // integer, no string/bigint
    expect(entry.quantity).toBe(42);
    expect(entry.unit).toBe('seconds');
    expect(entry.stepRunId).toBeNull();
    expect(entry.generationId).toBeNull();
    expect(entry.projectId).toBeNull();
    expect(entry.occurredAt).toBeInstanceOf(Date); // default now()
  });

  it('el enum cost_provider acepta los 4 valores de §12', async () => {
    for (const provider of ['fal', 'anthropic', 'firecrawl', 'other'] as const) {
      const e = await recordCost(tdb.db, { provider, amountCents: 1 });
      expect(e.provider).toBe(provider);
    }
  });
});

describe('spend repo — lecturas agregadas (T0.12)', () => {
  it('suma EXACTA por proveedor, por día y total (céntimos enteros)', async () => {
    const tdb2 = await createTestDatabase({ label: 'spend-agg' });
    try {
      // Dos días UTC distintos, dos proveedores. Importes elegidos para verificar la
      // suma a mano: fal = 500 + 250 = 750; anthropic = 99. Total = 849.
      const day1 = new Date('2026-07-03T10:00:00.000Z');
      const day2 = new Date('2026-07-04T09:30:00.000Z');
      await recordCost(tdb2.db, {
        provider: 'fal',
        amountCents: 500,
        quantity: 10,
        unit: 'seconds',
        occurredAt: day1,
      });
      await recordCost(tdb2.db, {
        provider: 'fal',
        amountCents: 250,
        quantity: 5,
        unit: 'seconds',
        occurredAt: day2,
      });
      await recordCost(tdb2.db, {
        provider: 'anthropic',
        amountCents: 99,
        quantity: 1000,
        unit: 'tokens',
        occurredAt: day1,
      });

      const summary = await getSpendSummary(tdb2.db);

      // Total exacto.
      expect(summary.totalCents).toBe(849);

      // Por proveedor: fal 750 (2 cargos, 15 unidades), anthropic 99. Ordenado desc.
      const fal = summary.byProvider.find((p) => p.provider === 'fal');
      const anthropic = summary.byProvider.find((p) => p.provider === 'anthropic');
      expect(fal).toEqual({
        provider: 'fal',
        amountCents: 750,
        quantity: 15,
        entries: 2,
        unit: 'seconds',
      });
      expect(anthropic).toEqual({
        provider: 'anthropic',
        amountCents: 99,
        quantity: 1000,
        entries: 1,
        unit: 'tokens',
      });
      expect(summary.byProvider[0]?.provider).toBe('fal'); // el más caro primero

      // Por día (bucket UTC): 2026-07-03 = 500 + 99 = 599; 2026-07-04 = 250.
      expect(summary.byDay).toEqual([
        { day: '2026-07-03', amountCents: 599, entries: 2 },
        { day: '2026-07-04', amountCents: 250, entries: 1 },
      ]);
    } finally {
      await tdb2.close();
    }
  });

  it('el bucket por día es UTC (una fila cerca de medianoche no se desplaza de día)', async () => {
    const tdb2 = await createTestDatabase({ label: 'spend-utc' });
    try {
      // 23:30 UTC del día 5 → bucket 2026-07-05 (UTC), no el 6 aunque la TZ de la
      // sesión fuera adelantada.
      await recordCost(tdb2.db, {
        provider: 'other',
        amountCents: 100,
        occurredAt: new Date('2026-07-05T23:30:00.000Z'),
      });
      const summary = await getSpendSummary(tdb2.db);
      expect(summary.byDay).toEqual([{ day: '2026-07-05', amountCents: 100, entries: 1 }]);
    } finally {
      await tdb2.close();
    }
  });

  it('ledger vacío: totales a cero, sin presupuesto, sin alerta', async () => {
    const tdb2 = await createTestDatabase({ label: 'spend-empty' });
    try {
      const summary = await getSpendSummary(tdb2.db);
      expect(summary.totalCents).toBe(0);
      expect(summary.byProvider).toEqual([]);
      expect(summary.byDay).toEqual([]);
      expect(summary.limitCents).toBeNull();
      expect(summary.overLimit).toBe(false);
    } finally {
      await tdb2.close();
    }
  });

  it('la suma NO desborda int4: dos filas cuyo total > 2.147.483.647 céntimos suman exacto como number', async () => {
    // `amount_cents` es integer (int4, tope por fila 2.147.483.647). Dos filas de
    // 2.000.000.000 → total 4.000.000.000, que SUPERA int4: si el SUM se casteara a
    // `::int` Postgres lanzaría `integer out of range` y /spend daría 500. Con
    // `::bigint` + `Number()` la suma es exacta y llega como NUMBER JS (no string).
    const tdb2 = await createTestDatabase({ label: 'spend-bigint' });
    try {
      const a = 2_000_000_000;
      const b = 2_000_000_000;
      await recordCost(tdb2.db, {
        provider: 'fal',
        amountCents: a,
        occurredAt: new Date('2026-07-06T10:00:00.000Z'),
      });
      await recordCost(tdb2.db, {
        provider: 'fal',
        amountCents: b,
        occurredAt: new Date('2026-07-06T11:00:00.000Z'),
      });

      const summary = await getSpendSummary(tdb2.db);
      const expected = a + b; // 4.000.000.000 (< Number.MAX_SAFE_INTEGER: exacto)

      // Total: number JS exacto, no string, no NaN, sin overflow.
      expect(typeof summary.totalCents).toBe('number');
      expect(summary.totalCents).toBe(expected);
      // Por proveedor (mismo path bigint): fal suma exacto como number.
      const fal = summary.byProvider.find((p) => p.provider === 'fal');
      expect(typeof fal?.amountCents).toBe('number');
      expect(fal?.amountCents).toBe(expected);
      // Por día (mismo path bigint): el bucket suma exacto como number.
      expect(summary.byDay).toEqual([{ day: '2026-07-06', amountCents: expected, entries: 2 }]);
    } finally {
      await tdb2.close();
    }
  });
});

describe('spend repo — presupuesto y alerta over-limit (T0.12)', () => {
  it('seedMonthlyBudgetIfAbsent es idempotente (no sobrescribe)', async () => {
    const tdb2 = await createTestDatabase({ label: 'spend-budget-seed' });
    try {
      const first = await seedMonthlyBudgetIfAbsent(tdb2.db, 40_000);
      expect(first.scope).toBe('monthly');
      expect(first.limitCents).toBe(40_000);
      expect(first.alertThresholds).toEqual([]); // columna creada, sin cablear (T7.7)

      // Segundo seed con OTRO límite: NO sobrescribe, devuelve el existente.
      const second = await seedMonthlyBudgetIfAbsent(tdb2.db, 999);
      expect(second.id).toBe(first.id);
      expect(second.limitCents).toBe(40_000);
    } finally {
      await tdb2.close();
    }
  });

  it('overLimit=true cuando el gasto total alcanza o supera el límite', async () => {
    const tdb2 = await createTestDatabase({ label: 'spend-over' });
    try {
      await seedMonthlyBudgetIfAbsent(tdb2.db, 1000); // límite 1000 céntimos
      await recordCost(tdb2.db, { provider: 'fal', amountCents: 600 });
      await recordCost(tdb2.db, { provider: 'anthropic', amountCents: 500 }); // total 1100 > 1000

      const summary = await getSpendSummary(tdb2.db);
      expect(summary.totalCents).toBe(1100);
      expect(summary.limitCents).toBe(1000);
      expect(summary.overLimit).toBe(true);
    } finally {
      await tdb2.close();
    }
  });

  it('overLimit=false cuando el gasto está por debajo del límite', async () => {
    const tdb2 = await createTestDatabase({ label: 'spend-under' });
    try {
      await seedMonthlyBudgetIfAbsent(tdb2.db, 5000);
      await recordCost(tdb2.db, { provider: 'fal', amountCents: 100 });
      const summary = await getSpendSummary(tdb2.db);
      expect(summary.overLimit).toBe(false);
    } finally {
      await tdb2.close();
    }
  });

  it('overLimit=true en el borde exacto (gasto == límite)', async () => {
    const tdb2 = await createTestDatabase({ label: 'spend-edge' });
    try {
      await seedMonthlyBudgetIfAbsent(tdb2.db, 300);
      await recordCost(tdb2.db, { provider: 'other', amountCents: 300 });
      const summary = await getSpendSummary(tdb2.db);
      expect(summary.overLimit).toBe(true); // >= : el borde dispara la alerta
    } finally {
      await tdb2.close();
    }
  });
});

// Réplica 1:1 del GATING de `instrumentation.register()` (T0.12): el arranque de web
// siembra el presupuesto SOLO si `BUDGET_MONTHLY_LIMIT_CENTS` es un entero >= 0. Es
// el ÚNICO camino para fijar un presupuesto en F0 (el verifier lo usa en el stack
// vivo), así que se prueba su gating aquí contra la BD real — con la var ausente NO
// hay presupuesto ni alerta; presente-y-válida SÍ. Sin depender del env del shell:
// se pasa el valor como argumento, exactamente lo que `register()` lee de process.env.
describe('spend repo — gating del seed de presupuesto por env (T0.12)', () => {
  // La MISMA condición que instrumentation.ts, extraída para probarla aislada.
  function shouldSeed(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }

  async function bootSeed(db: (typeof tdb)['db'], raw: string | undefined): Promise<void> {
    const limit = shouldSeed(raw);
    if (limit !== undefined) await seedMonthlyBudgetIfAbsent(db, limit);
  }

  it('var AUSENTE: no siembra presupuesto → sin límite ni alerta aunque haya gasto', async () => {
    const tdb2 = await createTestDatabase({ label: 'boot-absent' });
    try {
      await recordCost(tdb2.db, { provider: 'fal', amountCents: 1000 });
      await bootSeed(tdb2.db, undefined); // BUDGET_MONTHLY_LIMIT_CENTS ausente
      const s = await getSpendSummary(tdb2.db);
      expect(s.limitCents).toBeNull();
      expect(s.overLimit).toBe(false);
    } finally {
      await tdb2.close();
    }
  });

  it('var PRESENTE por debajo del gasto: siembra → alerta over-limit', async () => {
    const tdb2 = await createTestDatabase({ label: 'boot-present' });
    try {
      await recordCost(tdb2.db, { provider: 'fal', amountCents: 1000 });
      await bootSeed(tdb2.db, '500'); // límite 500 < gasto 1000
      const s = await getSpendSummary(tdb2.db);
      expect(s.limitCents).toBe(500);
      expect(s.overLimit).toBe(true);
    } finally {
      await tdb2.close();
    }
  });

  it('var INVÁLIDA: no siembra (mismo gating que register)', async () => {
    const tdb2 = await createTestDatabase({ label: 'boot-invalid' });
    try {
      await bootSeed(tdb2.db, 'abc');
      const s = await getSpendSummary(tdb2.db);
      expect(s.limitCents).toBeNull();
    } finally {
      await tdb2.close();
    }
  });
});
