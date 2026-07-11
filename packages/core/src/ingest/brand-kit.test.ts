// Tests de la derivación PURA del BrandKit (T1.9, §9.1). El dedup real (una fila por dominio,
// timestamps) se prueba contra Postgres en packages/db (Testcontainers): aquí solo la clave del
// dedup (el dominio registrable) y la fusión de fuentes de marca.
import { describe, expect, it } from 'vitest';
import { makeBrief, makeRawContent, makeVisualAnalysis } from '@ugc/test-utils';
import { brandKitDomain, deriveBrandKit } from './brand-kit';

const EXTRACTED_AT = new Date('2026-07-11T10:00:00.000Z');

describe('brandKitDomain (clave del dedup por dominio, §9.1)', () => {
  it('colapsa subdominios y paths al MISMO dominio registrable', () => {
    // La cláusula "2 URLs del mismo dominio" de la Verificación: dos productos distintos de la
    // misma tienda derivan el mismo `domain` ⇒ chocan contra el UNIQUE parcial ⇒ 1 sola extracción.
    expect(brandKitDomain('https://tienda.example.com/products/serum')).toBe('example.com');
    expect(brandKitDomain('https://tienda.example.com/products/crema?ref=nav')).toBe('example.com');
    expect(brandKitDomain('https://shop.example.com/products/otro')).toBe('example.com');
    expect(brandKitDomain('https://example.com/')).toBe('example.com');
  });

  it('dominios distintos NO colapsan', () => {
    expect(brandKitDomain('https://otra-tienda.example.org/p/1')).toBe('example.org');
    expect(brandKitDomain('https://allbirds.com/products/x')).not.toBe(
      brandKitDomain('https://ugmonk.com/products/y'),
    );
  });

  it('sin URL (modo manual) o URL inválida → null (kit EXENTO del dedup)', () => {
    expect(brandKitDomain(null)).toBeNull();
    expect(brandKitDomain(undefined)).toBeNull();
    expect(brandKitDomain('')).toBeNull();
    expect(brandKitDomain('no-es-una-url')).toBeNull();
  });
});

describe('deriveBrandKit (fusión branding + visual + brief, §9.1)', () => {
  it('modo url: source=extracted, dominio derivado y paleta del branding de Firecrawl', () => {
    const kit = deriveBrandKit({
      raw: makeRawContent(), // branding: { palette: ['#F5E9E2'], typography: 'serif' }
      brief: makeBrief(),
      visualAnalysis: makeVisualAnalysis(),
      extractedAt: EXTRACTED_AT,
    });

    expect(kit.domain).toBe('example.com');
    expect(kit.source).toBe('extracted'); // enum de brand_kit (extracted|manual), NO el de url_analysis
    expect(kit.palette).toEqual(['#F5E9E2']); // extractivo (CSS) gana a visual y a brief
    expect(kit.typography).toBe('serif');
    expect(kit.toneOfVoice).toBe('cercana y experta'); // del brief (N3)
    expect(kit.extractedAt).toEqual(EXTRACTED_AT);
  });

  it('sin branding: cae a la paleta/estética del análisis visual (screenshot)', () => {
    const visual = makeVisualAnalysis({
      brand_style: { palette: ['#101010', '#FAFAFA'], aesthetic: 'clinical' },
    });
    const kit = deriveBrandKit({
      raw: makeRawContent({ branding: null }),
      brief: makeBrief(),
      visualAnalysis: visual,
      extractedAt: EXTRACTED_AT,
    });

    expect(kit.palette).toEqual(['#101010', '#FAFAFA']);
    expect(kit.aesthetic).toBe('clinical');
    // Sin typography en branding, cae a la del brief.
    expect(kit.typography).toBe('serif elegante');
  });

  it('sin branding ni visual: cae al visual_style del brief (última fuente, inferencial)', () => {
    const kit = deriveBrandKit({
      raw: makeRawContent({ branding: null }),
      brief: makeBrief(),
      visualAnalysis: null,
      extractedAt: EXTRACTED_AT,
    });

    expect(kit.palette).toEqual(['#F5E9E2', '#3A3A3A']);
    expect(kit.aesthetic).toBe('premium minimal');
  });

  it('modo manual: source=manual y domain null (exento del dedup)', () => {
    const kit = deriveBrandKit({
      raw: makeRawContent({
        source: 'manual',
        url: null,
        platform: 'manual',
        branding: null,
        product: null,
      }),
      brief: makeBrief({
        meta: {
          source_url: null,
          platform: 'manual',
          language: 'es',
          extracted_at: '2026-07-11T10:00:00.000Z',
          extraction_confidence: 'low',
        },
      }),
      visualAnalysis: null,
      extractedAt: EXTRACTED_AT,
    });

    expect(kit.domain).toBeNull();
    expect(kit.source).toBe('manual');
  });
});
