// Unit del filtro de URLs de imagen enviables al VLM (T1.7). Es la protección de regresión de
// un modo de fallo CARO: un bloque `image/url` con un SVG o data-URI 400ea la request COMPLETA
// → FAIL de la única llamada real del verifier (dinero real). `raw.images` viene SIN sanear de
// T1.4 (logos SVG, píxeles data:, tracking), así que este filtro es load-bearing, no cosmético.
import { describe, expect, it } from 'vitest';

import { sendableProductImageUrls } from './visual-analyze';

describe('sendableProductImageUrls — solo raster http(s) (evita el 400 del verifier)', () => {
  it('mantiene jpg/jpeg/png/gif/webp http(s), preservando el orden', () => {
    const urls = sendableProductImageUrls([
      { url: 'https://cdn.example.com/hero.jpg' },
      { url: 'https://cdn.example.com/detail.PNG' }, // extensión en mayúsculas
      { url: 'http://cdn.example.com/loop.gif' },
      { url: 'https://cdn.example.com/pic.webp' },
      { url: 'https://cdn.example.com/photo.jpeg?v=2' }, // query tras la extensión
    ]);
    expect(urls).toEqual([
      'https://cdn.example.com/hero.jpg',
      'https://cdn.example.com/detail.PNG',
      'http://cdn.example.com/loop.gif',
      'https://cdn.example.com/pic.webp',
      'https://cdn.example.com/photo.jpeg?v=2',
    ]);
  });

  it('descarta SVG (fuente url no soportada → 400 de toda la request)', () => {
    expect(
      sendableProductImageUrls([
        { url: 'https://cdn.example.com/logo.svg' },
        { url: 'https://cdn.example.com/hero.jpg' },
      ]),
    ).toEqual(['https://cdn.example.com/hero.jpg']);
  });

  it('descarta data-URIs y blob: (no son fuentes url http(s))', () => {
    expect(
      sendableProductImageUrls([
        { url: 'data:image/png;base64,iVBORw0KGgo=' },
        { url: 'blob:https://x/abc' },
        { url: 'https://cdn.example.com/ok.png' },
      ]),
    ).toEqual(['https://cdn.example.com/ok.png']);
  });

  it('descarta URLs sin extensión raster (tracking pixels, endpoints dinámicos)', () => {
    expect(
      sendableProductImageUrls([
        { url: 'https://track.example.com/pixel' },
        { url: 'https://cdn.example.com/img?id=123' }, // sin extensión en el path
        { url: 'https://cdn.example.com/real.jpg' },
      ]),
    ).toEqual(['https://cdn.example.com/real.jpg']);
  });

  it('descarta URLs malformadas/relativas sin crashear', () => {
    expect(
      sendableProductImageUrls([
        { url: '/relative/path.jpg' }, // relativa: new URL lanza
        { url: 'not a url' },
        { url: 'https://cdn.example.com/valid.png' },
      ]),
    ).toEqual(['https://cdn.example.com/valid.png']);
  });

  it('lista vacía → vacía', () => {
    expect(sendableProductImageUrls([])).toEqual([]);
  });
});
