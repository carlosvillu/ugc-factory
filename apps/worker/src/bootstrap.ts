import type { Logger } from '@ugc/core';
import type { HealthStatus } from '@ugc/core/contracts';

export interface BootstrapDeps {
  logger: Logger;
}

/**
 * Arranque del worker (architecture.md §6): cablea EAGER — fallar en el boot es
 * una feature de un daemon, no un bug. Hoy anuncia disponibilidad; pool,
 * pg-boss, storage y consumers llegan en T0.3/T0.5/T0.6.
 */
export function bootstrap({ logger }: BootstrapDeps): HealthStatus {
  // Import cruzado del contrato de core (T0.1): el `satisfies` es el canario de
  // compilación — un cambio de tipo en core rompe el worker (la señal que la
  // Verificación comprueba a propósito). Sin parse runtime de un literal propio:
  // el safeParse pertenece a las fronteras de ENTRADA (jobs, webhooks).
  const health = { ok: true } satisfies HealthStatus;
  logger.info({ health }, 'worker ready');
  return health;
}
