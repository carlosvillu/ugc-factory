// LOS DOS COMPORTAMIENTOS DE T3.9 SOBRE `seedPersonas`, CODIFICADOS COMO CONTROL PERMANENTE
// (regla de trabajo 8). Contra Postgres REAL (Testcontainers), con los `PERSONA_SEEDS` REALES:
//
//   1. FAIL-FAST vs NO-FATAL del paso de IMAGEN: `pnpm seed` (sin `onImageError`) REVIENTA si la
//      imagen falla — el guard ≥2K no puede tener puerta trasera. El ARRANQUE de web (con
//      `onImageError`) DEGRADA: la fila de persona existe, la imagen no, y NO se lanza → `/login`
//      se sigue sirviendo aunque sharp/el almacén estén rotos en una BD vacía (deploy nuevo/recovery).
//   2. INSERT-ONLY en el boot (`onConflict:'nothing'`): re-sembrar no toca la fila viva ni duplica.
//      (El control negativo del METADATO editado por el usuario vive en `persona.test.ts` — aquí se
//      fija la idempotencia de conteo del camino de arranque completo, `seedPersonas`.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_SEEDS } from '@ugc/core/persona/server';
import type { StorageAdapter } from '@ugc/core';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { seedPersonas } from '../../src/repos/persona-seed';
import { countPersonas } from '../../src/repos/persona.repo';

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'persona-seed' });
});

afterAll(async () => {
  await tdb.close();
});

/** Un StorageAdapter que SIEMPRE falla en `put`: fuerza de forma determinista el modo de fallo
 *  «el paso de imagen revienta en el arranque» (sharp roto, `/data/assets` no escribible, etc.). */
const failingStorage: StorageAdapter = {
  put: () => Promise.reject(new Error('storage put falló (sharp/FS roto en el arranque)')),
  get: () => Promise.reject(new Error('no usado')),
  stat: () => Promise.resolve(null),
  delete: () => Promise.resolve(),
};

/** Un StorageAdapter en memoria: `put` calcula bytes/checksum sin tocar el FS (el camino feliz no
 *  necesita disco). */
function makeMemoryStorage(): StorageAdapter {
  return {
    put: (_key, data) => {
      const bytes = data instanceof Uint8Array ? data.byteLength : 0;
      return Promise.resolve({ bytes, checksum: `sha256:${String(bytes)}` });
    },
    get: () => Promise.reject(new Error('no usado')),
    stat: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  };
}

describe('seedPersonas: el paso de imagen es FAIL-FAST por defecto, NO-FATAL en el arranque (T3.9)', () => {
  it('sin `onImageError` (pnpm seed): un fallo de imagen REVIENTA (el guard no tiene puerta trasera)', async () => {
    await expect(seedPersonas(tdb.db, failingStorage, PERSONA_SEEDS)).rejects.toThrow(
      /storage put falló/,
    );
  });

  it('con `onImageError` (arranque): DEGRADA — la fila de persona existe, la imagen no, y NO se lanza', async () => {
    // BD limpia para este test: quita cualquier persona que el test anterior dejara a medias.
    await tdb.pool.query('DELETE FROM persona');

    const errors: { personaName: string }[] = [];
    const result = await seedPersonas(tdb.db, failingStorage, PERSONA_SEEDS, {
      onConflict: 'nothing',
      onImageError: (_err, ctx) => errors.push({ personaName: ctx.personaName }),
    });

    // NO se lanzó: el arranque de web habría seguido y `/login` se serviría.
    // Las FILAS de persona SÍ se sembraron (N4 y el CRUD las necesitan); solo las IMÁGENES faltan.
    expect(result.personas).toBe(PERSONA_SEEDS.length);
    expect(result.imagesCreated).toBe(0);
    expect(result.imagesFailed).toBe(PERSONA_SEEDS.length); // cada persona degradó su bloque de imágenes
    expect(errors).toHaveLength(PERSONA_SEEDS.length); // el callback ruidoso se invocó por cada una

    // La persona vive en la BD aunque su imagen no exista.
    expect(await countPersonas(tdb.db)).toBe(PERSONA_SEEDS.length);
  });
});

describe('seedPersonas: idempotente e insert-only en el arranque (T3.9)', () => {
  it('`onConflict:"nothing"` corre dos veces sin duplicar personas', async () => {
    await tdb.pool.query('DELETE FROM persona');
    const storage = makeMemoryStorage();

    const first = await seedPersonas(tdb.db, storage, PERSONA_SEEDS, { onConflict: 'nothing' });
    expect(first.personas).toBe(PERSONA_SEEDS.length);
    expect(first.imagesFailed).toBe(0);
    // Cada seed real trae `referenceImageCount` imágenes; se generan solo en el primer boot.
    const expectedImages = PERSONA_SEEDS.reduce((n, s) => n + s.referenceImageCount, 0);
    expect(first.imagesCreated).toBe(expectedImages);

    // SEGUNDO boot: personas ya presentes → DO NOTHING → 0 imágenes nuevas, mismo total.
    const second = await seedPersonas(tdb.db, storage, PERSONA_SEEDS, { onConflict: 'nothing' });
    expect(second.personas).toBe(first.personas); // ni una fila más
    expect(second.imagesCreated).toBe(0); // no re-genera imágenes de personas ya sembradas
  });
});
