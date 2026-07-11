// La clave de cifrado at-rest (T0.14, §19.2) derivada del ENTORNO (`APP_MASTER_KEY`).
//
// UNA sola definición, compartida por los DOS composition roots: `apps/web` (session.ts, que
// la usa para el route de settings y el seeding) y `apps/worker` (boss.ts, que se la pasa a
// los executors reales para descifrar las API keys de Firecrawl/Anthropic). Antes cada uno
// tenía su propio clon —misma env, mismo fail-fast, mismo memoizado, mismo mensaje— y el
// comentario de uno decía literalmente "mismo criterio que web": la señal de que debía ser el
// mismo código.
//
// Leer `process.env` es CONFIG, no I/O de datos: no viola la frontera de core (nada de red ni
// de BD aquí; `deriveSecretsKey` es CPU pura).
import { deriveSecretsKey } from './crypto';

let cache: Buffer | undefined;

/**
 * Clave de cifrado de credenciales, derivada de `APP_MASTER_KEY` y MEMOIZADA (scrypt es caro
 * y el resultado es constante para una master key dada).
 *
 * PEREZOSA a propósito: lanza al USARSE, nunca al importar el módulo. Así un proceso que no
 * necesita descifrar nada (p. ej. un worker que solo corre DAGs de demo) arranca sin
 * `APP_MASTER_KEY`, y solo revienta —con mensaje explícito— quien de verdad la necesita.
 */
export function getSecretsKeyFromEnv(): Buffer {
  if (cache === undefined) {
    const masterKey = process.env.APP_MASTER_KEY ?? '';
    if (!masterKey) {
      throw new Error(
        'APP_MASTER_KEY no está definida: es la única credencial de cifrado (PRD §19.2)',
      );
    }
    cache = deriveSecretsKey(masterKey);
  }
  return cache;
}

/** Solo para tests: invalida la clave memoizada (p. ej. tras cambiar `APP_MASTER_KEY`). */
export function resetSecretsKeyCache(): void {
  cache = undefined;
}
