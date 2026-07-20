// StorageAdapter para las suites `worker:media`: el adaptador LOCAL de producción (`@ugc/db`), no un
// fake — así los tests de media ejercen el mismo `put`/`get`/`stat` que corre en el VPS. Cada llamada
// crea una raíz nueva (sufijo ULID) bajo `rootDir` para que dos storages del mismo test no colisionen en
// keys. Lo comparten las suites de normalización (T5.2) y composición (T5.3).
import { makeLocalStorageAdapter } from '@ugc/db';
import type { StorageAdapter } from '@ugc/core';
import { newUlid } from '@ugc/core/contracts';
import { join } from 'node:path';

/** Un `StorageAdapter` local con raíz aislada (sufijo ULID) bajo `rootDir` — el adaptador real de
 *  producción, no un doble. */
export function makeMediaTestStorage(rootDir: string): StorageAdapter {
  return makeLocalStorageAdapter({ root: join(rootDir, `storage-${newUlid()}`) });
}
