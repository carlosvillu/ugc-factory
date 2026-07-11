// Derivación PURA del BrandKit (T1.9, PRD §9.1): del `RawContent` (formato `branding` de
// Firecrawl) + el `VisualAnalysis` (paleta/estética del screenshot, T1.7) + el `ProductBrief`
// (tono de voz, N3) a los campos de la fila `brand_kit`. Sin I/O: el UPSERT por dominio vive
// en `packages/db/src/repos/brand-kit.repo.ts` (core no toca la BD — architecture.md §1).
//
// §9.1: "análisis posteriores del mismo dominio REUTILIZAN el BrandKit sin re-extraer". La
// clave de esa reutilización es el DOMINIO, y su normalización es la misma que la del
// mini-crawl (T1.5): `registrableDomain` — un solo sitio, para que `shop.glow.example` y
// `glow.example` no acaben con dos kits distintos.
import type { ProductBrief } from '../contracts/product-brief';
import type { RawContent } from '../contracts/raw-content';
import type { VisualAnalysis } from '../contracts/visual-analysis';
import { registrableDomain } from './firecrawl';

/**
 * Dominio registrable de una URL de análisis, o `null` si no hay URL (modo manual) o no es
 * una URL válida. `null` es un valor legítimo: el UNIQUE de `brand_kit.domain` es PARCIAL
 * (T1.2) y los kits manuales (sin dominio) NO deduplican entre sí — cada uno es el suyo.
 */
export function brandKitDomain(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    // Binding explícito (nunca `catch {}`): una URL inválida aquí no es un fallo del pipeline
    // — degradamos a "sin dominio" (kit no deduplicable), pero el error queda a la vista de
    // quien lea el código, no escondido.
    void error;
    return null;
  }
  const domain = registrableDomain(parsed.hostname);
  return domain.length > 0 ? domain : null;
}

/** Los campos del `brand_kit` que el análisis produce (espejo del §12 sin los de BD: id,
 *  project_id, timestamps). `logoAssetId` NO se deriva aquí: el logo es un asset que sube la
 *  capa servicio (T1.10a) tras persistirlo — este módulo es puro. */
export interface DerivedBrandKit {
  /** `null` en modo manual (sin dominio → exento del dedup). */
  domain: string | null;
  /** §12 `brand_kit.source`: `extracted` (de una URL scrapeada) | `manual` (texto libre).
   *  OJO: enum DISTINTO del de `url_analysis.source` (`url|manual`). */
  source: 'extracted' | 'manual';
  /** NOT NULL en §12: hex colors. */
  palette: string[];
  /** `?` en §12 ⇒ nullable. */
  typography: string | null;
  /** NOT NULL en §12. */
  toneOfVoice: string;
  /** NOT NULL en §12. */
  aesthetic: string;
  /** NOT NULL en §12: cuándo se extrajo ESTE kit. La reutilización conserva el timestamp
   *  del PRIMER análisis (esa es la evidencia observable de que no se re-extrajo). */
  extractedAt: Date;
}

export interface DeriveBrandKitInput {
  raw: RawContent;
  brief: ProductBrief;
  visualAnalysis?: VisualAnalysis | null;
  /** Reloj inyectado (determinismo en test): el instante de esta extracción. */
  extractedAt: Date;
}

/**
 * Funde las tres fuentes de marca en los campos de `brand_kit` (§9.1: "logo, paleta, tono desde
 * format `branding` + análisis visual"). Prioridad de la paleta: `branding` de Firecrawl (dato
 * EXTRAÍDO del CSS de la página) > paleta del análisis visual (leída del screenshot por el VLM)
 * > `brand.visual_style.palette` del brief (síntesis del LLM). De extractivo a inferencial: la
 * misma jerarquía que gobierna el cross-check de precio del validador.
 */
export function deriveBrandKit(input: DeriveBrandKitInput): DerivedBrandKit {
  const { raw, brief, visualAnalysis, extractedAt } = input;

  const brandingPalette = raw.branding?.palette ?? [];
  const visualPalette = visualAnalysis?.brand_style?.palette ?? [];
  const palette =
    brandingPalette.length > 0
      ? brandingPalette
      : visualPalette.length > 0
        ? visualPalette
        : brief.brand.visual_style.palette;

  return {
    domain: brandKitDomain(raw.url),
    source: raw.source === 'manual' ? 'manual' : 'extracted',
    palette,
    typography: raw.branding?.typography ?? brief.brand.visual_style.typography ?? null,
    toneOfVoice: brief.brand.tone_of_voice,
    aesthetic: visualAnalysis?.brand_style?.aesthetic ?? brief.brand.visual_style.aesthetic,
    extractedAt,
  };
}
