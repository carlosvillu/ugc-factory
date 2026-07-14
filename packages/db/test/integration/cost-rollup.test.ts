// T1.20 — EL COSTE POR STEP DEBE SER EL REAL, VENGA EL CIERRE POR DONDE VENGA.
//
// EL BUG QUE ESTA SUITE FIJA PARA SIEMPRE. Hasta T1.20, el rollup de `step_run.cost_actual`
// lo hacía el CONSUMER del worker justo antes de cerrar bien un step. Consecuencia: un step
// que FALLA HABIENDO GASTADO (el executor llamó a Firecrawl/Anthropic, se registró el
// `cost_entry` record-first, y LUEGO reventó) dejaba la columna a NULL — y el nodo del canvas
// mostraba $0,00 mientras la cabecera del run (que suma el ledger) mostraba 13¢. Dos cifras
// contradictorias en la misma pantalla, y la del nodo era la falsa. Lo mismo en el `expire`
// del sweeper, el `cancel`, el `reject`, el `supersede`…
//
// EL FIX es de ORIGEN: el rollup corre ahora dentro de `applyTransition` (core), gateado por
// `settlesCost(event)` — el EMBUDO ÚNICO por el que pasan TODOS los cierres. Por eso esta
// suite recorre los caminos de cierre UNO A UNO contra Postgres real: cada `it` es un camino
// distinto, y todos exigen la MISMA propiedad. Si alguien vuelve a mover el rollup a un
// camino concreto (el consumer, un handler), estos tests se ponen rojos en los demás.
//
// La cláusula "la suma de los nodos cuadra con el ledger AL CÉNTIMO" de la Verificación es
// determinista y gratuita ⇒ vive aquí como test permanente (regla de trabajo 8 del planning).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { transition, failStep, cancelRun } from '@ugc/core/orchestrator';
import type { StepEvent } from '@ugc/core/orchestrator';
import { makeTestLogger, type TestLogger } from '@ugc/test-utils';
import { makeWithTransaction } from '../../src/index';
import { recordCost } from '../../src/repos/spend.repo';
import { pipelineRun, stepRun } from '../../src/schema/pipeline';
import { OrchestratorEnv } from './orchestrator-harness';

const env = new OrchestratorEnv('db:cost-rollup');
const tdb = () => env.tdb;

// Logger compartido por la suite: silencioso, pero REGISTRA — para poder afirmar que un rollup
// que falla deja su traza estructurada (y no se traga el error en silencio, que era el agujero
// de observabilidad del `console.warn`).
let logger: TestLogger;
const deps = () => ({
  withTransaction: makeWithTransaction(tdb().db, env.activeBoss(), logger),
});

beforeAll(() => env.start());
afterAll(() => env.stop());
beforeEach(async () => {
  logger = makeTestLogger();
  await env.reset();
});

/** El `cost_actual` que la columna dice HOY para ese step (lo que pinta el nodo del canvas). */
async function costActual(stepId: string): Promise<number | null> {
  const [row] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, stepId));
  return row!.costActual;
}

/** El `total_cost_actual` del run (el agregado de §12). */
async function totalCostActual(runId: string): Promise<number | null> {
  const [row] = await tdb().db.select().from(pipelineRun).where(eq(pipelineRun.id, runId));
  return row!.totalCostActual;
}

describe('rollup del coste en la transición — TODOS los caminos de cierre (T1.20)', () => {
  // El caso REAL que originó la tarea: el step gastó y luego falló. `failStep` con los
  // retries AGOTADOS deja el step en `failed` TERMINAL — y ese cierre nunca pasó por el
  // rollup viejo. Es el test que reproduce los runs muertos del usuario (16¢ y 13¢).
  it('un step que FALLA habiendo gastado deja `cost_actual` con el dinero REAL (no NULL)', async () => {
    const { runId, stepIds } = await seedRunning({ maxRetries: 0 });
    const id = stepIds[0]!;
    await recordCost(tdb().db, { provider: 'firecrawl', amountCents: 3, stepRunId: id });
    await recordCost(tdb().db, { provider: 'anthropic', amountCents: 10, stepRunId: id });

    const outcome = await failStep(deps(), id, { error: { message: 'boom' } });

    expect(outcome).toBe('exhausted'); // failed TERMINAL: el camino del run muerto
    expect(await costActual(id)).toBe(13); // ← el bug: aquí había NULL (y $0,00 en el nodo)
    expect(await totalCostActual(runId)).toBe(13); // y el agregado del run, también
  });

  // El resto de caminos de cierre. Se enumeran AQUÍ (en el test) precisamente porque el
  // CÓDIGO ya no los enumera: la garantía es que pasar por `applyTransition` basta.
  const CLOSING_PATHS: { event: StepEvent; expected: string }[] = [
    { event: 'succeed', expected: 'succeeded' },
    { event: 'expire', expected: 'expired' }, // sweeper (T0.9)
    { event: 'cancel', expected: 'cancelled' }, // cancelación del run (T0.8)
    { event: 'supersede', expected: 'superseded' }, // invalidación de sub-grafo (§7.1.c)
    { event: 'skip_inapplicable', expected: 'skipped' }, // auto-skip (T1.10a)
    // `reach_checkpoint` NO es terminal (running→waiting_approval) y por eso NO está en
    // `setsFinishedAt` — pero SÍ liquida el coste: un checkpoint real (N3/CP1) hace su
    // trabajo y LO PAGA antes de pausar. Sin esta fila, el nodo mostraría $0,00 durante
    // TODA la ventana de aprobación (lo que tarde el humano) habiendo gastado ya.
    { event: 'reach_checkpoint', expected: 'waiting_approval' },
  ];

  for (const { event, expected } of CLOSING_PATHS) {
    it(`\`${event}\` (→ ${expected}) recomputa cost_actual desde el ledger`, async () => {
      const { runId, stepIds } = await seedRunning();
      const id = stepIds[0]!;
      await recordCost(tdb().db, { provider: 'anthropic', amountCents: 7, stepRunId: id });

      await transition(deps(), id, event);

      const [row] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));
      expect(row!.status).toBe(expected);
      expect(row!.costActual).toBe(7);
      expect(await totalCostActual(runId)).toBe(7);
    });
  }

  it('`approve` / `reject` de un checkpoint también liquidan (el gasto ya estaba hecho)', async () => {
    for (const event of ['approve', 'reject'] as const) {
      await env.reset();
      const { runId, stepIds } = await env.seed([
        { status: 'waiting_approval', nodeKey: 'N3', isCheckpoint: true },
      ]);
      const id = stepIds[0]!;
      await recordCost(tdb().db, { provider: 'anthropic', amountCents: 5, stepRunId: id });

      await transition(deps(), id, event);

      expect(await costActual(id)).toBe(5);
      expect(await totalCostActual(runId)).toBe(5);
    }
  });

  it('un step SIN cargos que cierra queda en 0 (ejecutó y no gastó ≠ no se sabe)', async () => {
    const { runId, stepIds } = await seedRunning();
    await transition(deps(), stepIds[0]!, 'succeed');
    expect(await costActual(stepIds[0]!)).toBe(0);
    expect(await totalCostActual(runId)).toBe(0);
  });

  it('el rollup RECOMPUTA (no acumula): dos cierres seguidos no duplican el gasto', async () => {
    // fail (13¢) → retry → succeed: el ledger acumula lo de AMBOS intentos (los dos se
    // pagaron), pero la columna NO puede sumar dos veces el mismo cargo. Recomputar desde
    // `cost_entry` lo garantiza por construcción; un acumulador (`cost_actual += x`) daría 26.
    const { stepIds } = await seedRunning({ maxRetries: 1 });
    const id = stepIds[0]!;
    await recordCost(tdb().db, { provider: 'anthropic', amountCents: 13, stepRunId: id });

    expect(await failStep(deps(), id, {})).toBe('retried'); // fail + retry en la misma tx
    expect(await costActual(id)).toBe(13); // el fail liquidó
    await transition(deps(), id, 'start');
    await transition(deps(), id, 'succeed');

    expect(await costActual(id)).toBe(13); // NO 26: se recomputó, no se acumuló
  });

  it('LA CLÁUSULA DE LA VERIFICACIÓN: la suma de los nodos cuadra con el ledger AL CÉNTIMO', async () => {
    // Un run con la forma real de los muertos del usuario: N1 y N2 cierran bien, N3 gasta y
    // MUERE. Antes de T1.20, sumar la columna de los nodos daba 4 (N3 aportaba NULL) mientras
    // el ledger decía 16: la mentira de la tarea, en una sola línea de aritmética.
    const { runId, stepIds } = await env.seed([
      { status: 'running', nodeKey: 'N1' },
      { status: 'running', nodeKey: 'N2' },
      { status: 'running', nodeKey: 'N3', maxRetries: 0 },
    ]);
    const [n1, n2, n3] = stepIds as [string, string, string];
    await recordCost(tdb().db, { provider: 'firecrawl', amountCents: 3, stepRunId: n1 });
    await recordCost(tdb().db, { provider: 'anthropic', amountCents: 1, stepRunId: n2 });
    await recordCost(tdb().db, { provider: 'anthropic', amountCents: 12, stepRunId: n3 });

    await transition(deps(), n1, 'succeed');
    await transition(deps(), n2, 'succeed');
    await failStep(deps(), n3, { error: { message: 'el brief reventó' } }); // gastó y murió

    // 1) Cada nodo dice SU dinero (ninguno miente, ni el muerto).
    expect(await costActual(n1)).toBe(3);
    expect(await costActual(n2)).toBe(1);
    expect(await costActual(n3)).toBe(12);
    // 2) La suma de los NODOS == el LEDGER, al céntimo (enteros: igualdad exacta, sin float).
    const nodes = await tdb().db.select().from(stepRun).where(eq(stepRun.runId, runId));
    const sumNodes = nodes.reduce((acc, s) => acc + (s.costActual ?? 0), 0);
    const { rows } = await tdb().pool.query<{ total: number }>(
      `SELECT coalesce(sum(ce.amount_cents), 0)::int AS total
         FROM cost_entry ce JOIN step_run sr ON sr.id = ce.step_run_id
        WHERE sr.run_id = $1`,
      [runId],
    );
    expect(sumNodes).toBe(16);
    expect(sumNodes).toBe(rows[0]!.total);
    // 3) Y el AGREGADO del run (la cabecera) cuadra con los dos.
    expect(await totalCostActual(runId)).toBe(16);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────
  // LA PROPIEDAD QUE JUSTIFICA TODO EL DISEÑO DEL PUERTO: un rollup que REVIENTA no puede
  // tumbar la transición. Y no es un detalle de robustez: SIN el SAVEPOINT del adaptador,
  // este test es ROJO — porque en Postgres un statement que falla dentro de una transacción
  // la deja ABORTADA (25P02), así que el `pg_notify` y el COMMIT de la transición morirían
  // detrás de él, y el step se quedaría VARADO en `running` con su trabajo YA HECHO. Un
  // try/catch de JavaScript NO salva una tx envenenada; solo un ROLLBACK TO SAVEPOINT.
  //
  // Se fuerza el fallo con el SQL REAL (no con un fake que lanza: eso solo probaría que un
  // fake lanza): dos cargos de 2.000 millones de céntimos desbordan el `::int` (int4) del
  // `sum()` del rollup ⇒ `integer out of range` DENTRO de la tx de la transición.
  //
  // Si alguien "simplifica" `bestEffort` quitándole la tx anidada, esto se pone rojo. Ese es
  // exactamente su trabajo.
  // ───────────────────────────────────────────────────────────────────────────────────────
  it('un rollup que REVIENTA no tumba la transición (el savepoint la salva): el step CIERRA igual', async () => {
    const { runId, stepIds } = await seedRunning({ maxRetries: 0 });
    const id = stepIds[0]!;
    // 2 × 2.000.000.000 = 4.000.000.000 > 2.147.483.647 (int4) ⇒ el `::int` del rollup revienta.
    await recordCost(tdb().db, { provider: 'fal', amountCents: 2_000_000_000, stepRunId: id });
    await recordCost(tdb().db, { provider: 'fal', amountCents: 2_000_000_000, stepRunId: id });

    // La transición NO lanza: el rollup falló dentro de su savepoint y se tragó el error.
    await expect(failStep(deps(), id, { error: { message: 'boom' } })).resolves.toBe('exhausted');

    // Y COMMITEÓ: el estado del step está en la BD (lectura nueva, fuera de aquella tx). Sin
    // savepoint, la tx habría abortado y el step seguiría `running`.
    const [row] = await tdb().db.select().from(stepRun).where(eq(stepRun.id, id));
    expect(row!.status).toBe('failed');
    expect(row!.finishedAt).toBeInstanceOf(Date);
    // El rollup, en cambio, no escribió nada (su savepoint se revirtió): la columna queda
    // DESACTUALIZADA — que es precisamente el precio aceptado. No es dinero perdido: el
    // `cost_entry` sigue ahí, y el rollup es RECOMPUTABLE.
    expect(row!.costActual).toBeNull();
    expect(await totalCostActual(runId)).toBeNull();
  });
  // ───────────────────────────────────────────────────────────────────────────────────────
  // CONCURRENCIA REAL: dos steps HERMANOS del mismo run cerrando A LA VEZ.
  //
  // Hasta T1.20 NADA en la suite ejercía dos actores simultáneos sobre el orquestador, y el
  // rollup del run introduce una escritura NUEVA sobre una fila COMPARTIDA por todos los steps
  // (`pipeline_run`): dos cierres concurrentes del mismo run pelean por ella. Que el agregado
  // sea correcto con un solo actor no dice NADA sobre qué pasa con dos (principio 9 de la skill
  // de testing: el arnés no puede ser más cómodo que la realidad — en producción el consumer del
  // worker y el sweeper cierran steps del mismo run sin pedirse permiso).
  //
  // Lo que se exige: las DOS transiciones COMMITEAN (ninguna muere por contención ni por
  // deadlock) y el agregado del run queda con el total EXACTO — el de la última en commitear,
  // que ve el ledger entero porque los cargos ya estaban escritos antes (record-first).
  // ───────────────────────────────────────────────────────────────────────────────────────
  it('dos steps del MISMO run cerrando EN PARALELO: ambos commitean y el agregado queda exacto', async () => {
    const { runId, stepIds } = await env.seed([
      { status: 'running', nodeKey: 'N1' },
      { status: 'running', nodeKey: 'N2' },
    ]);
    const [a, b] = stepIds as [string, string];
    await recordCost(tdb().db, { provider: 'firecrawl', amountCents: 4, stepRunId: a });
    await recordCost(tdb().db, { provider: 'anthropic', amountCents: 9, stepRunId: b });

    // Dos transiciones CONCURRENTES de verdad: dos `withTransaction` distintos, dos conexiones
    // del pool, sin coordinación entre ellas.
    await Promise.all([transition(deps(), a, 'succeed'), transition(deps(), b, 'succeed')]);

    // 1) Las dos commitearon (ninguna se perdió por la contención sobre la fila del run).
    const rows = await tdb().db.select().from(stepRun).where(eq(stepRun.runId, runId));
    expect(rows.map((r) => r.status).sort()).toEqual(['succeeded', 'succeeded']);
    // 2) Cada nodo, su dinero.
    expect(await costActual(a)).toBe(4);
    expect(await costActual(b)).toBe(9);
    // 3) Y el AGREGADO es el total EXACTO, no el de una sola de las dos (que sería 4 o 9 si el
    //    rollup del run se pisara a sí mismo o leyera un ledger a medias).
    expect(await totalCostActual(runId)).toBe(13);
  });

  it('un `cancelRun` de N steps recomputa el agregado del run UNA sola vez (dedup por tx)', async () => {
    // La razón de la dedup: `cancelRun` aplica una transición por cada step no-terminal del run,
    // y cada una llama a `rollupRun` del MISMO run. Sin dedup serían N `SUM` idénticos (39 de 40
    // desperdiciados en un lote de F2) y N tomas del lock de escritura de la fila del run. NO es
    // un fix de deadlock —no existe tal ciclo—: es eficiencia y menos contención.
    //
    // Se observa por el efecto: el agregado queda correcto UNA vez. La dedup en sí se afirma
    // sobre el store (unit, abajo), porque contar UPDATEs desde fuera exigiría instrumentar el
    // driver.
    const { runId, stepIds } = await env.seed([
      { status: 'running', nodeKey: 'N1' },
      { status: 'pending', nodeKey: 'N2' },
      { status: 'awaiting_deps', nodeKey: 'N3' },
    ]);
    await recordCost(tdb().db, { provider: 'anthropic', amountCents: 6, stepRunId: stepIds[0]! });

    // Se CUENTAN los UPDATE que Postgres ejecuta de verdad sobre `pipeline_run` (trigger): sin
    // dedup serían 3 (uno por step cancelado); con dedup, 1.
    let cancelled = 0;
    const updates = await countPipelineRunUpdates(async () => {
      cancelled = await cancelRun(deps(), runId);
    });

    expect(cancelled).toBe(3); // los 3 no-terminales
    expect(updates).toBe(1); // ← LA DEDUP: UN solo UPDATE del agregado, no uno por step
    expect(await costActual(stepIds[0]!)).toBe(6); // el que gastó, con su dinero
    expect(await totalCostActual(runId)).toBe(6); // el agregado, exacto
  });

  it('el rollup que falla DEJA TRAZA estructurada (un fallo tragado sin señal es el bug otra vez)', async () => {
    // El rollup se traga sus errores a propósito (no puede tumbar la transición). El precio de
    // eso es que, si empezara a fallar sistemáticamente, la columna del dinero volvería a mentir
    // — y sin traza, en SILENCIO y para siempre. Por eso el fallo tragado DEBE loguearse con el
    // id afectado: es la única señal que queda. (Un `console.warn` no entra en el pino de
    // web/worker y no se puede afirmar sobre él; este test no existiría.)
    const { stepIds } = await seedRunning({ maxRetries: 0 });
    const id = stepIds[0]!;
    // Mismo truco que el test del savepoint: desborda el ::int del rollup.
    await recordCost(tdb().db, { provider: 'fal', amountCents: 2_000_000_000, stepRunId: id });
    await recordCost(tdb().db, { provider: 'fal', amountCents: 2_000_000_000, stepRunId: id });

    await failStep(deps(), id, { error: { message: 'boom' } });

    const warns = logger.entries.filter((e) => e.level === 'warn');
    // Hay traza, lleva el ERROR y lleva el ID del step afectado (grepeable en producción).
    expect(warns.length).toBeGreaterThan(0);
    expect(warns.some((w) => 'stepId' in w.obj && w.obj.stepId === id && 'err' in w.obj)).toBe(
      true,
    );
  });
});

/** Un run con un único step `running` listo para cerrarse por el camino que toque. */
function seedRunning(overrides: { maxRetries?: number } = {}) {
  return env.seed([{ status: 'running', nodeKey: 'N3', ...overrides }]);
}

/** Cuenta los UPDATE que Postgres ejecuta REALMENTE sobre `pipeline_run`, con un TRIGGER que
 *  el test instala en su propia BD clonada. Es exacto y síncrono (a diferencia de los contadores
 *  de `pg_stat_*`, que el colector agrega de forma asíncrona y darían un valor viejo), y mide lo
 *  que de verdad llegó a la BD — no una instrumentación de nuestro código, que podría mentir
 *  igual que el código que pretende vigilar. */
async function countPipelineRunUpdates(op: () => Promise<void>): Promise<number> {
  await tdb().pool.query(`
    CREATE TABLE IF NOT EXISTS t120_update_probe (n int NOT NULL);
    TRUNCATE t120_update_probe;
    CREATE OR REPLACE FUNCTION t120_probe() RETURNS trigger AS $$
      BEGIN INSERT INTO t120_update_probe(n) VALUES (1); RETURN NEW; END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS t120_probe_trg ON pipeline_run;
    CREATE TRIGGER t120_probe_trg AFTER UPDATE ON pipeline_run
      FOR EACH ROW EXECUTE FUNCTION t120_probe();
  `);
  try {
    await op();
    const { rows } = await tdb().pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM t120_update_probe',
    );
    return rows[0]!.n;
  } finally {
    await tdb().pool.query('DROP TRIGGER IF EXISTS t120_probe_trg ON pipeline_run');
  }
}
