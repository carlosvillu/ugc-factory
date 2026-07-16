import { describe, expect, it } from 'vitest';
import { extractImageOutput } from './fal-image-output';

describe('extractImageOutput (contrato del output de imagen de fal)', () => {
  it('extrae images[] con url y dimensiones del output de FLUX.2', () => {
    const out = extractImageOutput({
      images: [
        { url: 'https://fal.media/x.png', width: 1024, height: 1024, content_type: 'image/png' },
      ],
      seed: 42,
      timings: { inference: 1.2 },
    });
    expect(out).not.toBeNull();
    expect(out?.images[0]).toMatchObject({
      url: 'https://fal.media/x.png',
      width: 1024,
      height: 1024,
    });
  });

  it('un output SIN images es null (→ FalResponseError en el servicio, no crash)', () => {
    expect(extractImageOutput({ seed: 42 })).toBeNull();
    expect(extractImageOutput({ images: [] })).toBeNull();
    expect(extractImageOutput(null)).toBeNull();
  });

  it('una imagen sin url es rechazada (url es lo que se descarga)', () => {
    expect(extractImageOutput({ images: [{ width: 1024, height: 1024 }] })).toBeNull();
  });
});
