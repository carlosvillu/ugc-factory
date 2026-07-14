// Repo del ledger de gasto (T0.12): escritura (`recordCost`) y lecturas agregadas
// del panel /spend, más el sembrado idempotente del presupuesto mensual.
//
// DINERO EN CÉNTIMOS ENTEROS (ver nota en schema/ops.ts): `amount_cents` /
// `limit_cents` son integer; las sumas son exactas (requisito de la Verificación).
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { budget, costEntry, type Budget, type CostEntry } from '../schema/ops';
import { pipelineRun, stepRun } from '../schema/pipeline';

/** Datos de un cargo. `amountCents`/`quantity`/`unit` describen la facturación;
 *  las refs son opcionales (en F0 casi siempre ausentes). `occurredAt` default
 *  now() en BD si no se pasa. */
interface RecordCostInput {
  provider: CostEntry['provider'];
  amountCents: number;
  quantity?: number;
  unit?: string;
  stepRunId?: string;
  generationId?: string;
  projectId?: string;
  occurredAt?: Date;
}

/**
 * Registra un cargo en `cost_entry` (EFECTO de escritura — vive como repo, no como
 * puerto de core: nada en core lo consume en F0). Inserta UNA fila y la devuelve.
 * Lo invoca el executor de demo (config-injectable) y, en fases reales, cada nodo
 * que gasta (fal/Anthropic/Firecrawl) tras facturar.
 */
export async function recordCost(db: Db, input: RecordCostInput): Promise<CostEntry> {
  const [row] = await db
    .insert(costEntry)
    .values({
      provider: input.provider,
      amountCents: input.amountCents,
      quantity: input.quantity,
      unit: input.unit,
      stepRunId: input.stepRunId,
      generationId: input.generationId,
      projectId: input.projectId,
      // `occurredAt` opcional: `undefined` se omite (igual que los campos de arriba)
      // y aplica el default now() de la columna.
      occurredAt: input.occurredAt,
    })
    .returning();
  if (!row) throw new Error('recordCost: el INSERT no devolvió fila');
  return row;
}

/**
 * ROLLUP de `step_run.cost_actual` desde el ledger (T1.10b — el fix del bloqueo 2).
 *
 * EL SÍNTOMA que arregla: los servicios de pago (Firecrawl/Anthropic) escriben su `cost_entry`
 * (record-first, T1.4), pero NADIE escribía `step_run.cost_actual` — y esa columna es la que
 * suma el KPI "coste real" del canvas (run-shell.tsx). Resultado: el canvas mostraba $0,00 con
 * 20 céntimos REALMENTE gastados, mientras `/spend` (que agrega `cost_entry`) sí veía el dinero.
 *
 * POR QUÉ ROLLUP RECOMPUTABLE Y NO COLUMNA DERIVADA EN LA LECTURA:
 *  - La proyección SSE (`sseColumns`) lee `cost_actual` como COLUMNA PLANA, y el delta
 *    `step_changed` RELEE TODOS los steps del run en CADA `NOTIFY`. Derivar el coste en la
 *    lectura metería un `SUM(cost_entry)` correlacionado en esa query caliente, por step y por
 *    evento — el path más frecuente del sistema paga el precio del caso raro.
 *  - "Rollup" NO significa acumulador: esto RECOMPUTA el total desde `cost_entry` (la única
 *    verdad granular del ledger, T0.12) y lo escribe. Un rollup recomputable no puede derivar:
 *    si alguna vez sospechas de la columna, la vuelves a calcular y coincide por construcción.
 *    Un acumulador (`cost_actual += x`) sí podría, y por eso NO se hace así.
 *
 * FRONTERA (T1.10a): esto lo llama el ORQUESTADOR (el consumer del worker, al cerrar el step),
 * NUNCA `@ugc/services`. Los servicios escriben `cost_entry` —su gasto— y nada más; la columna
 * del step es territorio del step.
 */
export async function rollupStepCost(db: Db, stepRunId: string): Promise<void> {
  await db
    .update(stepRun)
    .set({
      // `coalesce(sum(...), 0)` — un step sin cargos queda en 0, no en NULL: "ejecutado y no
      // gastó" es información, y es distinto de "todavía no se sabe" (NULL, el valor previo a
      // ejecutarse). `::int` es seguro aquí (el total de UN step, no del ledger entero).
      costActual: sql<number>`(
        select coalesce(sum(${costEntry.amountCents}), 0)::int
        from ${costEntry}
        where ${costEntry.stepRunId} = ${stepRunId}
      )`,
    })
    .where(eq(stepRun.id, stepRunId));
}

/**
 * ROLLUP de `pipeline_run.total_cost_actual` desde el ledger (T1.20). El AGREGADO del run,
 * hermano del rollup por step: misma disciplina (RECOMPUTA, no acumula) y mismo momento (la
 * transición que liquida un step del run, vía el puerto `CostStore`).
 *
 * SE AGREGA DEL LEDGER, NO SUMANDO `step_run.cost_actual`. Es deliberado: sumar la columna
 * de los steps haría que el agregado heredase cualquier mentira de la proyección (que es
 * justo el bug que T1.20 arregla), y encima dependería del orden en que se cerraron. El
 * ledger es la verdad; los dos rollups la leen del mismo sitio, así que cuadran al céntimo
 * por construcción, no por coincidencia.
 *
 * Se suma por `run_id` recorriendo `step_run` (el `cost_entry` guarda `step_run_id`, no
 * `run_id`). Un cargo sin step (`step_run_id` NULL — hoy no los hay) NO cuenta para ningún
 * run: no pertenece a ninguno.
 *
 * DEDUPLICADO POR TRANSACCIÓN en el adaptador (cost-store.ts §2).
 */
export async function rollupRunCost(db: Db, runId: string): Promise<void> {
  await db
    .update(pipelineRun)
    .set({
      // `coalesce(..., 0)`: un run sin cargos queda en 0 ("corrió y no gastó"), no en NULL.
      // Coherente con `rollupStepCost`.
      //
      // El `::int` NO es "seguro" en el mismo sentido que el de un step: aquí se suma el gasto
      // de TODOS los steps del run, y un lote de F2 (decenas de generaciones de fal.ai) tiene
      // mucho menos margen contra el techo de int4 (~$21,4 M en céntimos) que un solo step. Se
      // castea igualmente porque `total_cost_actual` ES una columna `integer`: sin el cast, el
      // `sum()` (que Postgres agrega en bigint) ni siquiera encajaría. El día que el techo
      // apriete, lo que hay que cambiar es el TIPO de la columna — y eso es una migración, no un
      // cast. Mientras tanto, un overflow aquí NO tumba nada: el rollup corre dentro de un
      // savepoint (cost-store.ts) y su fallo solo deja la columna sin actualizar, con traza.
      totalCostActual: sql<number>`(
        select coalesce(sum(${costEntry.amountCents}), 0)::int
        from ${costEntry}
        join ${stepRun} on ${stepRun.id} = ${costEntry.stepRunId}
        where ${stepRun.runId} = ${runId}
      )`,
    })
    .where(eq(pipelineRun.id, runId));
}

/** Total gastado por PROVEEDOR (con nº de filas y suma de cantidad). Ordenado por
 *  gasto descendente: el panel lista el proveedor más caro primero. */
interface ProviderTotal {
  provider: CostEntry['provider'];
  amountCents: number;
  quantity: number;
  entries: number;
  /** Unidad representativa del proveedor (`min(unit)`, determinista), o null si sus
   *  cargos no llevan unidad. En F0 un proveedor suele facturar una sola unidad; el
   *  desglose por unidad/tier llega con el panel completo (T7.7). */
  unit: string | null;
}

/** Total gastado por DÍA (bucket UTC de `occurred_at`). Ordenado ascendente. */
interface DayTotal {
  /** Día en formato `YYYY-MM-DD` (UTC). */
  day: string;
  amountCents: number;
  entries: number;
}

/** Lo que /spend necesita para pintar: totales por día, por proveedor, gasto total
 *  y el presupuesto vigente (si hay). `overLimit` = gasto total ≥ límite. */
interface SpendSummary {
  totalCents: number;
  byDay: DayTotal[];
  byProvider: ProviderTotal[];
  /** Límite del presupuesto mensual vigente, o `null` si no hay presupuesto. */
  limitCents: number | null;
  /** true si hay presupuesto Y el gasto total lo alcanza o supera. */
  overLimit: boolean;
}

/** Agrupa `cost_entry` por proveedor. Suma en SQL (no en JS): el panel no carga el
 *  ledger entero, solo los agregados. */
async function totalsByProvider(db: Db): Promise<ProviderTotal[]> {
  const rows = await db
    .select({
      provider: costEntry.provider,
      // DINERO: `coalesce(sum(…), 0)::bigint` + `Number(...)` en JS van SIEMPRE
      // JUNTOS y son AMBOS load-bearing (NO decorativos — no los "limpies"):
      //  - `sum()` de Postgres sobre una columna `integer` ya agrega en `bigint`
      //    (para no desbordar); castear a `::int` (int4, techo ~$21.4M en céntimos)
      //    reintroduce el overflow → `integer out of range` → /spend 500. Por eso
      //    `::bigint`.
      //  - PERO con `::bigint` el driver de pg entrega el valor como STRING (no
      //    number). Sin el `Number(...)` de abajo, `SpendSummarySchema.parse`
      //    (z.number().int()) fallaría en CADA request. El antiguo `::int` devolvía
      //    number solo por accidente (int4 cabe en el rango seguro de JS).
      // `coalesce(…, 0)` cubre el SUM NULL de `quantity` (nullable) → nunca null.
      amountCents: sql<string>`coalesce(sum(${costEntry.amountCents}), 0)::bigint`,
      quantity: sql<string>`coalesce(sum(${costEntry.quantity}), 0)::bigint`,
      entries: sql<number>`count(*)::int`,
      unit: sql<string | null>`min(${costEntry.unit})`,
    })
    .from(costEntry)
    .groupBy(costEntry.provider)
    .orderBy(sql`sum(${costEntry.amountCents}) desc`);
  // bigint → number en JS (ver comentario arriba): el contrato Zod exige number.
  return rows.map((r) => ({
    ...r,
    amountCents: Number(r.amountCents),
    quantity: Number(r.quantity),
  }));
}

/** Agrupa `cost_entry` por día (UTC). `date_trunc('day', … AT TIME ZONE 'UTC')`
 *  fija el bucket a UTC — determinista con independencia de la TZ de la sesión, lo
 *  que hace reproducible el assert de "suma por día" del spec y del verifier. */
async function totalsByDay(db: Db): Promise<DayTotal[]> {
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${costEntry.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      // `::bigint` + `Number()` juntos (mismo motivo que totalsByProvider): evita el
      // overflow de int4 y devuelve number para el contrato Zod.
      amountCents: sql<string>`coalesce(sum(${costEntry.amountCents}), 0)::bigint`,
      entries: sql<number>`count(*)::int`,
    })
    .from(costEntry)
    .groupBy(sql`date_trunc('day', ${costEntry.occurredAt} at time zone 'UTC')`)
    .orderBy(sql`date_trunc('day', ${costEntry.occurredAt} at time zone 'UTC') asc`);
  return rows.map((r) => ({ ...r, amountCents: Number(r.amountCents) }));
}

/** Presupuesto `monthly` vigente (el más reciente por id ULID, que es ordenable por
 *  tiempo), o `undefined` si no hay ninguno. En T7.7 llega el scope `batch`. */
async function findMonthlyBudget(db: Db): Promise<Budget | undefined> {
  const [row] = await db
    .select()
    .from(budget)
    .where(eq(budget.scope, 'monthly'))
    .orderBy(sql`${budget.id} desc`)
    .limit(1);
  return row;
}

/** Compone todo lo que /spend pinta en una sola llamada. La alerta (over-limit) se
 *  computa aquí, server-side: gasto total ≥ límite. */
export async function getSpendSummary(db: Db): Promise<SpendSummary> {
  const [byDay, byProvider, monthly] = await Promise.all([
    totalsByDay(db),
    totalsByProvider(db),
    findMonthlyBudget(db),
  ]);
  // `provider` es NOT NULL y `totalsByProvider` agrega TODAS las filas sin filtro, así
  // que la suma de sus enteros == el gasto total (evita una 4ª query redundante). Suma
  // de números enteros: exacta, sin float.
  const totalCents = byProvider.reduce((sum, p) => sum + p.amountCents, 0);
  const limitCents = monthly?.limitCents ?? null;
  return {
    totalCents,
    byDay,
    byProvider,
    limitCents,
    overLimit: limitCents !== null && totalCents >= limitCents,
  };
}

/**
 * Siembra un presupuesto `monthly` SOLO si no existe ya uno (insert-if-absent,
 * idempotente — mismo patrón que `seedPasswordHashIfAbsent`). Lo llama el arranque
 * de web desde `BUDGET_MONTHLY_LIMIT_CENTS`: así el verifier puede fijar un límite
 * por debajo del gasto y ver la alerta, sin panel de settings (T7.7). Devuelve el
 * presupuesto vigente (el recién sembrado o el que ya existía).
 */
export async function seedMonthlyBudgetIfAbsent(db: Db, limitCents: number): Promise<Budget> {
  const existing = await findMonthlyBudget(db);
  if (existing) return existing;
  const [row] = await db.insert(budget).values({ scope: 'monthly', limitCents }).returning();
  if (!row) throw new Error('seedMonthlyBudgetIfAbsent: el INSERT no devolvió fila');
  return row;
}
