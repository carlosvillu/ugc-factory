// Accessor lazy del StorageAdapter para los route handlers (mismo contrato que
// getDb/getBoss, testing/api.md §2.1): NUNCA se lee env ni se construye el
// adaptador en module scope — importar `route.ts` no debe tocar el filesystem ni
// exigir ASSETS_DIR presente. El primer `getStorage()` en producción lo construye
// desde `ASSETS_DIR` (default `/data/assets`); los tests lo sustituyen con
// `setStorageForTests(...)` apuntando a un tmpdir.
import { makeLocalStorageAdapterFromEnv } from '@ugc/db';
import type { StorageAdapter } from '@ugc/core';

// El default de producción (`/data/assets`) y la lectura de `ASSETS_DIR` viven en
// `makeLocalStorageAdapterFromEnv` (@ugc/db), COMPARTIDO con el worker: si cada composition
// root tuviera su copia, un cambio de directorio en el deploy podría hacer que el worker
// escriba los assets donde web no los lee.

let override: StorageAdapter | undefined;
let fromEnv: StorageAdapter | undefined;

/** Solo para tests: inyecta (o limpia con `undefined`) un adaptador sobre tmpdir. */
export function setStorageForTests(storage: StorageAdapter | undefined): void {
  override = storage;
}

export function getStorage(): StorageAdapter {
  if (override) return override;
  fromEnv ??= makeLocalStorageAdapterFromEnv();
  return fromEnv;
}
