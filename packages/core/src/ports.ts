// Puertos transversales de core (backend/references/architecture.md §2).
// Clock y StorageAdapter llegan con sus consumidores (T0.7a orquestador,
// T0.5 storage): no se anticipan.

/**
 * Puerto de logging que consume TODO el código del monorepo. La única
 * implementación es `makeLogger` (pino) en `observability/` — ningún otro
 * módulo importa pino directamente (observability.md §2).
 */
export interface Logger {
  trace(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  /** Correlación run_id/step_id/request_id/job_id vía bindings (observability.md §3). */
  child(bindings: Record<string, unknown>): Logger;
}
