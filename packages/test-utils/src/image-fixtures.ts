// FIXTURES DE IMAGEN REALES para las suites que prueban validaciones de imagen (T2.0).
//
// POR QUÉ EXISTE — es principio 9 de la skill testing en su forma más directa. La validación
// «≥2K» de las imágenes de referencia (§11 identity lock) LEE LAS DIMENSIONES DEL FICHERO con
// sharp. Un test que le pasara un objeto `{width: 2048}` fabricado a mano no probaría NADA: el
// código de producción nunca ve ese objeto, ve BYTES. Así que los tests generan PNGs de VERDAD
// —con la resolución que dicen tener— y los mandan por el mismo camino que el navegador.
//
// Vive en test-utils (y no duplicado en cada suite) porque lo consumen DOS paquetes: los tests
// handler-level de `apps/web` (el endpoint de upload) y el spec de Playwright (que necesita el
// fichero en disco para el `setInputFiles`). Un solo generador, una sola verdad de qué es «una
// imagen de 2048 px».
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

/** Un PNG REAL de `width`×`height` px, en memoria. Decodificable: sharp (y cualquier otro
 *  lector) leerá EXACTAMENTE esas dimensiones del fichero. */
export async function makeTestPng(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      // Color estable: los bytes (y por tanto el checksum) son deterministas para unas
      // dimensiones dadas — un test puede afirmar sobre el checksum sin flakiness.
      background: { r: 200, g: 120, b: 90 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

/** Escribe un PNG real de `width`×`height` en `filePath` y devuelve la ruta. Lo usa el spec de
 *  Playwright, que necesita un FICHERO en disco para `setInputFiles` (no puede subir bytes). */
export async function writeTestPng(
  filePath: string,
  width: number,
  height: number,
): Promise<string> {
  await writeFile(filePath, await makeTestPng(width, height));
  return filePath;
}
