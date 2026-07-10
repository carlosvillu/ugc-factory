// Funde los parciales del fast path (Shopify `.json`, JSON-LD, OpenGraph) en el
// contrato de frontera `RawContent` de T1.1. Lógica PURA.
//
// PRECEDENCIA de campos cuando varias fuentes solapan (title/price/images y demás):
//   Shopify `.json`  >  JSON-LD  >  OpenGraph
// Motivo: el `.json` de Shopify es la fuente estructurada de más alta fidelidad
// (datos de la propia tienda); JSON-LD es SEO estructurado (fiable pero a veces
// resumido); OG es el fallback universal más pobre. Para cada campo se toma el
// primer valor no-nulo recorriendo las fuentes presentes en ese orden.
//
// GARANTÍA DURA (HEADLINE 1): el resultado SIEMPRE es un `RawContent` VÁLIDO según
// `RawContentSchema`, aunque TODAS las fuentes estén ausentes. `markdown` es
// `z.string()` (no-null) e `images` es un array obligatorio: el fast path no produce
// markdown (eso es Firecrawl, T1.4), así que `markdown` toma la mejor descripción
// disponible o `''` (cadena vacía — válida). "sin fila rota" = este RawContent
// `.parse()` en todas las ramas, por escaso que sea.
import { type RawContent, type RawImage, RawContentSchema } from '../contracts/raw-content';
import type { FastPathPlatform } from './url';
import type { RawContentPartial, RawSource } from './parsers/types';

/** Orden de precedencia de las fuentes (mayor a menor prioridad). */
const PRECEDENCE: RawSource[] = ['shopify', 'json-ld', 'opengraph'];

function ordered(partials: RawContentPartial[]): RawContentPartial[] {
  // Estable por precedencia; una fuente ausente simplemente no está en la lista.
  return [...partials].sort((a, b) => PRECEDENCE.indexOf(a.source) - PRECEDENCE.indexOf(b.source));
}

/** Primer valor no-nulo/no-vacío de un campo string recorriendo las fuentes. */
function firstString(
  sources: RawContentPartial[],
  pick: (p: RawContentPartial) => string | null | undefined,
): string | null {
  for (const s of sources) {
    const v = pick(s);
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

/** Imágenes: se toma el PRIMER conjunto no vacío por precedencia (no se fusionan
 *  entre fuentes — mezclar Shopify + OG duplicaría la misma imagen con URLs
 *  distintas). Dedupe por URL dentro del conjunto elegido. */
function pickImages(sources: RawContentPartial[]): RawImage[] {
  for (const s of sources) {
    if (s.images && s.images.length > 0) {
      const seen = new Set<string>();
      const out: RawImage[] = [];
      for (const img of s.images) {
        if (seen.has(img.url)) continue;
        seen.add(img.url);
        out.push(img);
      }
      return out;
    }
  }
  return [];
}

/** Quita etiquetas HTML de una descripción (Shopify `body_html`) para el markdown
 *  base. No es un conversor HTML→markdown (eso es Firecrawl); solo texto plano. */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MergeInput {
  url: string;
  platform: FastPathPlatform;
  partials: RawContentPartial[];
  /** Avisos acumulados por el cliente (p. ej. infra degradada); nunca "fuente
   *  ausente" (eso es normal, no un warning). Opcional. */
  warnings?: string[];
}

/**
 * Funde los parciales en un `RawContent` válido de modo `url`. Lanza SOLO si el
 * resultado no valida contra el schema (bug de programación, no un caso de datos):
 * las fuentes ausentes producen un RawContent escaso pero válido, nunca un throw.
 */
export function mergeRawContent(input: MergeInput): RawContent {
  const sources = ordered(input.partials);

  const title = firstString(sources, (p) => p.title);
  const description = firstString(sources, (p) => p.description);
  const price = firstString(sources, (p) => p.price);
  const currency = firstString(sources, (p) => p.currency);
  const availability = firstString(sources, (p) => p.availability);
  const variants = sources.find((p) => p.variants && p.variants.length > 0)?.variants;
  const images = pickImages(sources);
  // NOTA DE ALCANCE: `brand` (vendor/schema.org brand) y `rating`/`reviewCount`
  // (AggregateRating, faceta 6) los EXTRAEN los parsers y se testean, pero
  // `RawContent` (T1.1) NO tiene campo para ellos: son entrada del sintetizador
  // (T1.8, ProductBrief `pricing`/`social_proof`/`brand`), no del transporte crudo.
  // El fast path los descubre; su consumo llega en tareas posteriores. `branding`
  // de `RawContent` es paleta/tipografía (formato Firecrawl `branding`/VLM, T1.4/N2),
  // que el fast path determinista NO produce ⇒ `null` aquí.

  // `markdown` no-null (contrato): el fast path no renderiza markdown, así que el
  // texto base es la mejor descripción disponible (limpia de HTML) o `''`.
  const markdown = description !== null ? stripHtml(description) : '';

  const product =
    title !== null ||
    price !== null ||
    currency !== null ||
    availability !== null ||
    (variants && variants.length > 0)
      ? {
          title,
          price,
          currency,
          availability,
          ...(variants && variants.length > 0 ? { variants } : {}),
        }
      : null;

  const raw: RawContent = {
    source: 'url',
    url: input.url,
    platform: input.platform,
    markdown,
    images,
    branding: null,
    product,
    screenshotRef: null,
  };

  const parsed = RawContentSchema.safeParse(raw);
  if (!parsed.success) {
    // Nunca debería ocurrir con las ramas de arriba: es un guard de programación.
    throw new Error(`mergeRawContent produjo un RawContent inválido: ${parsed.error.message}`);
  }
  return parsed.data;
}
