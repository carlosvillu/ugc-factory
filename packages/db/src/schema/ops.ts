// Dominio `ops` (§12). En T0.3 solo `app_setting` y `audit_log`, y SOLO como
// tablas: sin repo ni writer (eso es T0.4 para app_setting; el writer de
// audit_log llega con su consumidor). El resto del mapa de db.md §1 (cost_entry,
// budget) llega con sus tareas.
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { ulidPk } from './columns.helpers';

// §12: `app_setting key, value jsonb`. La PK es `key` (NO un ULID): es un
// key-value de configuración (API keys cifradas, defaults, umbrales kill/scale).
// El cifrado de `value` y su writer son T0.4 — aquí solo la tabla.
export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

export type AppSetting = typeof appSetting.$inferSelect;
export type NewAppSetting = typeof appSetting.$inferInsert;

// §12: `audit_log id, actor, action, entity, entity_id, diff jsonb, at`.
// `at` = timestamp del evento (con timezone); `diff` = el cambio en JSONB.
// Tabla sin writer en T0.3.
export const auditLog = pgTable('audit_log', {
  id: ulidPk(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  diff: jsonb('diff'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// §12: `cost_entry provider, amount, quantity, unit, occurred_at` (+ refs).
// Ledger de gasto (T0.12): cada fila es UN cargo facturable de un proveedor.
export const costProvider = pgEnum('cost_provider', ['fal', 'anthropic', 'firecrawl', 'other']);

// DIVERGENCIA DELIBERADA DE NOMBRE (PRD §12 vs código, anotada por regla 6):
// el PRD nombra la columna `amount_usd`; el código la llama `amount_cents` y
// guarda CÉNTIMOS ENTEROS, coherente con todo el dinero del proyecto
// (`step_run.cost_estimated/actual` son integer; el contrato SSE lleva `cost` "en
// céntimos"; `formatCost(cents)` divide entre 100). Un entero de céntimos hace
// EXACTA la suma del ledger (un float daría 4.85000…1 y rompería la Verificación).
// DEUDA CONSCIENTE (diferida a F4): los costes reales de APIs son sub-céntimo
// (Anthropic ~$0.000003/token); en F0 todo es $0 y el verifier usa importes
// redondos, así que migrar a micro-unidades/`numeric` luego es barato. YAGNI aquí.
export const costEntry = pgTable(
  'cost_entry',
  {
    id: ulidPk(),
    provider: costProvider('provider').notNull(),
    // Refs opcionales SIN FK dura: `step_run_id`/`project_id` apuntan a tablas que
    // existen pero la fila de coste puede no tener step/project (coste global) —
    // se dejan como texto nullable sin FK para no atar el ledger al ciclo de vida
    // de esas filas (un run borrado no debe borrar su historia de gasto). El panel
    // por proyecto/lote es T7.7; en F0 estas refs quedan casi siempre null.
    // `generation_id` NO existe como tabla hasta F4: nullable sin FK, por PRD.
    stepRunId: text('step_run_id'),
    generationId: text('generation_id'),
    projectId: text('project_id'),
    amountCents: integer('amount_cents').notNull(), // céntimos enteros; NUNCA float
    quantity: integer('quantity'), // nº de unidades facturadas (segundos/imágenes/tokens…)
    unit: text('unit'), // libre: 'seconds'|'images'|'tokens'|'credits'…
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // §12 "Índices clave": el panel /spend filtra/ordena/agrupa por fecha.
    index('cost_entry_occurred_at_idx').on(t.occurredAt),
    // T1.10b — EL ÍNDICE DEL ROLLUP. `rollupStepCost` (spend.repo) recomputa
    // `step_run.cost_actual` con un `SUM(amount_cents) WHERE step_run_id = $1` en CADA cierre
    // de step. `cost_entry` es un ledger APPEND-ONLY que crece sin techo, así que sin índice esa
    // query es un SEQ SCAN DEL LEDGER ENTERO — y encima justo ANTES del NOTIFY, o sea
    // retrasando el SSE del run. Es lo que hace cierto el argumento de "correr el rollup en
    // todos los cierres es barato": barato lo es CON índice.
    //
    // PARCIAL, con el mismo criterio que `product_brief_origin_step_key`: el comentario de la
    // columna de arriba ya dice que `step_run_id` está "casi siempre null" (los costes globales
    // y los de F0 no cuelgan de un step). El índice solo cubre las filas que el rollup busca, y
    // Postgres lo usa igual para el `= $1` — una igualdad NUNCA casa NULL.
    index('cost_entry_step_run_id_idx')
      .on(t.stepRunId)
      .where(sql`${t.stepRunId} is not null`),
  ],
);

export type CostEntry = typeof costEntry.$inferSelect;
export type NewCostEntry = typeof costEntry.$inferInsert;

// §12: `budget scope, limit, alert_thresholds`. El presupuesto vigente contra el
// que /spend compara el gasto total. En F0 (T0.12) solo el scope `monthly` se usa.
export const budgetScope = pgEnum('budget_scope', ['monthly', 'batch']);

export const budget = pgTable('budget', {
  id: ulidPk(),
  scope: budgetScope('scope').notNull(),
  limitCents: integer('limit_cents').notNull(), // céntimos enteros (ver nota en cost_entry)
  // `alert_thresholds`: porcentajes (p.ej. [70, 90]). Se CREA per PRD §12, pero la
  // lógica de umbrales-porcentaje es T7.7 — la columna existe, no se cablea aún.
  // Default `{}` para que un budget sembrado sin umbrales sea legal en F0.
  alertThresholds: integer('alert_thresholds')
    .array()
    .notNull()
    .default(sql`'{}'::integer[]`),
});

export type Budget = typeof budget.$inferSelect;
export type NewBudget = typeof budget.$inferInsert;
