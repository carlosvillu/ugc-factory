// Identidad de las filas del pipeline: ULIDs, no UUIDs (db.md §1). Un ULID es
// ordenable por tiempo y se genera en la app ANTES del INSERT — logs,
// `singletonKey` de pg-boss y payloads de NOTIFY pueden referenciar una fila que
// aún no existe. Los PKs de TODAS las tablas de §12 son ULIDs; el schema Drizzle
// los rellena con `newUlid()` (columns.helpers.ts) y los contratos Zod que viajan
// por la API/SSE validan con `UlidSchema`, jamás `z.uuid()`.
import { ulid } from 'ulid';
import { z } from 'zod';

/**
 * Genera un ULID nuevo. Único punto del monorepo que llama a la librería `ulid`:
 * el schema de db lo usa como `$defaultFn` de cada PK, y quien necesite el id
 * antes del INSERT lo pide aquí (no re-importa la librería).
 */
export function newUlid(): string {
  return ulid();
}

/**
 * Valida un ULID canónico: 26 caracteres del alfabeto Crockford base32
 * (excluye I, L, O, U). Es la forma pública de un id de fila en los contratos
 * (params de ruta, payloads de jobs, eventos SSE) — la frontera de ENTRADA lo
 * parsea con `safeParse`, no se confía en el string crudo.
 */
export const UlidSchema = z
  .string()
  .length(26)
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID inválido');
