// Repo del ledger de gasto (T0.12): escritura (`recordCost`) y lecturas agregadas
// del panel /spend, más el sembrado idempotente del presupuesto mensual.
//
// DINERO EN CÉNTIMOS ENTEROS (ver nota en schema/ops.ts): `amount_cents` /
// `limit_cents` son integer; las sumas son exactas (requisito de la Verificación).
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { budget, costEntry, type Budget, type CostEntry } from '../schema/ops';

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
