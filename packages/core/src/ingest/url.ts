// Clasificación y normalización de URL del fast path (N1, PRD §7.2 / §9.1).
// Lógica PURA y determinista: sin red, sin BD. Alimenta el cache key
// `url_normalizada + content_hash` de §12 (el CACHE en sí NO se implementa aquí,
// T1.3 guarda de alcance) y decide qué parser del fast path aplica.
import { createHash } from 'node:crypto';

import type { Platform } from '../contracts/product-brief';

/**
 * Plataforma clasificada por el fast path a partir de la URL SOLA (regex §7.2 N1).
 *
 * ALCANCE T1.3: solo `shopify | woocommerce | custom`. Amazon está FUERA (PRD D9):
 * no tiene fast path público fiable, así que una URL de Amazon NO se casa como
 * `amazon` — cae a `custom` (el parser JSON-LD/OG lo intentará igual). El enum
 * `Platform` de T1.1 lista `amazon` y `manual`, pero el clasificador de URL nunca
 * los devuelve: `manual` es el modo texto-libre de T1.6 (no hay URL que clasificar)
 * y `amazon` queda para una tarea futura con vendor específico. Por eso el tipo de
 * retorno es un subconjunto explícito de `Platform`, no `Platform` entero.
 */
export type FastPathPlatform = Extract<Platform, 'shopify' | 'woocommerce' | 'custom'>;

/**
 * Clasifica una URL de producto por señales del dominio y el path (§7.2 N1).
 *
 * Determinista y sin efectos. Reglas (primera que casa gana):
 *  - Shopify: host `*.myshopify.com` O un path de producto `/products/<handle>`
 *    (el patrón que expone el truco `.json`, research §1.5).
 *  - WooCommerce: path de producto de WordPress `/product/<slug>` (singular; ojo:
 *    la señal fuerte de Woo vive en el HTML, no en la URL — desde la URL sola solo
 *    podemos usar la convención de permalink `/product/`, research §1.5 / PRD §9.1).
 *  - Resto (incluida Amazon): `custom`.
 *
 * Una URL sintácticamente inválida se clasifica `custom` (no lanza: el clasificador
 * nunca es el punto que rompe la ingesta — HEADLINE 1).
 */
export function classifyUrl(rawUrl: string): FastPathPlatform {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'custom';
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  // Amazon FUERA de alcance (D9): se descarta ANTES del test de WooCommerce porque
  // sus rutas de producto (`/gp/product/…`, `/dp/…`) contienen `/product/` y
  // dispararían el falso positivo Woo. Un host Amazon nunca se casa como plataforma
  // con fast path → `custom` (el parser JSON-LD/OG lo intentará igual).
  if (host === 'amazon.com' || /(^|\.)amazon\.[a-z.]+$/.test(host)) return 'custom';

  // Shopify: subdominio myshopify.com o path de producto Shopify (`/products/<x>`).
  if (host === 'myshopify.com' || host.endsWith('.myshopify.com')) return 'shopify';
  if (/\/products\/[^/]+/.test(path)) return 'shopify';

  // WooCommerce: permalink de producto WordPress en singular (`/product/<x>`), como
  // segmento propio y no como parte de `/gp/product/` (ya descartado arriba).
  if (/\/product\/[^/]+/.test(path)) return 'woocommerce';

  return 'custom';
}

/**
 * Normaliza una URL a su forma canónica para el cache key (§12 `url_normalizada`).
 * Determinista e IDEMPOTENTE (`normalizeUrl(normalizeUrl(x)) === normalizeUrl(x)`),
 * fijado por test permanente (regla de trabajo 8).
 *
 * Reglas de normalización (documentadas — son el contrato del cache key):
 *  - Esquema y host a minúsculas (WHATWG `URL` ya lo hace).
 *  - Se elimina el fragmento (`#...`): nunca identifica un recurso distinto.
 *  - Se elimina el puerto por defecto del esquema (`:80`/`:443`) — WHATWG lo hace.
 *  - Se ordenan los parámetros de query alfabéticamente (mismo recurso, orden de
 *    query distinto ⇒ misma clave). NO se eliminan parámetros de tracking (utm_*):
 *    T1.3 no tiene regla de producto para ello; podarlos sería una decisión de
 *    caché que pertenece a la tarea de caché, no aquí.
 *  - Se elimina la barra final del path SOLO cuando el path es la raíz (`/`) o
 *    termina en `/` sin ser la raíz: `.../serum/` → `.../serum`. La raíz queda `''`
 *    (host desnudo) para que `https://x.com` y `https://x.com/` colapsen.
 *
 * Una URL inválida se devuelve tal cual (trim): la normalización nunca lanza.
 */
export function normalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }
  url.hash = '';
  url.searchParams.sort();
  // Recompone sin barra final redundante en el path.
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  if (pathname === '/') pathname = '';
  const search = url.search; // ya ordenado por sort()
  return `${url.protocol}//${url.host}${pathname}${search}`;
}

/**
 * Hash determinista del contenido para el cache key (§12 `content_hash`).
 *
 * Acepta un string (p. ej. el texto manual de T1.6) o un objeto (el `RawContent`
 * del fast path). Para objetos se serializa con claves ORDENADAS recursivamente
 * antes de hashear: `JSON.stringify` respeta el orden de inserción de claves, así
 * que sin ordenar, dos objetos equivalentes con distinto orden de campos darían
 * hashes distintos (la trampa). SHA-256 (sha256 hex) — módulo server-only, no hay
 * problema de tamaño de bundle.
 *
 * Determinista e idempotente por construcción; fijado por test permanente (regla 8).
 *
 * NOTA sobre el cache key: el key de §12 es `url_normalizada + content_hash`. Como la
 * URL viaja aparte en el key, el CALLER debe hashear SOLO el contenido (excluyendo el
 * `url` crudo del RawContent) — así dos variantes de la misma URL del mismo contenido
 * colisionan por hash. `makeFastPathIngester` lo hace (omite `url` antes de hashear).
 */
export function contentHash(input: string | Record<string, unknown>): string {
  const serialized = typeof input === 'string' ? input : stableStringify(input);
  return createHash('sha256').update(serialized).digest('hex');
}

/** Serialización estable: ordena claves de objetos recursivamente. Los arrays
 *  conservan su orden (es significativo). Valores primitivos y null van tal cual. */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}
