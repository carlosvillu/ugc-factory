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

// ── Redirección significativa (T2.7, F2b) ────────────────────────────────────
//
// EL DEFECTO QUE CIERRA: el usuario pide analizar UNA página y el sistema analiza OTRA sin
// decírselo. Hasta T2.7, la URL FINAL (la que la web sirvió tras las redirecciones) se tiraba
// en los tres caminos de ingesta y `url_normalized` guardaba la PEDIDA. El caso vivo:
// `dr-squatch.com/products/pine-tar-bar-soap` devuelve `301 → dr-squatch.com/` (la home), y el
// pipeline analizó fielmente la home creyendo que analizaba el jabón. No es exclusivo de un
// dominio secuestrado: un producto DESCATALOGADO que redirige a la home hace exactamente lo
// mismo, y es el caso normal del uso real.
//
// POR QUÉ EL CRITERIO ES ESTRECHO. Las redirecciones son la NORMA en la web: `http→https`,
// `www.`, barra final, canonicalización de query, locale/geo. Si el aviso saltara con todas,
// saltaría SIEMPRE — y un aviso que sale siempre no lo lee nadie (sería peor que no tenerlo:
// entrenaría al usuario a ignorar la única señal que le queda). Por eso solo se marcan las dos
// formas que de verdad cambian QUÉ se analizó:
//
//   1. CAMBIO DE HOST — otro sitio (dominio caducado/parkeado/redirigido a un marketplace).
//      Se ignora el prefijo `www.` y la relación subdominio↔dominio (`shop.x.com` ↔ `x.com`:
//      canonicalización interna del mismo comerciante, no otro sitio).
//   2. LA RAMA DEL PATH DIVERGE — el DIRECTORIO PADRE de lo pedido desaparece del destino.
//
// EL DISCRIMINADOR DEL PUNTO 2, que es la parte fina de esta tarea: **el ÚLTIMO SEGMENTO (el
// slug) puede cambiar libremente; lo que no puede es cambiar el PADRE.** Compáralo con la
// alternativa obvia —"el último segmento cambió"— y se ve por qué:
//
//   pedido `/products/pine-tar-bar-soap` → `/`                  padre `products` → (ninguno)   ⇒ AVISA (home)
//   pedido `/products/pine-tar-bar-soap` → `/collections/soaps` padre `products` → `collections`⇒ AVISA (categoría)
//   pedido `/products/serum`             → `/products/serum-v2` padre `products` → `products`   ⇒ calla (RENAME)
//   pedido `/products/serum`             → `/es/products/serum` padre `products` ⊂ `es/products` ⇒ calla (LOCALE)
//
// Un criterio por "cambió el slug" marcaría el rename (`serum` → `serum-v2`), que es una
// redirección legítima y frecuentísima: sería la máquina de falsos positivos que la tarea
// prohíbe. El PADRE es la señal honesta de "esto ya no es una página del mismo tipo": el
// producto dejó de existir y la web te mandó a la home o al catálogo. Formalmente: se avisa
// cuando el path padre pedido NO es sufijo del path padre final (el sufijo absorbe el prefijo
// de locale/geo, que es aditivo por delante).
//
// El caso RAÍZ (`/collections/soaps` → `/`) es un caso PARTICULAR de esta regla, y conserva su
// propio `reason` porque el copy de CP1 sí cambia ("te devolvió su portada" vs "te devolvió otra
// sección"): el `reason` es contrato, el wording no.
//
// Lo que NO se marca (deliberado): esquema, `www.`, barra final, orden/adición de query
// (`?utm_*`), fragmento, subdominio, prefijo de locale, y el RENAME del slug dentro del mismo
// padre — incluido el hermano (`/products/a` → `/products/b`): es INDISTINGUIBLE de un rename
// desde la URL sola, y avisar de él ensuciaría la señal. Ese caso queda FUERA de alcance a
// conciencia (juicio humano, como concede el planning), no es un hueco olvidado.
//
// AVISA, NO BLOQUEA (decisión de producto de T2.7, precedente T1.15): el run SIGUE y CP1 lo
// enseña. Hay redirecciones legítimas que solo un humano puede juzgar (un producto renombrado,
// una web reestructurada); matar el run le quitaría al humano la decisión que el checkpoint
// existe para darle. Ver `BriefWarning` code `url_redirected` (contracts/brief-warning.ts).

/** Host sin el prefijo `www.` (que NUNCA es un sitio distinto). Minúsculas. */
function bareHost(host: string): string {
  const h = host.toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/** ¿`a` y `b` son el MISMO sitio? Ignora `www.` y la relación subdominio↔dominio
 *  (`shop.glow.example` ↔ `glow.example`: la canonicalización interna de un comerciante NO es
 *  un cambio de sitio). Dos hosts hermanos distintos (`a.com` vs `b.com`) NO lo son.
 *
 *  DEUDA CONOCIDA (la MISMA que documenta `registrableDomain` en `firecrawl.ts`, T1.9): la
 *  relación "es subdominio de" trata `x.github.io` ↔ `github.io` —o `tienda.myshopify.com` ↔
 *  `myshopify.com`— como el mismo sitio, porque no usamos una public-suffix-list. Aquí el
 *  impacto es BAJO y en la dirección segura: solo puede CALLAR un aviso (falso negativo) entre
 *  dos hosts de un sufijo compartido, nunca inventar uno; y el caso común de T2.7 es una tienda
 *  con dominio propio. Se ARREGLA con la misma PSL que cierre la deuda de T1.9, no antes ni
 *  aparte (una segunda heurística de dominio sería una segunda fuente de verdad). */
function sameSite(a: string, b: string): boolean {
  const ha = bareHost(a);
  const hb = bareHost(b);
  if (ha === hb) return true;
  return ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}

/** Segmentos del path de una URL YA PARSEADA, sin vacíos: `/products/serum/` → `['products',
 *  'serum']`, y la raíz (`/`) → `[]`. El filtrado de vacíos absorbe la barra final igual que la
 *  poda de `normalizeUrl`, sin repetir su recorte a mano. */
function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter((segment) => segment !== '');
}

/** ¿`sub` es SUFIJO de `full`? (`['products'] ⊂ ['es','products']`). Un prefijo de locale/geo es
 *  ADITIVO POR DELANTE, así que la relación de sufijo lo absorbe sin marcarlo. */
function isSuffix(sub: string[], full: string[]): boolean {
  if (sub.length > full.length) return false;
  const offset = full.length - sub.length;
  return sub.every((seg, i) => seg === full[offset + i]);
}

/** El motivo POR EL QUE una redirección es significativa. Union cerrada: el consumidor
 *  (CP1) hace `switch` exhaustivo y un motivo nuevo rompe la compilación.
 *
 *  - `host_changed`: el destino está en otro sitio.
 *  - `path_to_root`: el destino es la HOME desnuda (el caso dr-squatch/producto retirado).
 *  - `path_diverged`: el destino cuelga de OTRA rama del sitio — típicamente la CATEGORÍA a la
 *    que la tienda manda un producto descatalogado (`/products/x` → `/collections/y`). */
export type RedirectMismatchReason = 'host_changed' | 'path_to_root' | 'path_diverged';

/** Una redirección SIGNIFICATIVA: qué se pidió, qué se sirvió y por qué importa. Las dos URLs
 *  van NORMALIZADAS (`normalizeUrl`), que es lo que CP1 enseña y lo que la BD guarda. */
export interface RedirectMismatch {
  requested: string;
  final: string;
  reason: RedirectMismatchReason;
}

/**
 * ¿La URL que la web SIRVIÓ cambia lo que el usuario pidió analizar? Función PURA y
 * determinista — es EL comparador de T2.7 (la lógica; la captura de la URL final vive en cada
 * ingester y el aviso en CP1).
 *
 * Devuelve `null` cuando NO hay hallazgo: sin URL final (un camino de ingesta que no la expone
 * — nunca se INVENTA una que no se tiene), URLs no parseables, o una redirección BENIGNA
 * (esquema, `www.`, barra final, query, subdominio, prefijo de locale, rename del slug dentro
 * del mismo padre). Devuelve el `RedirectMismatch` cuando cambió el HOST, cuando el destino es
 * la HOME desnuda, o cuando la RAMA del path diverge (la categoría). El criterio y su porqué —
 * incluido por qué el discriminador es el PADRE y no el último segmento— en el bloque de arriba.
 */
export function detectRedirectMismatch(
  requestedUrl: string,
  finalUrl: string | null | undefined,
): RedirectMismatch | null {
  if (finalUrl == null || finalUrl.trim() === '') return null;

  let requested: URL;
  let final: URL;
  try {
    requested = new URL(requestedUrl.trim());
    final = new URL(finalUrl.trim());
  } catch {
    // Una URL que no parsea no es un hallazgo: el comparador NUNCA es el punto que rompe la
    // ingesta (mismo criterio que `classifyUrl`/`normalizeUrl`, HEADLINE 1 de T1.3).
    return null;
  }

  const mismatch = (reason: RedirectMismatchReason): RedirectMismatch => ({
    requested: normalizeUrl(requestedUrl),
    final: normalizeUrl(finalUrl),
    reason,
  });

  // 1) Cambio de HOST: otro sitio.
  if (!sameSite(requested.hostname, final.hostname)) return mismatch('host_changed');

  // 2) La RAMA del path diverge: el directorio PADRE de lo pedido no sobrevive al salto.
  const requestedSegments = pathSegments(requested);
  const finalSegments = pathSegments(final);

  // Se pidió la raíz (`/`): no había página concreta que perder — nada que avisar.
  if (requestedSegments.length === 0) return null;

  // La HOME desnuda es el caso particular (y el más grave): reason propio, copy propio.
  if (finalSegments.length === 0) return mismatch('path_to_root');

  // El PADRE (todo menos el último segmento, que es el slug y PUEDE cambiar: rename legítimo).
  // Si el padre pedido no es SUFIJO del padre final, el destino cuelga de otra rama del sitio
  // (`/products/x` → `/collections/y`): otra página, y el usuario tiene que saberlo. El sufijo
  // —y no la igualdad— absorbe los prefijos de locale/geo (`/es/products/x`), que son aditivos.
  const requestedParent = requestedSegments.slice(0, -1);
  const finalParent = finalSegments.slice(0, -1);
  if (!isSuffix(requestedParent, finalParent)) return mismatch('path_diverged');

  return null;
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
