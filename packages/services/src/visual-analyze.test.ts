// Unit del filtro de URLs de imagen de producto FETCHEABLES (T1.7, relajado en T1.14).
// `raw.images` viene SIN sanear de T1.4 (logos SVG, píxeles data:, tracking), pero desde el
// fix de coste de T1.7 TODAS las imágenes van fetch → re-codificación PNG con sharp: el gate
// real es «¿fetch OK y decodifica?». Este filtro solo excluye lo que NO debe llegar al fetch:
// no-http(s) (data:/blob:) y SVG explícito por extensión. Los DOS casos reales que el filtro
// viejo (regex de extensión raster) descartaba y costaron un N3 FAIL (2026-07-13): URLs `.avif`
// (relatio.chat) y `/_next/image?url=…` sin extensión en el pathname (stayforlong.com).
import { describe, expect, it } from 'vitest';

import { fetchableProductImageUrls } from './visual-analyze';

describe('fetchableProductImageUrls — pasa todo http(s) no-SVG; el fetch+decode decide el resto', () => {
  it('mantiene las extensiones raster clásicas http(s), preservando el orden', () => {
    const urls = fetchableProductImageUrls([
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

  it('caso real relatio.chat: URLs .avif PASAN (sharp decodifica AVIF; el filtro viejo las descartaba)', () => {
    expect(
      fetchableProductImageUrls([
        { url: 'https://relatio.chat/images/hero.avif' },
        { url: 'https://relatio.chat/images/screens.avif?w=1200' },
      ]),
    ).toEqual([
      'https://relatio.chat/images/hero.avif',
      'https://relatio.chat/images/screens.avif?w=1200',
    ]);
  });

  it('caso real stayforlong.com: /_next/image?url=… sin extensión en el pathname PASA', () => {
    // El patrón estándar de TODA web Next.js: la extensión real vive URL-encodeada en el query
    // param. No se parsea el query: pasa y lo decide el fetch+decode.
    const nextImage =
      'https://www.stayforlong.com/_next/image?url=https%3A%2F%2Fcdn.stayforlong.com%2Fhero.jpg&w=1080&q=75';
    expect(fetchableProductImageUrls([{ url: nextImage }])).toEqual([nextImage]);
  });

  it('URLs sin extensión (endpoints dinámicos, incluso tracking) PASAN: el fetch+decode las dropea si no son imagen', () => {
    expect(
      fetchableProductImageUrls([
        { url: 'https://track.example.com/pixel' },
        { url: 'https://cdn.example.com/img?id=123' },
      ]),
    ).toEqual(['https://track.example.com/pixel', 'https://cdn.example.com/img?id=123']);
  });

  it('descarta SVG por extensión en el pathname (logo vectorial ≠ imagen de producto)', () => {
    expect(
      fetchableProductImageUrls([
        { url: 'https://cdn.example.com/logo.svg' },
        { url: 'https://cdn.example.com/logo.SVG' }, // case-insensitive
        { url: 'https://cdn.example.com/logo.svg?v=2' }, // query no vive en el pathname
        { url: 'https://cdn.example.com/logo.svg#icon' }, // hash tampoco
        { url: 'https://cdn.example.com/hero.jpg' },
      ]),
    ).toEqual(['https://cdn.example.com/hero.jpg']);
  });

  it('un SVG servido SIN extensión pasa el filtro (comportamiento documentado: lo resuelve el decode)', () => {
    // Sin content-type sniffing (decisión de alcance T1.14): sharp rasterizaría un SVG que
    // llegue por un endpoint sin extensión. Aceptado y fijado aquí para que nadie lo "arregle"
    // reintroduciendo un filtro por extensión.
    expect(
      fetchableProductImageUrls([{ url: 'https://cdn.example.com/asset/logo-vector' }]),
    ).toEqual(['https://cdn.example.com/asset/logo-vector']);
  });

  it('descarta data-URIs y blob: (no son fuentes http(s) fetcheables)', () => {
    expect(
      fetchableProductImageUrls([
        { url: 'data:image/png;base64,iVBORw0KGgo=' },
        { url: 'blob:https://x/abc' },
        { url: 'https://cdn.example.com/ok.png' },
      ]),
    ).toEqual(['https://cdn.example.com/ok.png']);
  });

  it('descarta URLs malformadas/relativas sin crashear', () => {
    expect(
      fetchableProductImageUrls([
        { url: '/relative/path.jpg' }, // relativa: new URL lanza
        { url: 'not a url' },
        { url: 'https://cdn.example.com/valid.png' },
      ]),
    ).toEqual(['https://cdn.example.com/valid.png']);
  });

  it('lista vacía → vacía', () => {
    expect(fetchableProductImageUrls([])).toEqual([]);
  });
});
