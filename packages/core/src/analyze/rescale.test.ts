// Unit del reescalado ≤1080p (T1.7, Verificación #6). Genera imágenes REALES con sharp
// (no fixtures estáticos: necesitamos bytes decodificables) y asserta que el lado largo
// queda ≤1080 sin llamar a Anthropic. Es la protección de regresión del invariante
// COST-CRITICAL: mandar el screenshot RAW factura la imagen completa.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { imageDimensions, MAX_LONG_EDGE_PX, rescaleImage } from './rescale';

/** Genera un PNG sólido de `w`×`h` px (bytes decodificables por sharp). */
async function makePng(w: number, h: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 10, g: 165, b: 164 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe('rescaleImage — ≤1080p (Verificación #6)', () => {
  it('reduce el lado largo de un screenshot enorme (1920×4453, escala oatly) a ≤1080', async () => {
    // La escala REAL del screenshot de oatly citada en el brief: alto >> ancho.
    const huge = await makePng(1920, 4453);
    const before = await imageDimensions(huge);
    expect(Math.max(before.width, before.height)).toBe(4453);

    const rescaled = await rescaleImage(huge);
    const after = await imageDimensions(rescaled.data);

    // El lado largo cae al cap; el ratio se preserva (alto era el lado largo).
    expect(Math.max(after.width, after.height)).toBeLessThanOrEqual(MAX_LONG_EDGE_PX);
    expect(after.height).toBe(MAX_LONG_EDGE_PX);
    // El ancho se escala proporcionalmente (1920 * 1080/4453 ≈ 466).
    expect(after.width).toBeLessThan(before.width);
    // Sale PNG (mime estable para el bloque de visión).
    expect(rescaled.mime).toBe('image/png');
  });

  it('reduce un screenshot ancho (3000×1500) por el lado largo (ancho)', async () => {
    const wide = await makePng(3000, 1500);
    const rescaled = await rescaleImage(wide);
    const after = await imageDimensions(rescaled.data);
    expect(Math.max(after.width, after.height)).toBeLessThanOrEqual(MAX_LONG_EDGE_PX);
    expect(after.width).toBe(MAX_LONG_EDGE_PX);
  });

  it('NO amplía una imagen ya pequeña (800×600 se queda igual)', async () => {
    const small = await makePng(800, 600);
    const rescaled = await rescaleImage(small);
    const after = await imageDimensions(rescaled.data);
    // withoutEnlargement: no upscaling — sigue 800×600.
    expect(after.width).toBe(800);
    expect(after.height).toBe(600);
  });

  it('respeta un cap custom', async () => {
    const img = await makePng(2000, 1000);
    const rescaled = await rescaleImage(img, 512);
    const after = await imageDimensions(rescaled.data);
    expect(Math.max(after.width, after.height)).toBeLessThanOrEqual(512);
    expect(after.width).toBe(512);
  });

  it('LANZA ante bytes que no son una imagen (el caller lo trata como imagen no usable)', async () => {
    const notAnImage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(rescaleImage(notAnImage)).rejects.toThrow();
  });
});
