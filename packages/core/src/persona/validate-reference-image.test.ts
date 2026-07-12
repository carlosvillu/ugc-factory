// Unit del GUARD ≥2K (T2.0). Principio 9 de la skill testing, aplicado literalmente:
//
//   · NO se fabrica un objeto `{width: 2048}`. Se generan PNGs REALES con sharp y se pasan como
//     BYTES por la MISMA función que corre en el endpoint de upload — que lee las dimensiones
//     DEL FICHERO. Si el guard dejara de leerlas, este test se caería.
//   · Se asserta sobre lo que devuelve/lanza la función de PRODUCCIÓN, no sobre una
//     reimplementación de su regla en el test (la «cuarta forma»).
//   · Se prueba la FRONTERA exacta (2048 pasa, 2047 no): un umbral solo está probado si se
//     ejercita el píxel de antes y el de después.
import { describe, expect, it } from 'vitest';
// El generador de PNGs REALES vive en test-utils, no aquí: `image-fixtures.ts` lo dice literal
// («un solo generador, una sola verdad de qué es una imagen de 2048 px») y lo comparten los
// tests de esta suite, los handler-level de la API y el spec de Playwright.
import { makeTestPng as png } from '@ugc/test-utils';
import { AppError } from '../contracts/app-error';
import { MIN_REFERENCE_LONG_EDGE_PX } from './contracts';
import { makeSyntheticReferenceImage } from './reference-image';
import { validateReferenceImage } from './validate-reference-image';

describe('validateReferenceImage (≥2K, §11 identity lock)', () => {
  it('acepta una imagen cuyo lado largo alcanza el umbral EXACTO y devuelve sus dimensiones REALES', async () => {
    // 1638×2048: vertical, lado largo justo en el umbral. Es el caso frontera por arriba.
    const dims = await validateReferenceImage(await png(1638, MIN_REFERENCE_LONG_EDGE_PX));
    expect(dims).toEqual({ width: 1638, height: MIN_REFERENCE_LONG_EDGE_PX });
  });

  it('acepta una imagen apaisada si es el ANCHO el que llega al umbral (el guard mira el lado largo)', async () => {
    const dims = await validateReferenceImage(await png(MIN_REFERENCE_LONG_EDGE_PX, 1200));
    expect(dims.width).toBe(MIN_REFERENCE_LONG_EDGE_PX);
  });

  it('RECHAZA una imagen un solo píxel por debajo del umbral, con mensaje accionable', async () => {
    // 1637×2047: falla por 1 px. La frontera por abajo.
    const err = await validateReferenceImage(await png(1637, MIN_REFERENCE_LONG_EDGE_PX - 1)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    const appError = err as AppError;
    expect(appError.code).toBe('validation_error');
    expect(appError.status).toBe(400);
    // El mensaje dice CUÁNTO mide y CUÁNTO hace falta (Verificación: «mensaje claro»).
    expect(appError.message).toContain('1637');
    expect(appError.message).toContain(String(MIN_REFERENCE_LONG_EDGE_PX));
  });

  it('RECHAZA una imagen claramente pequeña (el caso del usuario: sube una miniatura)', async () => {
    await expect(validateReferenceImage(await png(512, 640))).rejects.toThrow(AppError);
  });

  it('RECHAZA bytes que no son una imagen (no revienta con un 500)', async () => {
    const err = await validateReferenceImage(new TextEncoder().encode('esto no es un png')).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('validation_error');
  });

  it('las imágenes SINTÉTICAS del seed pasan el guard DE VERDAD (no se lo saltan)', async () => {
    // Este es el assert que amarra la decisión de alcance del usuario: el seed usa el mismo
    // camino que un upload real. Si `makeSyntheticReferenceImage` generase un PNG de 512 px,
    // este test —y con él el gate— se pondría rojo.
    const dims = await validateReferenceImage(await makeSyntheticReferenceImage(1));
    expect(Math.max(dims.width, dims.height)).toBeGreaterThanOrEqual(MIN_REFERENCE_LONG_EDGE_PX);
  });
});
