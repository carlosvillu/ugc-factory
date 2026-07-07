import { z } from 'zod';

/**
 * Estado de salud compartido: lo devuelve `GET /api/health` en web y lo valida
 * el worker al arrancar ("worker ready"). Es el primer contrato del monorepo y
 * el canario del import cruzado core→web/worker (T0.1): cambiarlo debe romper
 * la compilación de ambas apps.
 *
 * El campo `db` llega en T0.2 con el healthcheck real de Postgres — no se anticipa.
 */
export const HealthStatusSchema = z.object({
  ok: z.boolean(),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
