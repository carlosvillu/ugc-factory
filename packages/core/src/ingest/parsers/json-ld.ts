// Parser de JSON-LD schema.org (`<script type="application/ld+json">`) del HTML.
// Determinista, sin red: recibe el HTML YA descargado. Extrae el nodo `Product` y
// sus `Offer`/`AggregateRating` (research §1.5, PRD §7.2 N1).
//
// El JSON-LD del mundo real es CAÓTICO (HEADLINE 2). Este parser DEBE tolerar:
//  - Múltiples bloques `ld+json` en la misma página (elige el `Product`, ignora
//    `BreadcrumbList`/`Organization`/`WebSite`).
//  - `@graph` array-wrapping: el `Product` anidado en `{ "@graph": [...] }`.
//  - `offers` como objeto único O como array de ofertas.
//  - `offers.price` como string ("29.99") O number (29.99).
//  - `image` como string única, array de strings, u objeto `{ url }` (o array de
//    esos objetos).
//  - `brand` como string O como objeto `{ name }`.
//  - `aggregateRating` con `ratingValue`/`reviewCount` string o number.
//  - JSON malformado en un bloque: se ignora ese bloque, no se aborta.
import type { RawImage } from '../../contracts/raw-content';
import { asString, priceToString } from './coerce';
import type { RawContentPartial } from './types';

// Regex tolerante: captura el contenido de cada <script type="application/ld+json">.
// `type` puede llevar comillas simples/dobles y atributos en cualquier orden; el
// flag `s` deja que `.` cruce saltos de línea. No intentamos parsear HTML entero:
// solo aislar los bloques ld+json.
const LD_JSON_BLOCK =
  /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `@type` puede ser string o array de strings; ¿alguno es exactamente `type`? */
function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type'];
  if (typeof t === 'string') return t === type;
  if (Array.isArray(t)) return t.some((x) => x === type);
  return false;
}

/** Recorre un valor JSON-LD (objeto, array, `@graph`, o los anidamientos documentados
 *  donde suele vivir el `Product`) y junta todos los objetos. Sin esto, un
 *  `{"@type":"WebPage","mainEntity":{Product}}` o un `Product` bajo
 *  `itemListElement[].item` se perdería por completo (el parser devolvería null). */
function flattenNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) flattenNodes(item, out);
    return;
  }
  const obj = value as Record<string, unknown>;
  out.push(obj);
  // `@graph`: array de nodos hermanos — aplánalos también.
  if (Array.isArray(obj['@graph'])) flattenNodes(obj['@graph'], out);
  // `mainEntity` (schema.org WebPage/ItemPage): el Product real de la página cuelga
  // aquí en muchas PDPs con SEO. Puede ser objeto o array.
  if (obj.mainEntity !== undefined) flattenNodes(obj.mainEntity, out);
  // `itemListElement[].item` (ItemList/BreadcrumbList a veces envuelve el Product en
  // `item`). Descendemos a cada `item`.
  if (Array.isArray(obj.itemListElement)) {
    for (const el of obj.itemListElement) {
      if (el !== null && typeof el === 'object') {
        flattenNodes((el as Record<string, unknown>).item, out);
      }
    }
  }
}

function extractImages(image: unknown): RawImage[] {
  const images: RawImage[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string') {
      const url = v.trim();
      if (url !== '') images.push({ url, alt: null });
    } else if (v !== null && typeof v === 'object') {
      // ImageObject: `{ url }` o `{ contentUrl }`.
      const o = v as Record<string, unknown>;
      const url = asString(o.url) ?? asString(o.contentUrl);
      if (url !== null) images.push({ url, alt: asString(o.caption) });
    }
  };
  if (Array.isArray(image)) image.forEach(push);
  else push(image);
  return images;
}

interface OfferFields {
  price: string | null;
  currency: string | null;
  availability: string | null;
}

/** Precio de un offer: `price` directo, `lowPrice` (AggregateOffer) o, como fallback
 *  documentado por Google/schema.org, `priceSpecification.price` (o su lowPrice). */
function offerPrice(offer: Record<string, unknown>): string | null {
  const direct = priceToString(offer.price ?? offer.lowPrice);
  if (direct !== null) return direct;
  const spec = offer.priceSpecification;
  if (spec !== null && typeof spec === 'object') {
    const s = spec as Record<string, unknown>;
    return priceToString(s.price ?? s.lowPrice);
  }
  return null;
}

/** Moneda de un offer: `priceCurrency` directo o dentro de `priceSpecification`. */
function offerCurrency(offer: Record<string, unknown>): string | null {
  const direct = asString(offer.priceCurrency);
  if (direct !== null) return direct;
  const spec = offer.priceSpecification;
  if (spec !== null && typeof spec === 'object') {
    return asString((spec as Record<string, unknown>).priceCurrency);
  }
  return null;
}

/** Primera oferta con precio de un `offers` que puede ser objeto o array. Extrae
 *  también `availability` (schema.org URL tipo `https://schema.org/InStock`), que el
 *  contrato `RawContent`/`RawProduct` ya transporta. */
function extractOffer(offers: unknown): OfferFields {
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (o === null || typeof o !== 'object') continue;
    const offer = o as Record<string, unknown>;
    const price = offerPrice(offer);
    if (price !== null) {
      return {
        price,
        currency: offerCurrency(offer),
        availability: asString(offer.availability),
      };
    }
  }
  return { price: null, currency: null, availability: null };
}

function extractBrand(brand: unknown): string | null {
  if (typeof brand === 'string') return asString(brand);
  if (brand !== null && typeof brand === 'object') {
    return asString((brand as Record<string, unknown>).name);
  }
  return null;
}

/**
 * Parsea el JSON-LD del HTML. Devuelve `null` si no hay ningún nodo `Product`
 * (fuente ausente → el merge sigue con OpenGraph). Nunca lanza: bloques malformados
 * se saltan.
 */
export function parseJsonLd(html: string): RawContentPartial | null {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(LD_JSON_BLOCK)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // bloque malformado: ignóralo, no abortes (HEADLINE 1).
    }
    flattenNodes(parsed, nodes);
  }

  const product = nodes.find((n) => hasType(n, 'Product'));
  if (!product) return null;

  const { price, currency, availability } = extractOffer(product.offers);

  let rating: number | null = null;
  let reviewCount: number | null = null;
  const agg = product.aggregateRating;
  if (agg !== null && typeof agg === 'object') {
    const a = agg as Record<string, unknown>;
    rating = toNumber(a.ratingValue);
    reviewCount = toNumber(a.reviewCount ?? a.ratingCount);
  }

  const images = extractImages(product.image);

  return {
    source: 'json-ld',
    title: asString(product.name),
    description: asString(product.description),
    price,
    currency,
    availability,
    brand: extractBrand(product.brand),
    images: images.length > 0 ? images : undefined,
    rating,
    reviewCount,
  };
}
