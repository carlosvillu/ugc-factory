// Guard de PRESUPUESTO del tier live (testing/references/external-apis.md §8). Estrena en T1.8:
// los tests live del BriefSynthesizer son su primer consumidor, y hasta que existió este guard el
// script `test:live` estaba DESHABILITADO a propósito (gastar dinero real sin techo no es
// aceptable).
//
// CONTRATO: cada test live declara su coste estimado ANTES de la llamada de pago con
// `spendBudget(usd)`. El guard acumula y ABORTA si el run excedería `LIVE_BUDGET_USD` (default
// $0,50). Así el gasto máximo de un run es una decisión explícita, no una sorpresa en la factura.
//
// POR QUÉ UN LEDGER EN FICHERO Y NO UNA VARIABLE DE MÓDULO: Vitest ejecuta cada fichero de test en
// un WORKER distinto. Un contador en memoria se resetearía por fichero (3 ficheros de $0,40 pasarían
// un límite de $0,50 gastando $1,20). El total vive en un fichero compartido.
//
// POR QUÉ LA RUTA ES ÚNICA POR RUN (mkdtemp) Y VIAJA POR provide/inject: una ruta FIJA compartida
// entre runs es un agujero de DINERO REAL. Dos `pnpm test:live` concurrentes (o el verifier
// relanzando mientras uno sigue vivo) compartirían el fichero: el globalSetup del segundo lo TRUNCA
// → el primero vuelve a leer $0 y puede gastar el techo OTRA VEZ (hasta $1,00 con un cap de $0,50);
// y el teardown del segundo lo BORRA → el primero pasa a fallar fail-closed a media suite. Con
// `mkdtempSync` por run (lo que pide external-apis.md §8) cada run tiene su ledger aislado.
//
// El canal de propagación es `provide`/`inject` de vitest — el MISMO que usa el harness de Postgres
// de T0.3 (`global-setup.ts`), y el único que cruza la frontera proceso-principal → worker:
// `process.env` mutado en el globalSetup NO se propaga a los workers.
import {
  mkdtempSync,
  appendFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'vitest';
import type { TestProject } from 'vitest/node';

/** Techo por RUN en dólares. Sobrescribible con `LIVE_BUDGET_USD` (.env.test / entorno). */
export const DEFAULT_LIVE_BUDGET_USD = 0.5;

/**
 * Ruta efectiva del ledger, en orden de precedencia:
 *  1. `LIVE_BUDGET_LEDGER` del entorno — contrato público de external-apis.md §8 (permite fijar el
 *     ledger desde fuera: scripts, depuración). Si está, GANA.
 *  2. `inject('liveBudgetLedger')` — la ruta única del run, publicada por el globalSetup.
 * Si no hay ninguna de las dos, lanza: significa que el test NO corre bajo `pnpm test:live`, y sin
 * guard NO se hace una llamada de pago (fail-closed).
 */
function ledgerPath(): string {
  const fromEnv = process.env.LIVE_BUDGET_LEDGER;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;

  // `inject` está TIPADO como string (la augmentación de ProvidedContext), pero en RUNTIME devuelve
  // undefined si el globalSetup del proyecto `live` no corrió (p. ej. el fichero se ejecutó bajo el
  // proyecto `unit`). El cast reconoce esa realidad: es justo el caso fail-closed que hay que cazar.
  const provided = inject('liveBudgetLedger') as string | undefined;
  if (provided === undefined || provided === '') {
    throw new Error(
      '[live-budget] no hay ledger de presupuesto: ejecuta los tests live via `pnpm test:live` ' +
        '(proyecto `live` del vitest.config.ts raiz, cuyo globalSetup lo crea y lo publica por ' +
        'provide/inject), o fija LIVE_BUDGET_LEDGER en el entorno.',
    );
  }
  return provided;
}

function budgetLimit(): number {
  const raw = process.env.LIVE_BUDGET_USD;
  if (raw === undefined || raw === '') return DEFAULT_LIVE_BUDGET_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`[live-budget] LIVE_BUDGET_USD invalido: ${raw}`);
  }
  return parsed;
}

/**
 * Declara el coste estimado de la SIGUIENTE llamada de pago. Lanza (abortando el test) si el
 * acumulado del run superaría el techo. Se llama SIEMPRE antes de la llamada, nunca después:
 * el objetivo es NO gastar, no contabilizar lo ya gastado.
 */
export function spendBudget(estimatedUsd: number): void {
  const ledger = ledgerPath();
  if (!existsSync(ledger)) {
    // El ledger lo crea el globalSetup del proyecto `live`. Si la ruta existe pero el fichero no,
    // algo lo borró: se ABORTA antes de gastar un céntimo (fail-closed: sin guard no hay llamada).
    throw new Error(
      `[live-budget] no existe el ledger (${ledger}): ejecuta los tests live via ` +
        '`pnpm test:live` (proyecto `live` del vitest.config.ts raiz, cuyo globalSetup lo crea).',
    );
  }
  const limit = budgetLimit();
  const spent = readLedger(ledger);

  if (spent + estimatedUsd > limit) {
    throw new Error(
      `[live-budget] ~$${String(estimatedUsd)} excederia LIVE_BUDGET_USD=$${String(limit)} ` +
        `(acumulado: $${spent.toFixed(2)}). Sube el limite explicitamente si es intencional.`,
    );
  }
  appendFileSync(ledger, `${String(estimatedUsd)}\n`);
}

function readLedger(ledger: string): number {
  return readFileSync(ledger, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .reduce((sum, line) => sum + Number(line), 0);
}

/** Total gastado (estimado) en el run actual. Para logs/resúmenes de evidencia. */
export function spentSoFar(): number {
  const ledger = ledgerPath();
  if (!existsSync(ledger)) return 0;
  return readLedger(ledger);
}

/**
 * globalSetup del proyecto `live` (default export — así lo declara el vitest.config.ts raíz).
 * Crea un directorio temporal ÚNICO por run (`mkdtempSync`), pone el ledger vacío dentro y publica
 * su ruta por `provide` (el canal que sí llega a los workers). En el teardown borra el directorio
 * entero. Cada run queda aislado del resto: dos `test:live` simultáneos no se pisan el contador.
 *
 * Si `LIVE_BUDGET_LEDGER` viene del entorno, se respeta esa ruta (contrato público §8) en vez de
 * crear una temporal — pero igualmente se trunca al arrancar y se publica por provide.
 */
export default function setup({ provide }: TestProject): () => void {
  const fromEnv = process.env.LIVE_BUDGET_LEDGER;

  // Ruta del entorno (contrato público §8) o directorio temporal ÚNICO de este run.
  let dir: string | undefined;
  let ledger: string;
  if (fromEnv !== undefined && fromEnv !== '') {
    ledger = fromEnv;
  } else {
    dir = mkdtempSync(join(tmpdir(), 'ugc-live-budget-'));
    ledger = join(dir, 'ledger.txt');
  }

  writeFileSync(ledger, ''); // el run parte de cero
  provide('liveBudgetLedger', ledger);

  const tmpDir = dir;
  return () => {
    if (tmpDir === undefined) rmSync(ledger, { force: true });
    else rmSync(tmpDir, { recursive: true, force: true });
  };
}

// La augmentación de ProvidedContext vive aquí (donde se llama a inject), igual que en
// create-test-database.ts / global-setup.ts.
declare module 'vitest' {
  export interface ProvidedContext {
    liveBudgetLedger: string;
  }
}
