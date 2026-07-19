// Unit del constructor del prompt t2i de miniatura/prueba de un template (T4.12). Lógica PURA →
// determinista → red del gate: el prompt debe (a) desnudar los slots `{namespace.field}` a palabras
// planas (una miniatura no resuelve slots), (b) incluir el título del template, (c) ser DETERMINISTA
// (mismo template → mismo prompt, base del `content_hash` que colapsa thumbnail y prueba).
import { describe, expect, it } from 'vitest';
import { buildTemplateThumbnailPrompt } from './template-thumbnail-prompt';

const TEMPLATE = {
  title: 'GRWM beauty pain point',
  description: 'Rutina de mañana que resuelve un dolor de piel',
  body: 'Presenta {product.name} resolviendo {pain_point} en un {setting.type} luminoso.',
};

describe('buildTemplateThumbnailPrompt (T4.12)', () => {
  it('incluye el título del template', () => {
    expect(buildTemplateThumbnailPrompt(TEMPLATE)).toContain('GRWM beauty pain point');
  });

  it('DESNUDA los slots {namespace.field} a palabras planas (no deja llaves en el prompt)', () => {
    const prompt = buildTemplateThumbnailPrompt(TEMPLATE);
    // Sin llaves crudas: un slot sin resolver en el prompt de imagen sería basura literal.
    expect(prompt).not.toMatch(/[{}]/);
    // El texto del slot informa la escena, ya desnudo: `{product.name}` → `product name`.
    expect(prompt).toContain('product name');
    expect(prompt).toContain('pain point');
  });

  it('es DETERMINISTA: mismo template → mismo prompt (base del content_hash)', () => {
    expect(buildTemplateThumbnailPrompt(TEMPLATE)).toBe(buildTemplateThumbnailPrompt(TEMPLATE));
  });

  it('tolera description null y body sin slots', () => {
    const prompt = buildTemplateThumbnailPrompt({
      title: 'Plain',
      description: null,
      body: 'Un plano simple del producto',
    });
    expect(prompt).toContain('Plain');
    expect(prompt).toContain('Un plano simple del producto');
    expect(prompt).not.toMatch(/[{}]/);
  });

  it('incluye la cola de estilo UGC vertical (composición 9:16, sin texto/logos)', () => {
    const prompt = buildTemplateThumbnailPrompt(TEMPLATE);
    expect(prompt).toContain('9:16');
    expect(prompt).toContain('no text overlays');
  });
});
