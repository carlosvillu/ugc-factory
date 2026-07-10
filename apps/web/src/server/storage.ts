// Accessor lazy del StorageAdapter para los route handlers (mismo contrato que
// getDb/getBoss, testing/api.md §2.1): NUNCA se lee env ni se construye el
// adaptador en module scope — importar `route.ts` no debe tocar el filesystem ni
// exigir ASSETS_DIR presente. El primer `getStorage()` en producción lo construye
// desde `ASSETS_DIR` (default `/data/assets`); los tests lo sustituyen con
// `setStorageForTests(...)` apuntando a un tmpdir.
import { makeLocalStorageAdapter } from '@ugc/db';
import type { StorageAdapter } from '@ugc/core';

// Default de producción (PRD §19.2 / architecture §6). En dev/E2E se pasa un path
// escribible del host vía ASSETS_DIR (el stack E2E usa un tmpdir).
const DEFAULT_ASSETS_DIR = '/data/assets';

let override: StorageAdapter | undefined;
let fromEnv: StorageAdapter | undefined;

/** Solo para tests: inyecta (o limpia con `undefined`) un adaptador sobre tmpdir. */
export function setStorageForTests(storage: StorageAdapter | undefined): void {
  override = storage;
}

export function getStorage(): StorageAdapter {
  if (override) return override;
  fromEnv ??= makeLocalStorageAdapter({ root: process.env.ASSETS_DIR ?? DEFAULT_ASSETS_DIR });
  return fromEnv;
}
