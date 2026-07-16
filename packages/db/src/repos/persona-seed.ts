// SIEMBRA DE PERSONAS con sus imágenes de referencia (T2.0).
//
// Vive aparte de `persona.repo.ts` porque necesita algo que un repo NO puede tener: el
// `StorageAdapter` (los ficheros). Es un caso de uso compuesto —persona + assets + ficheros—,
// y el sitio natural es aquí (db es quien ya cablea el StorageAdapter local, adapters/).
//
// LA DECISIÓN DE ALCANCE DEL USUARIO (2026-07-12) EN UNA FRASE: las 2 personas del seed son
// PLACEHOLDERS con imágenes SINTÉTICAS ≥2K; el usuario subirá sus caras reales por el propio
// CRUD de `/personas`, sin tocar código. Consecuencias que este fichero implementa:
//
//   · las imágenes se generan con `makeSyntheticReferenceImage` (sharp, PNG real de 2048 px de
//     lado largo) y pasan por `validateReferenceImage` — el MISMO guard que el endpoint de
//     upload. El seed NO tiene una puerta trasera: si el umbral ≥2K subiera, el seed fallaría.
//     (Principio 9 de la skill testing: el arnés no puede ser más cómodo que la realidad.)
//   · IDEMPOTENTE de verdad: la persona se upsertea por su clave natural (el nombre) y sus
//     imágenes SOLO se generan si la persona es NUEVA. Re-sembrar no duplica assets ni pisa las
//     imágenes reales que el usuario haya subido — que es justo lo que el usuario va a hacer.
//   · $0: cero llamadas a fal/Anthropic. La generación IA de referencias es F4.
import {
  makeSyntheticReferenceImage,
  validateReferenceImage,
  type PersonaSeed,
} from '@ugc/core/persona/server';
import type { StorageAdapter } from '@ugc/core';
import { newUlid } from '@ugc/core/contracts';
import type { DbClient } from '../client';
import { createAsset } from './asset.repo';
import type { SeedConflictPolicy } from './library.repo';
import { addReferenceImage, countPersonas, upsertPersonaByName } from './persona.repo';

export interface SeedPersonasResult {
  /** Total de personas en la tabla tras sembrar (no las insertadas: en la segunda corrida se
   *  insertan 0 y el total no cambia — que es lo que prueba la idempotencia). */
  personas: number;
  /** Imágenes de referencia sintéticas generadas EN ESTA corrida (0 en la segunda). */
  imagesCreated: number;
  /** Personas cuyas imágenes NO se pudieron generar y se DEGRADARON (solo con `onImageError`).
   *  0 en el camino fail-fast (`pnpm seed`): allí un fallo de imagen lanza y no se cuenta. */
  imagesFailed: number;
}

export interface SeedPersonasOptions {
  /** Política ante colisión de la persona por su clave natural (T3.9). Ver `upsertPersonaByName`.
   *  `'update'` (default, `pnpm seed`) reescribe metadatos; `'nothing'` (boot) no toca la fila viva
   *  → la edición del usuario en `/personas` sobrevive al redeploy. */
  onConflict?: SeedConflictPolicy;
  /**
   * Qué hacer si la generación/validación/persistencia de UNA imagen de referencia falla.
   *   - Ausente (default, `pnpm seed`): FAIL-FAST — el error se propaga. El guard ≥2K no puede
   *     tener puerta trasera (principio 9 de testing: el arnés no es más cómodo que la realidad).
   *   - Presente (el ARRANQUE de web, T3.9): NO-FATAL — se invoca el callback (log ruidoso a nivel
   *     error) y se sigue. Una imagen placeholder que no se genera NO debe impedir servir `/login`;
   *     N4 no necesita esas imágenes, solo las FILAS de persona (que ya están sembradas antes). El
   *     modo de fallo «sharp roto en BD vacía» degrada a «sin imagen placeholder», no a «web no
   *     arranca». Los datos de BD (librería/recetas/galería) siguen fail-fast: esos sí los pide N4.
   */
  onImageError?: (err: unknown, ctx: { personaName: string; personaId: string }) => void;
}

/**
 * Siembra las personas placeholder y —solo para las que nacen ahora— sus imágenes de
 * referencia sintéticas. Devuelve los totales que `pnpm seed` imprime.
 */
export async function seedPersonas(
  db: DbClient,
  storage: StorageAdapter,
  seeds: readonly PersonaSeed[],
  opts: SeedPersonasOptions = {},
): Promise<SeedPersonasResult> {
  let imagesCreated = 0;
  let imagesFailed = 0;

  for (const seed of seeds) {
    const { referenceImageCount, ...body } = seed;
    const { persona: row, created } = await upsertPersonaByName(db, body, {
      onConflict: opts.onConflict,
    });

    // Solo la persona RECIÉN CREADA recibe imágenes. Si ya existía, sus imágenes son suyas
    // (puede que el usuario ya haya subido las reales): re-sembrar no las toca.
    if (!created) continue;

    // Las imágenes de UNA persona se generan en bloque, PERO el bloque NO está en transacción: cada
    // `createAsset`/`addReferenceImage` ya está committeado cuando pasa a la siguiente. Si falla a
    // media persona (p. ej. entre `createAsset` y `addReferenceImage`, o en la 2ª de 2 imágenes) y
    // hay `onImageError`, se DEGRADA no-fatal: la persona puede quedar con imágenes/assets PARCIALES
    // (incluido algún asset huérfano sin referencia), se loggea ruidoso y se sigue con la siguiente.
    // No hay atomicidad que prometer aquí; lo que importa es que el arranque no se tumba. Sin
    // `onImageError` el error se propaga (fail-fast de `pnpm seed`).
    try {
      for (let i = 0; i < referenceImageCount; i++) {
        // 1) El fichero: un PNG sintético de verdad, de 2048 px de lado largo.
        const bytes = await makeSyntheticReferenceImage(row.name.length + i);

        // 2) EL MISMO GUARD QUE EL NAVEGADOR: lee las dimensiones DEL FICHERO y exige ≥2K. El
        //    seed no se lo salta — si el PNG generado fuese pequeño, `pnpm seed` reventaría aquí.
        const dims = await validateReferenceImage(bytes);

        // 3) Al almacén + a la tabla `asset`, exactamente como hace el endpoint de upload.
        const assetId = newUlid();
        const storageKey = `personas/${row.id}/${assetId}.png`;
        const put = await storage.put(storageKey, bytes, { mime: 'image/png' });
        await createAsset(db, {
          id: assetId,
          kind: 'reference_image',
          storageKey,
          mime: 'image/png',
          bytes: put.bytes,
          checksum: put.checksum,
        });
        await addReferenceImage(db, row.id, assetId);
        imagesCreated += 1;

        // Traza mínima: el usuario ve en el log que las imágenes son de verdad ≥2K.
        console.log(
          `seed: persona «${row.name}» ← imagen sintética ${String(dims.width)}×${String(dims.height)} px (${storageKey})`,
        );
      }
    } catch (err) {
      // Sin manejador: fail-fast (re-lanza con la causa tipada como Error). NO un `catch {}` que
      // se trague el error — hay que ver la causa (anti-patrón T1.8).
      if (!opts.onImageError) throw err;
      // Con manejador (boot): no-fatal. El callee loggea a nivel error; la persona queda sin
      // imagen placeholder pero la FILA existe y `/login` sigue sirviéndose.
      opts.onImageError(err, { personaName: row.name, personaId: row.id });
      imagesFailed += 1;
    }
  }

  return { personas: await countPersonas(db), imagesCreated, imagesFailed };
}
