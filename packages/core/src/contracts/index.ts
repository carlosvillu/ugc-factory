// Contratos transversales del pipeline (architecture.md §4).
export { HealthStatusSchema, type HealthStatus } from './health';
export { newUlid, UlidSchema } from './ids';
// Errores tipados (architecture.md §5): AppError + su unión de codes/status, y el
// envelope Zod que la capa API serializa (api.md §2). api.md importa AMBOS de
// `@ugc/core/contracts`.
export { AppError, APP_ERROR_CODES, STATUS_BY_CODE, type AppErrorCode } from './app-error';
export { ErrorEnvelopeSchema, ErrorCodeSchema, type ErrorEnvelope, type ErrorCode } from './errors';
// Panel de gasto `GET /api/spend` (T0.12): la vista pública del ledger que el route
// handler serializa y la página /spend valida. Céntimos enteros (ver spend.ts).
export {
  SpendSummarySchema,
  ProviderTotalSchema,
  DayTotalSchema,
  CostProviderSchema,
  type SpendSummary,
  type ProviderTotal,
  type DayTotal,
  type CostProvider,
} from './spend';
