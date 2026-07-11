// Unit del guard de presupuesto del tier live (T1.8). Es el único freno entre la suite y una
// factura sin techo: si se rompe, el fallo es dinero real. Por eso se testea como código de
// producción — incluido el caso fail-closed (sin ledger no se gasta).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import setupLiveBudget, { spendBudget, spentSoFar } from './live-budget';

let dir: string;
let ledger: string;
const savedLedger = process.env.LIVE_BUDGET_LEDGER;
const savedLimit = process.env.LIVE_BUDGET_USD;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ugc-live-budget-test-'));
  ledger = join(dir, 'ledger.txt');
  process.env.LIVE_BUDGET_LEDGER = ledger;
  process.env.LIVE_BUDGET_USD = '0.50';
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (savedLedger === undefined) delete process.env.LIVE_BUDGET_LEDGER;
  else process.env.LIVE_BUDGET_LEDGER = savedLedger;
  if (savedLimit === undefined) delete process.env.LIVE_BUDGET_USD;
  else process.env.LIVE_BUDGET_USD = savedLimit;
});

describe('spendBudget — acumula y corta', () => {
  it('acumula los gastos declarados por debajo del techo', () => {
    writeFileSync(ledger, '');

    spendBudget(0.1);
    spendBudget(0.2);

    expect(spentSoFar()).toBeCloseTo(0.3, 5);
    expect(readFileSync(ledger, 'utf8')).toBe('0.1\n0.2\n');
  });

  it('LANZA cuando el siguiente gasto superaría LIVE_BUDGET_USD (y NO lo apunta)', () => {
    writeFileSync(ledger, '');
    spendBudget(0.4);

    // 0,4 + 0,2 = 0,6 > 0,5 → aborta ANTES de la llamada de pago.
    expect(() => {
      spendBudget(0.2);
    }).toThrow(/excederia LIVE_BUDGET_USD/);
    // Y el gasto rechazado NO queda apuntado (si no, el ledger mentiría).
    expect(spentSoFar()).toBeCloseTo(0.4, 5);
  });

  it('respeta un LIVE_BUDGET_USD mayor si se sube explícitamente', () => {
    process.env.LIVE_BUDGET_USD = '2.00';
    writeFileSync(ledger, '');

    spendBudget(1.5);
    expect(() => {
      spendBudget(0.4);
    }).not.toThrow();
    expect(spentSoFar()).toBeCloseTo(1.9, 5);
  });

  it('el acumulado es COMPARTIDO entre ficheros de test (ledger en fichero, no en memoria)', () => {
    // Simula el segundo worker de vitest: proceso distinto, misma ruta de ledger. Si el contador
    // viviera en una variable de módulo, este `spentSoFar()` sería 0 y 3 ficheros de $0,40
    // pasarían un límite de $0,50 gastando $1,20 (external-apis.md §8).
    writeFileSync(ledger, '0.3\n');

    expect(spentSoFar()).toBeCloseTo(0.3, 5);
    expect(() => {
      spendBudget(0.3);
    }).toThrow(/excederia/);
  });

  it('FAIL-CLOSED: sin ledger (fuera de `pnpm test:live`) LANZA en vez de gastar', () => {
    // El ledger NO se crea: es el caso de alguien ejecutando un *.live.test.ts a mano, fuera del
    // proyecto `live`. El guard debe abortar — nunca dejar pasar una llamada de pago sin techo.
    expect(existsSync(ledger)).toBe(false);
    expect(() => {
      spendBudget(0.01);
    }).toThrow(/no existe el ledger/);
  });

  it('LIVE_BUDGET_USD inválido LANZA (no se degrada a "sin límite")', () => {
    process.env.LIVE_BUDGET_USD = 'no-soy-un-numero';
    writeFileSync(ledger, '');
    expect(() => {
      spendBudget(0.01);
    }).toThrow(/LIVE_BUDGET_USD invalido/);
  });
});

/** Doble del `TestProject` que vitest pasa al globalSetup: solo se usa `provide`. */
function fakeProject() {
  const provided: Record<string, unknown> = {};
  return {
    project: { provide: (k: string, v: unknown) => (provided[k] = v) } as unknown as Parameters<
      typeof setupLiveBudget
    >[0],
    provided,
  };
}

describe('globalSetup del proyecto live', () => {
  it('crea el ledger vacío, PUBLICA su ruta por provide() y su teardown lo borra', () => {
    const { project, provided } = fakeProject();
    const teardown = setupLiveBudget(project);

    // La ruta viaja por provide/inject — el ÚNICO canal que cruza a los workers de vitest
    // (`process.env` mutado en el globalSetup no se propaga).
    expect(provided.liveBudgetLedger).toBe(ledger);
    expect(existsSync(ledger)).toBe(true);
    expect(spentSoFar()).toBe(0);

    spendBudget(0.05);
    expect(spentSoFar()).toBeCloseTo(0.05, 5);

    teardown();
    expect(existsSync(ledger)).toBe(false);
  });

  it('TRUNCA un ledger de un run anterior (cada run parte de cero)', () => {
    writeFileSync(ledger, '0.49\n'); // sobrante de un run previo que no hizo teardown

    const { project } = fakeProject();
    const teardown = setupLiveBudget(project);
    expect(spentSoFar()).toBe(0);
    teardown();
  });

  it('SIN LIVE_BUDGET_LEDGER: cada run crea un ledger ÚNICO (dos runs NO se pisan el contador)', () => {
    // Sin ruta en el entorno, el globalSetup hace mkdtemp. Es lo que impide el agujero de dinero:
    // con una ruta FIJA compartida, un segundo `pnpm test:live` truncaría el ledger del primero →
    // el primero volvería a leer $0 y podría gastar el techo OTRA VEZ (hasta $1,00 con cap $0,50).
    delete process.env.LIVE_BUDGET_LEDGER;

    const a = fakeProject();
    const b = fakeProject();
    const teardownA = setupLiveBudget(a.project);
    const teardownB = setupLiveBudget(b.project);

    const ledgerA = a.provided.liveBudgetLedger as string;
    const ledgerB = b.provided.liveBudgetLedger as string;

    expect(ledgerA).not.toBe(ledgerB); // rutas distintas por run
    expect(existsSync(ledgerA)).toBe(true);
    expect(existsSync(ledgerB)).toBe(true);

    // El gasto del run B no toca el contador del run A.
    writeFileSync(ledgerB, '0.45\n');
    expect(readFileSync(ledgerA, 'utf8')).toBe('');

    // Y el teardown de B NO borra el ledger de A (antes sí: era el mismo fichero).
    teardownB();
    expect(existsSync(ledgerB)).toBe(false);
    expect(existsSync(ledgerA)).toBe(true);

    teardownA();
    expect(existsSync(ledgerA)).toBe(false);
  });
});
