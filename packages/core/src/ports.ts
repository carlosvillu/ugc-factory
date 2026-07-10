// Puertos transversales de core (backend/references/architecture.md §2).
// Clock llega con su consumidor (T0.7a orquestador): no se anticipa.

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

/**
 * Almacenamiento de artefactos binarios del pipeline (PRD §19.2). La única
 * implementación hoy es filesystem local (`makeLocalStorageAdapter` en
 * `@ugc/db`, adapters/local-storage.ts); mañana s3 sin tocar a los consumidores.
 * `key` es el `storage_key` de la fila `asset`: SIEMPRE relativo a la raíz del
 * adaptador y de CONFIANZA (viene de la BD, nunca de input del cliente). El
 * adaptador aplica una barrera LÉXICA de contención (§19.2 "nunca ruta cruda"):
 * rechaza `..`, rutas absolutas y el propio root, pero no resuelve symlinks (fuera
 * de alcance por el supuesto de confianza de la key). `put` calcula bytes+checksum
 * (sha256) de forma canónica; los consumidores los persisten en `bytes`/`checksum`.
 */
export interface StorageAdapter {
  put(
    key: string,
    data: Uint8Array | ReadableStream<Uint8Array>,
    opts?: { mime?: string },
  ): Promise<{ bytes: number; checksum: string }>;
  /** Stream web (no Node): encaja directo en `new Response(body)` del endpoint de download. */
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  stat(key: string): Promise<{ bytes: number; checksum: string } | null>;
  delete(key: string): Promise<void>;
}
