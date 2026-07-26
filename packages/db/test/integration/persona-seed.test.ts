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
import { countPersonas, listPersonas } from '../../src/repos/persona.repo';

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

// ── TEST A de T5.15 · EL SEED REAL MATERIALIZA UNA PERSONA BATCH-READY CON IMÁGENES EN BD ────────────
//
// El control permanente a NIVEL DE DATOS (`seed-data.test.ts` / `isBatchReady` sobre `PERSONA_SEEDS`)
// prueba que el ARRAY del código trae ≥1 persona completa; pero el bug de producción de T5.15 no era del
// array — era de la BD SEMBRADA: la persona con voz real (`Vera Verify`) tenía 0 filas de imagen de
// referencia ⇒ N7c reventaba en CP3. Este test cierra ese hueco: corre el SEED PATH REAL (`seedPersonas`,
// el mismo que `pnpm seed` invoca) y afirma sobre las FILAS REALES de BD que la persona batch-ready acaba
// con imágenes de referencia MATERIALIZADAS (filas `asset kind='reference_image'` que resuelven), no solo
// con un `referenceImageCount` en el código.
//
// POR QUÉ EL ASSERT MUERDE SOBRE LAS FILAS Y NO SOBRE `referenceImageCount`: el seed es INSERT-ONLY
// (`upsertPersonaByName` + «solo la persona recién creada recibe imágenes»). En un contenedor limpio la
// persona nace y sus imágenes se materializan; pero si la fila YA existiera (BD no virgen) sin imágenes,
// Maya quedaría con `referenceImageIds` vacío y CP3 lanzaría el mismísimo `PersonaWithoutReferenceImageError`
// que T5.15 añade. El proxy `referenceImageCount > 0` (que es del código, no de la BD) NO detectaría eso.
// Contando las filas REALES, este test vale en ambos escenarios: exige que la persona batch-ready del seed
// tenga imágenes de verdad en la tabla, que es lo que N7c consume.
//
// CONTROL NEGATIVO (verificado por el implementer, no vive en el árbol): quitar MAYA de `PERSONA_SEEDS`
// deja el seed sin NINGUNA persona batch-ready (anti-correlación de vuelta) → el `expect(readyRows.length)`
// se pone ROJO — que es exactamente el bug de producción de T5.15 reapareciendo.
describe('el seed REAL materializa una persona batch-ready con imágenes en BD (T5.15, Test A)', () => {
  /** Los `voiceId` de un `voice_map` jsonb OPACO (fila de BD), leídos defensivamente su forma
   *  `{locale:{voiceId}}` (los valores del record se tipan `unknown` a propósito: no se asume que cada
   *  locale sea un objeto). */
  function personaVoiceIds(voiceMap: unknown): string[] {
    if (voiceMap === null || typeof voiceMap !== 'object') return [];
    return Object.values(voiceMap as Record<string, unknown>)
      .map((v) =>
        v !== null &&
        typeof v === 'object' &&
        typeof (v as { voiceId?: unknown }).voiceId === 'string'
          ? (v as { voiceId: string }).voiceId
          : '',
      )
      .filter((id) => id.length > 0);
  }

  /** ¿La fila de persona (tal cual sale de la BD) es batch-ready? — tiene ≥1 imagen de referencia
   *  materializada (N7c/avatar) Y ninguna voz `placeholder-*` en su `voice_map` (N7b: fal las rechaza con
   *  422). Es la MISMA definición de `isBatchReady` (seed-data.test.ts) pero DERIVADA de la BD sembrada, no
   *  del array del código: sobre `reference_image_ids` REALES, no sobre `referenceImageCount`. */
  function isBatchReadyRow(p: { referenceImageIds: string[]; voiceMap: unknown }): boolean {
    const voiceIds = personaVoiceIds(p.voiceMap);
    return (
      p.referenceImageIds.length > 0 &&
      voiceIds.length > 0 &&
      voiceIds.every((id) => !id.startsWith('placeholder'))
    );
  }

  it('tras `seedPersonas` (el camino real) existe ≥1 persona con imágenes REALES en BD y voz que fal acepta', async () => {
    // BD virgen para este test: quita cualquier persona/imagen que un test anterior dejara (MAYA es la
    // PRIMERA del array, y el test de fail-fast la inserta SIN imágenes antes de reventar — sin este clean,
    // el seed la vería `created:false` y no le materializaría imágenes: falso rojo).
    await tdb.pool.query('DELETE FROM persona');
    await tdb.pool.query(`DELETE FROM asset WHERE kind = 'reference_image'`);

    // EL SEED PATH REAL (el mismo `seedPersonas` que `pnpm seed` invoca), sobre los `PERSONA_SEEDS` reales.
    const result = await seedPersonas(tdb.db, makeMemoryStorage(), PERSONA_SEEDS);
    expect(result.personas).toBe(PERSONA_SEEDS.length);

    // Las filas de persona TAL CUAL quedan en la BD (con sus `referenceImageIds` materializados).
    const rows = await listPersonas(tdb.db);

    // Las filas batch-ready DERIVADAS de la BD: ≥1 imagen de referencia REAL + ninguna voz placeholder.
    const readyRows = rows.filter(isBatchReadyRow);

    // EL ASSERT DE T5.15 EN TÉRMINOS DE BD: el seed real deja ≥1 persona con la que un lote arranca. Si el
    // seed pierde la persona completa (quitar MAYA), esto se pone ROJO — el bug de producción de vuelta.
    expect(
      readyRows.length,
      'el seed REAL no dejó NINGUNA persona batch-ready en BD: un usuario recién instalado no puede completar un lote generativo',
    ).toBeGreaterThan(0);

    // Y para CADA persona batch-ready, las imágenes que su `reference_image_ids` referencia EXISTEN de
    // verdad en la tabla `asset` con `kind='reference_image'` (no ids colgando): es lo que N7c consume.
    for (const p of readyRows) {
      const { rows: assetRows } = await tdb.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM asset WHERE id = ANY($1) AND kind = 'reference_image'`,
        [p.referenceImageIds],
      );
      const materialized = Number(assetRows[0]!.n);
      expect(
        materialized,
        `«${p.name}» es batch-ready pero sus ${String(p.referenceImageIds.length)} reference_image_ids no resuelven a filas asset`,
      ).toBe(p.referenceImageIds.length);
    }
  });
});
