import { describe, expect, it } from 'vitest';

import {
  HTML_NO_SIGNAL,
  HTML_OG_GT_IN_CONTENT,
  HTML_OG_NO_PRICE,
  HTML_OG_WITH_PRICE,
} from '../fixtures/html';
import { parseOpenGraph } from './opengraph';

describe('parseOpenGraph', () => {
  it('extrae og:title/description, varias og:image y product:price:amount+currency', () => {
    const p = parseOpenGraph(HTML_OG_WITH_PRICE);
    expect(p?.source).toBe('opengraph');
    expect(p?.title).toBe('Linen Shirt & Co.'); // entidad &amp; decodificada
    expect(p?.description).toBe('Breathable summer linen.');
    expect(p?.price).toBe('49.90');
    expect(p?.currency).toBe('EUR');
    expect(p?.images).toEqual([
      { url: 'https://img.example/shirt-1.jpg', alt: null },
      { url: 'https://img.example/shirt-2.jpg', alt: null },
    ]);
  });

  it('OG sin precio (product:price:amount ausente): título+imagen, price null', () => {
    const p = parseOpenGraph(HTML_OG_NO_PRICE);
    expect(p?.title).toBe('Minimal Notebook'); // vía name="og:title"
    expect(p?.price).toBeNull();
    expect(p?.images).toEqual([{ url: 'https://img.example/notebook.jpg', alt: null }]);
  });

  it('FIX 2: content con `>` entrecomillado no rompe la extracción', () => {
    const p = parseOpenGraph(HTML_OG_GT_IN_CONTENT);
    expect(p?.title).toBe('Speed: Before > After transformation');
    expect(p?.description).toBe('Compare 10 > 5 minutes with our tool.');
    expect(p?.price).toBe('19.00');
    expect(p?.images).toEqual([{ url: 'https://img.example/before-after.jpg', alt: null }]);
  });

  it('devuelve null si no hay ninguna señal OG útil (ni título ni imagen)', () => {
    expect(parseOpenGraph(HTML_NO_SIGNAL)).toBeNull();
    expect(parseOpenGraph('')).toBeNull();
  });
});
