import { describe, expect, it } from 'vitest';
import { extractImageOutput, extractImageUrlOutput } from './fal-image-output';

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

  it('el parser ESTRICTO rechaza dimensiones null (por eso existe la variante tolerante)', () => {
    // NB2/edit REAL emite `width:null, height:null`: `.optional()` acepta ausente, no `null`.
    expect(
      extractImageOutput({
        images: [{ url: 'https://fal.media/nb2.png', width: null, height: null }],
      }),
    ).toBeNull();
  });
});

describe('extractImageUrlOutput (variante tolerante: solo exige la URL)', () => {
  it('acepta un output NB2 con dimensiones null (las dims se releen del fichero)', () => {
    const out = extractImageUrlOutput({
      images: [
        { url: 'https://fal.media/nb2.png', width: null, height: null, content_type: 'image/png' },
      ],
      description: '',
    });
    expect(out?.images[0]).toMatchObject({ url: 'https://fal.media/nb2.png' });
  });

  it('sigue exigiendo la URL descargable', () => {
    expect(extractImageUrlOutput({ images: [{ content_type: 'image/png' }] })).toBeNull();
    expect(extractImageUrlOutput({ images: [] })).toBeNull();
    expect(extractImageUrlOutput(null)).toBeNull();
  });
});
