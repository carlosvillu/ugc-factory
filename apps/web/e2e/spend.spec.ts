// Regresión permanente de T0.12 (e2e.md §10, DoD BLOQUEANTE): siembra importes
// PROPIOS del spec en `cost_entry` (+ un presupuesto por debajo del gasto) y verifica
// desde `/spend` los totales por día y por proveedor y la ALERTA de presupuesto.
//
// Este spec asserta sumas EXACTAS del ledger, así que necesita POSEERLO. Hasta T1.10a
// eso era gratis (nadie más escribía `cost_entry`: el canvas usa
// `demoCanvasRunDefinition`, sin `costCents`). YA NO: los specs del pipeline de análisis
// (analysis-pipeline.spec.ts) ejecutan los nodos REALES N1/N2/N3, que registran su coste
// de verdad (créditos de Firecrawl, tokens de Anthropic — contra las APIs FALSAS, pero el
// cargo se contabiliza igual, que es justo lo que debe pasar). Como Playwright no
// garantiza el orden entre ficheros, esas filas podían colarse antes de estos asserts y
// romper las sumas.
//
// FIX (sin rebajar el test): el `beforeAll` VACÍA `cost_entry` antes de sembrar, de modo
// que la premisa "este spec posee el ledger" vuelve a ser cierta por CONSTRUCCIÓN en vez
// de por suerte de ordenación. Las sumas siguen siendo exactas — no se relaja ni un
// assert.
import { test, expect } from '@playwright/test';
import { createDb, recordCost, seedMonthlyBudgetIfAbsent } from '@ugc/db';
// La BD del stack en UN solo sitio (`support/stack-db.ts`): la URL para el cliente TIPADO (que es
// como este spec SIEMBRA: `recordCost`/`seedMonthlyBudgetIfAbsent`) y `queryStack` para el SQL
// crudo de limpieza. Antes este fichero parseaba `.runtime.json` y abría su propio `Pool` inline.
import { queryStack, stackDatabaseUrl } from './support/stack-db';

const db = createDb(stackDatabaseUrl);

// Dos días UTC distintos DEL MES EN CURSO (coherente con el "este mes" del mockup).
// Las fechas se construyen en UTC y el bucket del repo trunca en UTC → el string
// esperado se deriva de la MISMA fecha (sin desplazamiento de TZ).
const now = new Date();
function utcDay(dayOfMonth: number, hour: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth, hour, 0, 0));
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

test.describe.configure({ mode: 'serial' });

test.describe('panel de gasto /spend (T0.12)', () => {
  // Importes del spec (céntimos enteros). fal = 500 + 250 = 750; anthropic = 99.
  // Total = 849 céntimos = $8.49. Presupuesto por debajo (800) → alerta over-limit.
  const day1 = utcDay(2, 10); // día 2 del mes, 10:00 UTC
  const day2 = utcDay(3, 9); // día 3 del mes, 09:00 UTC
  const BUDGET_CENTS = 800;

  test.beforeAll(async () => {
    // El ledger queda LIMPIO antes de sembrar: otros specs (el pipeline de análisis)
    // registran costes reales sobre esta misma BD y el orden entre ficheros no está
    // garantizado. Sin esto, las sumas exactas de abajo dependerían de la suerte.
    await queryStack('DELETE FROM cost_entry');

    await recordCost(db, {
      provider: 'fal',
      amountCents: 500,
      quantity: 12,
      unit: 'seconds',
      occurredAt: day1,
    });
    await recordCost(db, {
      provider: 'fal',
      amountCents: 250,
      quantity: 8,
      unit: 'seconds',
      occurredAt: day2,
    });
    await recordCost(db, {
      provider: 'anthropic',
      amountCents: 99,
      quantity: 5000,
      unit: 'tokens',
      occurredAt: day1,
    });
    // Presupuesto por debajo del gasto total (849) → dispara la alerta over-limit.
    await seedMonthlyBudgetIfAbsent(db, BUDGET_CENTS);
  });

  test('muestra totales por proveedor con la suma exacta', { tag: ['@f0'] }, async ({ page }) => {
    await page.goto('/spend');

    // Ledger por proveedor: fal.ai suma 750 ($7.50), Anthropic 99 ($0.99).
    const providerTable = page.getByRole('table').first();
    const falRow = providerTable.getByRole('row').filter({ hasText: 'fal.ai' });
    await expect(falRow).toContainText('$7.50');
    const anthropicRow = providerTable.getByRole('row').filter({ hasText: 'Anthropic' });
    await expect(anthropicRow).toContainText('$0.99');
  });

  test('muestra totales por día con la suma exacta', { tag: ['@f0'] }, async ({ page }) => {
    await page.goto('/spend');

    // Por día: día1 = 500 + 99 = 599 ($5.99); día2 = 250 ($2.50).
    const dayTable = page.getByRole('table').last();
    const row1 = dayTable.getByRole('row').filter({ hasText: ymd(day1) });
    await expect(row1).toContainText('$5.99');
    const row2 = dayTable.getByRole('row').filter({ hasText: ymd(day2) });
    await expect(row2).toContainText('$2.50');
  });

  test(
    'un presupuesto por debajo del gasto dispara la alerta in-app',
    { tag: ['@f0'] },
    async ({ page }) => {
      await page.goto('/spend');

      // Alerta over-limit: gasto total 849 >= límite 800 → banner role="alert" visible.
      // Se localiza por testid (Next monta su propio role="alert" vacío como route
      // announcer → getByRole('alert') sería ambiguo en strict mode).
      const alert = page.getByTestId('spend-over-limit-alert');
      await expect(alert).toBeVisible();
      await expect(alert).toHaveRole('alert'); // sigue siendo un banner de alerta a11y
      await expect(alert).toContainText('$8.49'); // gasto total
      await expect(alert).toContainText('$8.00'); // límite
    },
  );
});
