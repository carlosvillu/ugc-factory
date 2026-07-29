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
import {
  PERSONA_SEEDS,
  referenceImageEntropy,
  REFERENCE_PHOTO_ENTROPY_FLOOR,
  REFERENCE_MAX_BYTES,
} from '@ugc/core/persona/server';
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

/** Un StorageAdapter en memoria que RETIENE los bytes por `storageKey` (`put` los guarda en un Map): el
 *  camino feliz no necesita disco, pero el gate de entropía de T5.19 sí necesita LEER los bytes que el seed
 *  materializó (no solo su tamaño) para medir que son fotos. `get` devuelve los bytes retenidos. */
function makeMemoryStorage(): StorageAdapter & {
  bytesFor: (key: string) => Uint8Array | undefined;
} {
  const store = new Map<string, Uint8Array>();
  return {
    put: (key, data) => {
      const copy = data instanceof Uint8Array ? data.slice() : new Uint8Array(0);
      store.set(key, copy);
      return Promise.resolve({
        bytes: copy.byteLength,
        checksum: `sha256:${String(copy.byteLength)}`,
      });
    },
    get: (key) => {
      const b = store.get(key);
      if (b === undefined) return Promise.reject(new Error(`no hay bytes para ${key}`));
      // `new Uint8Array(b)` normaliza `Uint8Array<ArrayBufferLike>` a un `BlobPart` aceptable
      // (los tipos DOM recientes rechazan el ArrayBufferLike genérico) y copia por seguridad.
      return Promise.resolve(new Blob([new Uint8Array(b)]).stream());
    },
    stat: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
    bytesFor: (key) => store.get(key),
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

// ── TEST B de T5.19 · EL SEED REAL MATERIALIZA FOTOS (NO PLACEHOLDERS ABSTRACTOS) PARA LA BATCH-CAPABLE ──
//
// EL BUG DE PRODUCCIÓN QUE CIERRA (destapado en el primer máster real, 2026-07-26): la persona batch-capable
// del seed (Maya) llega a N7c (avatar/OmniHuman), que ANIMA su reference_image. Cuando esa reference era el
// placeholder ABSTRACTO de sharp (rect+banda+circle), OmniHuman lo animó fielmente → sujeto alucinado. Este
// test es el gate permanente: sobre las FILAS REALES de BD que el seed sembró, exige que cada reference de
// una persona batch-capable (DERIVADA de su `voice_map`, no una allowlist) sea una FOTO — supere el floor de
// entropía que un placeholder abstracto de sharp NO supera.
//
// POR QUÉ MUERDE SOBRE BYTES DE BD Y NO SOBRE EL ARRAY DEL CÓDIGO: igual que el Test A de T5.15, el defecto
// no es del array `PERSONA_SEEDS` — es de lo que el SEED PATH REAL materializa. Un test unit que lea el
// fixture (`reference-fixtures.test.ts`) prueba que el fichero es una foto; ESTE prueba que el seed la
// ENTREGA como reference_image de la persona en la BD. Mide la entropía de los bytes que el storage retuvo.
//
// EL PREDICADO batch-capable ES DERIVADO (T5.19): «voz que fal acepta» (ningún `voiceId` placeholder). No es
// «todas las references del seed son fotos» — las 10 placeholder siguen con sharp abstracto (coherente con
// ser sustituibles) y quedarían FUERA del predicado. NUNCA `['Maya']` hardcodeado: cubre cualquier persona
// real que el usuario añada por CRUD.
describe('el seed REAL materializa FOTOS para la persona batch-capable (T5.19, Test B)', () => {
  /** ¿La fila de persona (jsonb opaco) es batch-capable? — tiene ≥1 voz que fal acepta (ningún
   *  `voiceId` `placeholder-*`). DERIVADO del `voice_map` de la BD, no de una allowlist. */
  function isBatchCapableRow(voiceMap: unknown): boolean {
    if (voiceMap === null || typeof voiceMap !== 'object') return false;
    const voices = Object.values(voiceMap as Record<string, unknown>).map((v) =>
      v !== null &&
      typeof v === 'object' &&
      typeof (v as { voiceId?: unknown }).voiceId === 'string'
        ? (v as { voiceId: string }).voiceId
        : '',
    );
    return (
      voices.length > 0 && voices.every((id) => id.length > 0 && !id.startsWith('placeholder'))
    );
  }

  it('cada reference_image de una persona batch-capable es una FOTO (supera el floor de entropía)', async () => {
    await tdb.pool.query('DELETE FROM persona');
    await tdb.pool.query(`DELETE FROM asset WHERE kind = 'reference_image'`);

    // EL SEED PATH REAL con un storage que RETIENE bytes (para poder medirlos).
    const storage = makeMemoryStorage();
    const result = await seedPersonas(tdb.db, storage, PERSONA_SEEDS);
    expect(result.personas).toBe(PERSONA_SEEDS.length);

    const rows = await listPersonas(tdb.db);
    const capableRows = rows.filter((p) => isBatchCapableRow(p.voiceMap));

    // El predicado selecciona ≥1 persona (hoy Maya): si el seed pierde su única batch-capable, el gate de
    // T5.15 ya lo caza; aquí basta con que exista para que el assert de foto no sea vacuo.
    expect(
      capableRows.length,
      'el seed no dejó NINGUNA persona batch-capable en BD (no hay a quién exigirle fotos)',
    ).toBeGreaterThan(0);

    for (const p of capableRows) {
      // Los storageKeys de sus reference_image (para leer los bytes que el seed materializó).
      const { rows: assetRows } = await tdb.pool.query<{ storage_key: string }>(
        `SELECT storage_key FROM asset WHERE id = ANY($1) AND kind = 'reference_image' ORDER BY id`,
        [p.referenceImageIds],
      );
      expect(
        assetRows.length,
        `«${p.name}» batch-capable sin reference_image materializada`,
      ).toBeGreaterThan(0);

      for (const { storage_key } of assetRows) {
        const bytes = storage.bytesFor(storage_key);
        expect(bytes, `bytes ausentes para ${storage_key}`).toBeDefined();
        if (bytes === undefined) continue;
        const entropy = await referenceImageEntropy(bytes);
        // ASSERT 1 (foto vs placeholder): la reference que N7c animará es una FOTO, no un placeholder abstracto
        // de sharp. Si esta persona sembrara sus references con sharp (bug), la entropía caería (~1.4) y rojo.
        expect(
          entropy,
          `«${p.name}» batch-capable pero su reference «${storage_key}» tiene entropía ${entropy.toFixed(3)} < floor ${String(REFERENCE_PHOTO_ENTROPY_FLOOR)}: es un placeholder abstracto, N7c la animaría como sujeto alucinado`,
        ).toBeGreaterThan(REFERENCE_PHOTO_ENTROPY_FLOOR);
        // ASSERT 2 (descargable por N7c, T5.19 fix del FAIL de VERIFY): la reference DEBE estar bajo el techo
        // de tamaño. La 1ª entrega materializó fixtures de 5,9 MB que fal no podía descargar (file_download_error).
        // El seed ahora normaliza a JPEG → cada reference queda muy por debajo; si se saltara esa normalización,
        // este assert se pondría rojo antes de que se gaste un solo céntimo en N7c.
        expect(
          bytes.byteLength,
          `«${p.name}» reference «${storage_key}» pesa ${(bytes.byteLength / 1e6).toFixed(2)} MB ≥ techo ${String(REFERENCE_MAX_BYTES)} B: N7c daría file_download_error`,
        ).toBeLessThan(REFERENCE_MAX_BYTES);
      }
    }
  });
});
