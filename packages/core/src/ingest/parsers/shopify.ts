// Parser del endpoint público Shopify `{handle}.json` (research §1.5). Determinista,
// sin red: recibe el JSON YA descargado (el cliente HTTP fino lo obtiene). Shape real
// (verificado contra tiendas Shopify): `{ product: { title, body_html, vendor,
// product_type, tags, variants:[{ price, title }], images:[{ src, alt }] } }`.
//
// Robustez ante el mundo real (HEADLINE 2): un JSON que no tenga la forma esperada
// NUNCA lanza — devuelve `null` (fuente ausente) o un parcial escaso. Los `price`
// llegan como string en Shopify pero se defienden por si vienen number.
import type { RawImage } from '../../contracts/raw-content';
import { asString, priceToString } from './coerce';
import type { RawContentPartial } from './types';

/**
 * Parsea el JSON de `{handle}.json` a un parcial. Devuelve `null` si el JSON no
 * contiene un objeto `product` reconocible (fuente ausente → el merge sigue con
 * JSON-LD/OG). Nunca lanza.
 */
export function parseShopifyJson(json: unknown): RawContentPartial | null {
  if (json === null || typeof json !== 'object') return null;
  const product = (json as Record<string, unknown>).product;
  if (product === null || typeof product !== 'object') return null;
  const p = product as Record<string, unknown>;

  // Precio: primera variante con precio (Shopify garantiza ≥1 variante en un
  // producto publicado, pero defendemos el array ausente/vacío). La MONEDA no se
  // extrae: el `{handle}.json` público de Shopify no la expone (es shop-level, fuera
  // de este endpoint) — el fast path deja `currency` en null antes que fabricarla.
  let price: string | null = null;
  const variantTitles: string[] = [];
  if (Array.isArray(p.variants)) {
    for (const v of p.variants) {
      if (v === null || typeof v !== 'object') continue;
      const variant = v as Record<string, unknown>;
      price ??= priceToString(variant.price);
      const vt = asString(variant.title);
      // "Default Title" es el placeholder de Shopify para productos sin variantes
      // reales — no lo listamos como variante significativa.
      if (vt !== null && vt !== 'Default Title') variantTitles.push(vt);
    }
  }

  // Imágenes: `images[].src` con `alt` opcional.
  const images: RawImage[] = [];
  if (Array.isArray(p.images)) {
    for (const img of p.images) {
      if (img === null || typeof img !== 'object') continue;
      const src = asString((img as Record<string, unknown>).src);
      if (src === null) continue;
      const alt = asString((img as Record<string, unknown>).alt);
      images.push({ url: src, alt });
    }
  }

  return {
    source: 'shopify',
    title: asString(p.title),
    description: asString(p.body_html),
    price,
    currency: null, // no disponible en el endpoint público (ver arriba)
    brand: asString(p.vendor),
    variants: variantTitles.length > 0 ? variantTitles : undefined,
    images: images.length > 0 ? images : undefined,
  };
}
