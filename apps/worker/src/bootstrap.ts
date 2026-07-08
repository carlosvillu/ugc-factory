import type { Logger } from '@ugc/core';
import type { HealthStatus } from '@ugc/core/contracts';
import { pingDb } from '@ugc/db';

export interface BootstrapDeps {
  logger: Logger;
}

/**
 * Arranque del worker (architecture.md §6): cablea EAGER — fallar en el boot es
 * una feature de un daemon, no un bug. En T0.2 hace el ping de conexión a
 * Postgres al arrancar ("Web y worker se conectan al arrancar", Entrega T0.2) y
 * anuncia disponibilidad con el estado `db`. El pool propio, pg-boss, storage y
 * consumers llegan en T0.3/T0.5/T0.6.
 *
 * El ping NO tumba el worker si Postgres está caído: degrada a `db:false` (mismo
 * contrato que web). Un daemon que muere en cada reinicio de la BD es peor que
 * uno que anuncia el estado y espera a que vuelva (T0.6 traerá los reintentos).
 */
export async function bootstrap({ logger }: BootstrapDeps): Promise<HealthStatus> {
  // Ping compartido con web vía @ugc/db (timeouts cortos, cualquier error →
  // false, nunca lanza).
  const db = await pingDb({ connectionString: process.env.DATABASE_URL });

  // Import cruzado del contrato de core (T0.1): el `satisfies` es el canario de
  // compilación — un cambio de tipo en core rompe el worker (la señal que la
  // Verificación comprueba a propósito). Sin parse runtime de un literal propio:
  // el safeParse pertenece a las fronteras de ENTRADA (jobs, webhooks).
  const health = { ok: true, db } satisfies HealthStatus;
  logger.info({ health }, 'worker ready');
  return health;
}
