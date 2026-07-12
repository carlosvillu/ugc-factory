// EL GUARD ≥2K DE LAS IMÁGENES DE REFERENCIA (§11 «referenceImages[] ≥2K (identity lock)»).
//
// UNA sola definición del guard, consumida por los DOS caminos que suben una imagen de
// referencia: el endpoint `POST /api/personas/:id/reference-images` (lo que hace el navegador)
// y el seed (`pnpm seed`, que genera PNGs sintéticos). Que los dos pasen por aquí es lo que
// hace que el seed no pueda "colarse" con una imagen que la UI rechazaría.
//
// PRINCIPIO 9 DE LA SKILL testing («el arnés nunca puede ser más cómodo que la realidad»): esta
// función NO acepta unas dimensiones ya calculadas — recibe los BYTES y las LEE del fichero con
// `sharp` (`imageDimensions`, T1.7). Un caller no puede mentirle diciendo «mide 2048»: si el
// PNG mide 512, sharp dice 512. Por eso el test puede generar PNGs de verdad y hacerlos pasar
// por el mismo camino que un upload real.
import { AppError } from '../contracts/app-error';
import { imageDimensions } from '../analyze/rescale';
import { MIN_REFERENCE_LONG_EDGE_PX } from './contracts';

/** Las dimensiones REALES de la imagen aceptada (leídas del fichero). El caller las persiste
 *  o las devuelve; nunca las inventa. */
export interface ReferenceImageInfo {
  width: number;
  height: number;
}

/**
 * Valida que `bytes` es una imagen decodificable cuyo lado LARGO alcanza el umbral de §11
 * (`MIN_REFERENCE_LONG_EDGE_PX`). Devuelve sus dimensiones reales.
 *
 * Lanza `AppError('validation_error')` con un mensaje que el usuario pueda ACTUAR —la
 * Verificación de T2.0 exige «una imagen <2K es rechazada con mensaje claro»—: dice cuánto
 * mide la imagen que subió y cuánto hace falta.
 */
export async function validateReferenceImage(bytes: Uint8Array): Promise<ReferenceImageInfo> {
  let dims: ReferenceImageInfo;
  try {
    // Lee las dimensiones DEL FICHERO. Un fichero que no es una imagen decodificable hace
    // que sharp lance — y eso es un 400, no un 500: el usuario subió algo que no es una imagen.
    dims = await imageDimensions(bytes);
  } catch {
    throw new AppError('validation_error', 'el fichero no es una imagen que se pueda leer', {
      formErrors: ['El fichero no es una imagen válida (o está corrupto)'],
      fieldErrors: {},
    });
  }

  const longEdge = Math.max(dims.width, dims.height);
  if (longEdge < MIN_REFERENCE_LONG_EDGE_PX) {
    throw new AppError(
      'validation_error',
      `la imagen de referencia mide ${String(dims.width)}×${String(dims.height)} px y el lado largo debe ser ≥${String(MIN_REFERENCE_LONG_EDGE_PX)} px`,
      {
        formErrors: [
          `Imagen demasiado pequeña: ${String(dims.width)}×${String(dims.height)} px. El identity lock exige al menos ${String(MIN_REFERENCE_LONG_EDGE_PX)} px en el lado largo (2K).`,
        ],
        fieldErrors: {},
      },
    );
  }

  return dims;
}
