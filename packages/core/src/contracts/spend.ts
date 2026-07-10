// Contrato del panel de gasto `GET /api/spend` (T0.12, Apéndice E). Es la vista
// PÚBLICA del ledger: lo que el route handler serializa y la página `/spend` (RSC
// vía api-server) valida y pinta. Definido UNA vez en core; el handler y el cliente
// lo comparten (un drift servidor↔página revienta en test, no en producción).
//
// DINERO EN CÉNTIMOS ENTEROS (coherente con todo el proyecto: `step_run.cost_*`,
// el `cost` del SSE, `formatCost(cents)`). El PRD §12 nombra `amount_usd`/`limit_usd`;
// el código usa `_cents` — divergencia deliberada anotada (regla 6), un céntimo
// entero hace la suma EXACTA (requisito de la Verificación).
import { z } from 'zod';

// Los 4 proveedores facturables (§12). Mismo conjunto que el pgEnum `cost_provider`
// de db y el `costProvider` del DemoConfigSchema — declarado aquí para el contrato
// público del ledger.
export const CostProviderSchema = z.enum(['fal', 'anthropic', 'firecrawl', 'other']);
export type CostProvider = z.infer<typeof CostProviderSchema>;

/** Total gastado por PROVEEDOR (ledger derecho del mockup 8a). */
export const ProviderTotalSchema = z.object({
  provider: CostProviderSchema,
  amountCents: z.number().int(),
  quantity: z.number().int(), // suma de unidades facturadas (0 si ninguna llevaba quantity)
  entries: z.number().int(), // nº de cargos del proveedor
  unit: z.string().nullable(), // unidad representativa (min(unit)), o null
});
export type ProviderTotal = z.infer<typeof ProviderTotalSchema>;

/** Total gastado por DÍA (bucket UTC `YYYY-MM-DD`). */
export const DayTotalSchema = z.object({
  day: z.string(), // 'YYYY-MM-DD' (UTC)
  amountCents: z.number().int(),
  entries: z.number().int(),
});
export type DayTotal = z.infer<typeof DayTotalSchema>;

/** Lo que `/spend` pinta: totales por día y proveedor, gasto total, presupuesto
 *  vigente y la alerta (over-limit) ya computada server-side. */
export const SpendSummarySchema = z.object({
  totalCents: z.number().int(),
  byDay: z.array(DayTotalSchema),
  byProvider: z.array(ProviderTotalSchema),
  /** Límite del presupuesto mensual vigente, o `null` si no hay presupuesto. */
  limitCents: z.number().int().nullable(),
  /** true si hay presupuesto Y el gasto total lo alcanza o supera (dispara la alerta). */
  overLimit: z.boolean(),
});
export type SpendSummary = z.infer<typeof SpendSummarySchema>;
