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
import { addReferenceImage, countPersonas, upsertPersonaByName } from './persona.repo';

export interface SeedPersonasResult {
  /** Total de personas en la tabla tras sembrar (no las insertadas: en la segunda corrida se
   *  insertan 0 y el total no cambia — que es lo que prueba la idempotencia). */
  personas: number;
  /** Imágenes de referencia sintéticas generadas EN ESTA corrida (0 en la segunda). */
  imagesCreated: number;
}

/**
 * Siembra las personas placeholder y —solo para las que nacen ahora— sus imágenes de
 * referencia sintéticas. Devuelve los totales que `pnpm seed` imprime.
 */
export async function seedPersonas(
  db: DbClient,
  storage: StorageAdapter,
  seeds: readonly PersonaSeed[],
): Promise<SeedPersonasResult> {
  let imagesCreated = 0;

  for (const seed of seeds) {
    const { referenceImageCount, ...body } = seed;
    const { persona: row, created } = await upsertPersonaByName(db, body);

    // Solo la persona RECIÉN CREADA recibe imágenes. Si ya existía, sus imágenes son suyas
    // (puede que el usuario ya haya subido las reales): re-sembrar no las toca.
    if (!created) continue;

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
  }

  return { personas: await countPersonas(db), imagesCreated };
}
