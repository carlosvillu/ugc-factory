import { z } from 'zod';

/**
 * Estado de salud compartido: lo devuelve `GET /api/health` en web y lo valida
 * el worker al arrancar ("worker ready"). Es el primer contrato del monorepo y
 * el canario del import cruzado core→web/worker (T0.1): cambiarlo debe romper
 * la compilación de ambas apps.
 *
 * `db` (T0.2): resultado del ping a Postgres (`pingDb` de @ugc/db). `ok` es la
 * disponibilidad del proceso; `db` es un sub-estado que puede degradar a `false`
 * sin tumbar la app — de ahí que sean dos campos y no uno. La app puede estar
 * `ok:true` con `db:false` cuando Postgres está caído (degradación observable).
 */
export const HealthStatusSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
