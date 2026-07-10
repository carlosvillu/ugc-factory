// Suite de synthManualRawContent (T1.6): función pura que sintetiza el RawContent
// del modo manual. Verifica el shape del bicondicional de modo, la traducción de
// refs a RawImage y el determinismo. NO hay red aquí: es el short-circuit.
import { RawContentSchema } from '../contracts/raw-content';
import { describe, expect, it } from 'vitest';

import { synthManualRawContent } from './manual';

describe('synthManualRawContent', () => {
  const text = 'Un sérum hidratante con ácido hialurónico para piel sensible.';

  it('sintetiza un RawContent manual válido (source manual, url null, platform manual)', () => {
    const raw = synthManualRawContent({ text });
    expect(RawContentSchema.safeParse(raw).success).toBe(true);
    expect(raw.source).toBe('manual');
    expect(raw.url).toBeNull();
    expect(raw.platform).toBe('manual');
    expect(raw.markdown).toBe(text);
    expect(raw.images).toEqual([]);
  });

  it('el markdown ES el texto del usuario (contenido sintético, §7.4)', () => {
    expect(synthManualRawContent({ text }).markdown).toBe(text);
  });

  it('traduce las refs de imagen a RawImage {url, alt}', () => {
    const raw = synthManualRawContent({
      text,
      imageRefs: [
        { url: '/api/assets/a/download', alt: 'packshot' },
        { url: '/api/assets/b/download' },
      ],
    });
    expect(raw.images).toEqual([
      { url: '/api/assets/a/download', alt: 'packshot' },
      { url: '/api/assets/b/download', alt: null },
    ]);
  });

  it('NO deriva branding/product/screenshotRef (modo manual sin fast path)', () => {
    const raw = synthManualRawContent({ text });
    expect(raw.branding).toBeUndefined();
    expect(raw.product).toBeUndefined();
    expect(raw.screenshotRef).toBeUndefined();
  });

  it('es determinista: mismo input → mismo output', () => {
    const input = { text, imageRefs: [{ url: '/api/assets/a/download' }] };
    expect(synthManualRawContent(input)).toEqual(synthManualRawContent(input));
  });
});
