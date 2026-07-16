// Unit del constructor de prompt de packshot (T4.4, N7a). PURO: brief → prompt, sin red, sin BD.
// Cubre lo que la ruta packshot-IA promete: la identidad del producto entra en el prompt, las
// señales de estudio/9:16 están, el estilo de marca se incorpora si existe, y el resultado es
// determinista (mismo brief → mismo prompt, base del content_hash).
import { describe, expect, it } from 'vitest';
import { makeBrief } from '@ugc/test-utils';
import { buildPackshotPrompt, PACKSHOT_MIN_SHOTS, PACKSHOT_MAX_SHOTS } from './packshot-prompt';

describe('buildPackshotPrompt', () => {
  it('incluye la identidad del producto (marca + nombre + categoría)', () => {
    const brief = makeBrief();
    const prompt = buildPackshotPrompt(brief);
    expect(prompt).toContain(brief.product.name);
    expect(prompt).toContain(brief.product.brand_name!);
    expect(prompt).toContain(brief.product.category);
    // El one_liner (gancho corto) también entra.
    expect(prompt).toContain(brief.product.one_liner);
  });

  it('lleva las señales de PACKSHOT de estudio y el encuadre 9:16 vertical', () => {
    const prompt = buildPackshotPrompt(makeBrief()).toLowerCase();
    expect(prompt).toContain('packshot');
    expect(prompt).toContain('studio');
    expect(prompt).toContain('neutral');
    expect(prompt).toContain('9:16');
    expect(prompt).toContain('vertical');
  });

  it('excluye texto, logos y personas (el packshot es solo el producto)', () => {
    const prompt = buildPackshotPrompt(makeBrief()).toLowerCase();
    expect(prompt).toContain('no text');
    expect(prompt).toContain('no people');
  });

  it('incorpora la paleta y la estética de marca cuando el brief las trae', () => {
    const brief = makeBrief();
    brief.brand.visual_style.palette = ['#0A0A0A', '#F5F5F5'];
    brief.brand.visual_style.aesthetic = 'minimalista escandinavo';
    const prompt = buildPackshotPrompt(brief);
    expect(prompt).toContain('#0A0A0A');
    expect(prompt).toContain('minimalista escandinavo');
  });

  it('es determinista: mismo brief → mismo prompt (base del content_hash)', () => {
    const brief = makeBrief();
    expect(buildPackshotPrompt(brief)).toBe(buildPackshotPrompt(brief));
  });

  it('cuando no hay brand_name, usa solo el nombre (sin "undefined" pegado)', () => {
    const brief = makeBrief();
    brief.product.brand_name = null;
    const prompt = buildPackshotPrompt(brief);
    expect(prompt).toContain(brief.product.name);
    expect(prompt).not.toContain('undefined');
    expect(prompt).not.toContain('null');
  });

  it('recorta una descripción larga sin romper el prompt', () => {
    const brief = makeBrief();
    brief.product.description = 'x'.repeat(1000);
    const prompt = buildPackshotPrompt(brief);
    // El prompt total no explota de tamaño (el recorte de la descripción actuó).
    expect(prompt.length).toBeLessThan(900);
    expect(prompt).toContain('…');
  });

  it('expone el rango de shots 2–3 (Entrega T4.4)', () => {
    expect(PACKSHOT_MIN_SHOTS).toBe(2);
    expect(PACKSHOT_MAX_SHOTS).toBe(3);
  });
});
