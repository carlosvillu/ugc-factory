// Cliente HTTP de scraping N2 (Firecrawl `/v2/scrape` con fallback Jina Reader) —
// T1.4, PRD §7.2/§9.1, research/07 §1.1-§1.2/§5. Vive en `packages/core/src/ingest`
// como el fast path de T1.3 (backend/architecture.md §1: los clientes HTTP de
// proveedores viven en core — la frontera prohibida es BD/cola, NO la red). Produce
// un `RawContent` completo (source='url'), análogo a `makeFastPathIngester`, pero
// desde el render+scrape de Firecrawl en vez de endpoints deterministas.
//
// La PERSISTENCIA (asset del screenshot, cost_entry de los créditos, createUrlAnalysis)
// NO vive aquí: es de la capa servicio/db (ver `firecrawl-service.ts` en apps/web). Este
// módulo solo hace RED — incluida la descarga de los bytes del screenshot, que devuelve
// APARTE del `raw` para que el caller los persista vía StorageAdapter y estampe el
// `screenshotRef`. Así core no importa nada de I/O de datos.
//
// FALLBACK TRANSPARENTE (research §5, la Verificación con key inválida): Firecrawl
// FALLA (401 key inválida, timeout, 5xx, 429) → Jina Reader (`r.jina.ai`, solo lectura:
// markdown, sin product/branding). El resultado SIEMPRE es un `RawContent` válido — el
// fallback degrada la riqueza, nunca rompe la ingesta. Mismo patrón AbortSignal de T1.3.
import type { RawBranding, RawContent, RawImage, RawProduct } from '../contracts/raw-content';
import { classifyUrl, contentHash, normalizeUrl, type FastPathPlatform } from './url';
import { classifyFetchError, makeFetchWithTimeout } from './http';

/** Base de la API de Firecrawl v2 (research §1.1). Interno: se sobreescribe por dep
 *  `firecrawlBaseUrl` en tests (msw intercepta a nivel de red, pero un base URL
 *  explícito hace el fixture legible). */
const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';

/** Base del reader de Jina (research §1.2): se prefija a la URL cruda. */
const JINA_BASE_URL = 'https://r.jina.ai';

/** Timeout duro por request (ms). Una scrape colgada deja al verifier sin señal
 *  (peor que un fail limpio, nota del brief). Firecrawl con render+proxy es lento:
 *  60s es holgado; el fetch del screenshot y Jina heredan el mismo techo. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Precio de un crédito Firecrawl en CÉNTIMOS (plan Standard: $83 / 100.000 créditos =
 * $0,00083/crédito = 0,083 CÉNTIMOS/crédito, research §1.1 y §6). OJO a la unidad: son
 * céntimos, no dólares — `83 / 1_000` (un crédito son 83 milésimas de céntimo), NO
 * `83 / 100_000` (eso serían DÓLARES/crédito, 100× por debajo). El caller convierte
 * créditos→céntimos con `Math.round(credits * FIRECRAWL_CENTS_PER_CREDIT)`:
 *  - 1–5 créditos (el caso del verifier) → 0 céntimos: gasto sub-céntimo REAL y honesto
 *    (`amount_cents` es entero por invariante duro, NUNCA float); la verdad vive en
 *    `quantity` (unit='credits'), que la Verificación #4 exige junto a amount_cents/unit.
 *  - ≥7 créditos → ≥1 céntimo (scrapes grandes/stealth acumulados): el importe deja de
 *    ser cero. Con la constante mala (100× menor) harían falta ≥602 créditos.
 */
export const FIRECRAWL_CENTS_PER_CREDIT = 83 / 1_000;

/** Créditos por defecto de una scrape cuando la respuesta NO los reporta. El endpoint
 *  `/v2/scrape` de página única NO devuelve `creditsUsed` (solo el batch lo hace,
 *  confirmado en docs.firecrawl.dev) y con `proxy:auto` la escalada a 5 créditos no es
 *  observable desde la respuesta. Una scrape base cuesta 1 crédito → default 1. Si en
 *  algún momento el endpoint sí reporta `creditsUsed`, se lee ese valor (ver
 *  `mapCredits`). Ver DUDA en el informe de T1.4. */
const DEFAULT_FIRECRAWL_CREDITS = 1;

/** Formatos pedidos a `/v2/scrape` para el scrape RICO del landing (research §5, Entrega de
 *  T1.4). El `screenshot` como objeto `{type, fullPage}` para capturar la página completa
 *  (§5). NO incluye `links`: el descubrimiento de páginas internas usa una scrape aparte
 *  full-page (`FIRECRAWL_DISCOVERY_FORMATS` + `onlyMainContent:false`), porque con
 *  `onlyMainContent:true` —imprescindible aquí para que el markdown quede limpio— Firecrawl
 *  strippea el nav/footer donde viven los links a /reviews·/faq·/about (T1.5, fix del verify).
 */
const FIRECRAWL_FORMATS = [
  'markdown',
  'images',
  'branding',
  'product',
  { type: 'screenshot', fullPage: true },
] as const;

/** Formatos de la scrape de DESCUBRIMIENTO de links del landing (T1.5): SOLO `links`. Va con
 *  `onlyMainContent:false` para ver el nav/footer (donde están los enlaces a las páginas
 *  internas). Es un scrape ligero y barato (+1 crédito sub-céntimo); su markdown/branding NO
 *  se usan — solo se leen los `links` (array<string> en v2) para alimentar el descubrimiento. */
const FIRECRAWL_DISCOVERY_FORMATS = ['links'] as const;

/** Formatos de la scrape LIGERA de una página interna (T1.5): SOLO markdown. Nada de
 *  screenshot/branding/product/links — "ligero" acota el coste y evita recursión (no se
 *  descubren nuevos links desde una página interna). `onlyMainContent:true` (default): del
 *  /reviews queremos el TEXTO de las reseñas, no su nav. */
const FIRECRAWL_INTERNAL_FORMATS = ['markdown'] as const;

/** Tope DURO de páginas internas a rastrear (Entrega T1.5: "hasta 3 URLs same-domain").
 *  Cap de 3 por diseño; un crawl que diverge/loopea es EL modo de fallo de esta tarea. */
const MAX_INTERNAL_PAGES = 3;

/** Segmentos de path que marcan una página interna de interés (research §3.5: reviews son
 *  la mejor fuente de objeciones/pains; faq/about aportan contexto). La keyword debe TERMINAR
 *  el segmento (trailing `/` o fin de string): así casan las convenciones REALES de página
 *  (`/reviews`, `/product-reviews`, `/pages/reviews`, `/es/reviews`, `/faq`, `/about`) pero
 *  NO los slugs de producto con basura detrás (`/reviews-are-fake-serum`, `/about-our-coffee`,
 *  `/faq-lite-serum`) — over-matching esos DESPLAZARÍA la página real bajo el cap duro de 3
 *  (FIX 1). El boundary de INICIO sí es permisivo (`/` o `-`) para tolerar prefijos CMS
 *  (`/product-reviews`). Trade-off aceptado: `about-<x>` (p.ej. `/about-us`) deja de casar —
 *  es contexto secundario, no la observable testeada. Por eso `about-us`/`sobre-nosotros` se
 *  eliminan (eran alternativas muertas: su cabeza `about`/`nosotros` ya casa al final de
 *  segmento); `quienes-somos`/`preguntas-frecuentes` se mantienen (no son alternativas de una
 *  sola palabra). */
const INTERNAL_PATH_PATTERN =
  /(^|\/|-)(reviews?|opiniones|rese[nñ]as?|valoraciones|faqs?|preguntas-frecuentes|about|quienes-somos|nosotros)(\/|$)/i;

/** Bytes del screenshot descargados por el ingester, listos para que el caller los
 *  persista vía StorageAdapter (`put`) y cree la fila `asset`. */
export interface ScreenshotBytes {
  data: Uint8Array;
  mime: string;
}

/**
 * Salida del ingester N2. `raw` NO lleva `screenshotRef` estampado (lo pone el caller
 * tras persistir el asset). `screenshot` son los bytes ya descargados (o `null` si no
 * hubo). `credits` alimenta el `cost_entry`. `provider` indica qué camino se usó
 * ('firecrawl' feliz, 'jina' fallback) — observable para logs/tests. Los derivados
 * (`urlNormalized`, `contentHash`) espejan `FastPathResult` de T1.3.
 */
export interface FirecrawlIngestResult {
  raw: RawContent;
  screenshot: ScreenshotBytes | null;
  credits: number;
  provider: 'firecrawl' | 'jina';
  platform: FastPathPlatform;
  urlNormalized: string;
  contentHash: string;
  warnings: string[];
  /** URLs internas efectivamente descubiertas Y anexadas al markdown por el mini-crawl
   *  (T1.5). Vacío si el paso terminó `skipped` (el landing no enlazaba candidatas) o si
   *  se usó el fallback Jina (sin links). Observable para logs/tests; NO va al RawContent. */
  internalPages: string[];
}

/** Deps del ingester N2. `apiKey`/`jinaApiKey` los inyecta el composition root
 *  descifrándolos del módulo de secretos (T0.14) — core NUNCA lee env/BD. `fetch` con
 *  default global (msw intercepta en tests, mismo patrón perezoso que T1.3). */
export interface FirecrawlDeps {
  apiKey: string;
  jinaApiKey?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  firecrawlBaseUrl?: string;
  jinaBaseUrl?: string;
}

// ── Shape (parcial) de la respuesta de Firecrawl (docs.firecrawl.dev) ───────────
// Solo se tipa lo que se consume; todo opcional/desconocido porque es red externa.
// Un color de la paleta: la forma REAL (docs.firecrawl.dev, BrandingProfile) es un hex
// STRING por rol (`primary: "#FF6B35"`); se admite además un sub-objeto `{hex}` por
// defensa (algún build antiguo lo emitía) y el `undefined` de índices ausentes.
type FirecrawlColorValue = string | { hex?: string } | undefined;
type FirecrawlColorsObject = Record<string, FirecrawlColorValue>;
// `typography.fontFamilies` de la forma REAL: `{primary, heading, code}` (strings).
interface FirecrawlTypography {
  fontFamilies?: Record<string, string | undefined>;
}
interface FirecrawlBranding {
  // `colors` de la forma REAL es un OBJETO de roles con valores hex string
  // (`{primary:"#FF6B35", secondary:"#004E89", …}`, docs); un ejemplo legado de las
  // docs lo muestra como array de hex — se admiten AMBAS formas.
  colors?: (string | { hex?: string })[] | FirecrawlColorsObject;
  // Las fuentes viven en `typography.fontFamilies` (forma REAL). `fonts` (array de
  // strings) es una forma legada que se admite como fallback.
  typography?: FirecrawlTypography;
  fonts?: string[];
}
interface FirecrawlVariantPrice {
  amount?: number | string;
  currency?: string;
  formatted?: string;
}
interface FirecrawlVariantAvailability {
  inStock?: boolean;
  text?: string;
}
interface FirecrawlVariant {
  title?: string;
  price?: FirecrawlVariantPrice;
  availability?: FirecrawlVariantAvailability;
}
interface FirecrawlProduct {
  title?: string;
  variants?: FirecrawlVariant[];
}
interface FirecrawlImage {
  url?: string;
  alt?: string | null;
}
interface FirecrawlData {
  markdown?: string;
  images?: (string | FirecrawlImage)[];
  branding?: FirecrawlBranding;
  product?: FirecrawlProduct;
  screenshot?: string;
  // `links` (format T1.5): la respuesta v2 lo devuelve como array<string> de hrefs
  // absolutos. Se admite `null`/ausente (el format solo aparece si se pidió).
  links?: string[] | null;
  metadata?: { creditsUsed?: number };
}
interface FirecrawlResponse {
  success?: boolean;
  data?: FirecrawlData;
}

// ── Mapeo respuesta → contrato RawContent (NO se toca el contrato de T1.1) ───────

/** Extrae el hex de un valor de color (string directo o sub-objeto `{hex}`). `null`
 *  si no hay un hex usable. */
function colorHex(value: FirecrawlColorValue): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (value && typeof value.hex === 'string' && value.hex.length > 0) return value.hex;
  return null;
}

/** Normaliza `branding.colors` (objeto de roles con valores hex string —la forma REAL—
 *  o array de hex —legado—) → `palette: string[]`. `undefined` si no hay ningún color. */
function mapPalette(colors: FirecrawlBranding['colors']): string[] | undefined {
  if (!colors) return undefined;
  const values: FirecrawlColorValue[] = Array.isArray(colors) ? colors : Object.values(colors);
  const palette = values.map(colorHex).filter((hex): hex is string => hex !== null);
  return palette.length > 0 ? palette : undefined;
}

/** Deriva `typography: string` del `branding` de Firecrawl (el contrato T1.1 quiere un
 *  string simple). La forma REAL trae las fuentes en `typography.fontFamilies`
 *  (`{primary, heading, code}`); el array `fonts` legado es el fallback. Se unen las
 *  familias distintas por coma. `null` si no hay ninguna fuente. */
function mapTypography(branding: FirecrawlBranding): string | null {
  const families = branding.typography?.fontFamilies
    ? Object.values(branding.typography.fontFamilies)
    : [];
  const legacy = branding.fonts ?? [];
  const fonts = [...families, ...legacy].filter(
    (f): f is string => typeof f === 'string' && f.length > 0,
  );
  // De-duplica preservando el orden (primary/heading suelen repetir la misma familia).
  const unique = [...new Set(fonts)];
  return unique.length > 0 ? unique.join(', ') : null;
}

function mapBranding(branding: FirecrawlBranding | undefined): RawBranding | undefined {
  if (!branding) return undefined;
  const palette = mapPalette(branding.colors);
  const typography = mapTypography(branding);
  if (!palette && typography === null) return undefined;
  return { palette, typography };
}

/** El `product` de Firecrawl NO tiene price/currency/availability de nivel superior:
 *  viven por variante. Se derivan de la PRIMERA variante (representativa) y
 *  `variants: string[]` de los títulos de variante. */
function mapProduct(product: FirecrawlProduct | undefined): RawProduct | undefined {
  if (!product) return undefined;
  const variants = product.variants ?? [];
  const first = variants[0];
  const variantTitles = variants
    .map((v) => v.title)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  const price = first?.price?.amount;
  const mapped: RawProduct = {
    title: product.title ?? null,
    // El precio se guarda como string (contrato T1.1): normaliza number→string. El `==`
    // suelto cubre `undefined` Y `null`: sin él, un variant con `amount: null` guardaría
    // el string literal "null" como precio (los fixtures no lo pillan; una scrape real sí).
    price: price == null ? null : String(price),
    currency: first?.price?.currency ?? null,
    availability: first?.availability?.text ?? null,
    variants: variantTitles.length > 0 ? variantTitles : undefined,
  };
  // Si TODO está vacío, no aportamos un product hueco.
  const hasSignal =
    mapped.title !== null ||
    mapped.price !== null ||
    mapped.currency !== null ||
    mapped.availability !== null ||
    (mapped.variants !== undefined && mapped.variants.length > 0);
  return hasSignal ? mapped : undefined;
}

/** Normaliza `data.images` (strings o `{url,alt}`) → `RawImage[]`, descartando las
 *  entradas sin URL usable. */
function mapImages(images: FirecrawlData['images']): RawImage[] {
  if (!images) return [];
  const out: RawImage[] = [];
  for (const img of images) {
    if (typeof img === 'string') {
      if (img.length > 0) out.push({ url: img, alt: null });
    } else if (typeof img.url === 'string' && img.url.length > 0) {
      out.push({ url: img.url, alt: img.alt ?? null });
    }
  }
  return out;
}

/** Lee los créditos de la respuesta con defensa: `metadata.creditsUsed` si el endpoint
 *  lo reporta algún día; si no (caso actual de la scrape de página única), el default. */
function mapCredits(data: FirecrawlData | undefined): number {
  const reported = data?.metadata?.creditsUsed;
  return typeof reported === 'number' && reported > 0 ? reported : DEFAULT_FIRECRAWL_CREDITS;
}

// ── Mini-crawl de páginas internas (T1.5, research §3.5) ─────────────────────────

/** Dominio registrable APROXIMADO (últimas dos etiquetas del host): `shop.glow.example`
 *  y `glow.example` colapsan a `glow.example`. Heurística deliberada (last-two-labels), NO
 *  una public-suffix-list: el filtro de path hace el grueso del trabajo; esto solo descarta
 *  links claramente off-site (CDN, redes sociales). Suficiente para el alcance de T1.5. */
function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  return labels.slice(-2).join('.');
}

/**
 * Descubre hasta `MAX_INTERNAL_PAGES` URLs internas de interés (reviews/faq/about) a partir
 * de los LINKS que el landing enlaza (research §3.5 — NO se adivinan/probean paths). Función
 * PURA y determinista (sin red): filtra por (1) URL válida http(s), (2) MISMO dominio
 * registrable que el landing, (3) match del patrón de path de interés, (4) dedupe por URL
 * normalizada excluyendo el propio landing, y corta en el cap. Preserva el orden de aparición
 * en el landing (determinismo del cache key aguas abajo).
 */
export function discoverInternalUrls(landingUrl: string, links: readonly string[]): string[] {
  let landing: URL;
  try {
    landing = new URL(landingUrl);
  } catch {
    return [];
  }
  const landingDomain = registrableDomain(landing.hostname);

  const out: string[] = [];
  // Dedupe por (host + pathname), IGNORANDO el query (FIX 2): `/faq` y `/faq?ref=nav` son
  // la MISMA página — los links de nav suelen llevar params de tracking. Deduplicar por URL
  // completa (normalizeUrl ordena el query pero NO lo quita) dejaría pasar el duplicado, que
  // con el cap duro de 3 EXPULSARÍA una interna genuinamente distinta y facturaría un scrape
  // repetido. El host se incluye en la clave para no colapsar mismo path de subdominios
  // distintos del mismo dominio registrable. El propio landing se siembra excluido.
  const dedupeKey = (u: URL) => {
    // Normaliza la barra final (`/reviews/` ≡ `/reviews`); la raíz `/` se preserva.
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return `${u.host}${path}`;
  };
  const seen = new Set<string>([dedupeKey(landing)]);

  for (const href of links) {
    if (out.length >= MAX_INTERNAL_PAGES) break;
    if (typeof href !== 'string' || href.length === 0) continue;
    let url: URL;
    try {
      // Resuelve relativos contra el landing (Firecrawl v2 suele dar absolutos, pero
      // resolver es gratis y robusto ante relativos).
      url = new URL(href, landing);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    // (2) same registrable domain — descarta off-site (CDN, social, afiliados).
    if (registrableDomain(url.hostname) !== landingDomain) continue;
    // (3) el path debe casar el patrón de interés (reviews|faq|about + variantes idioma/CMS).
    if (!INTERNAL_PATH_PATTERN.test(url.pathname)) continue;
    // (4) dedupe por host+pathname (ignora query), excluyendo el propio landing.
    const key = dedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url.href);
  }
  return out;
}

export function makeFirecrawlIngester(deps: FirecrawlDeps) {
  // Resuelto EN CADA llamada (no en construcción): msw reemplaza `globalThis.fetch`
  // DESPUÉS de construir el ingester en los tests; un default perezoso deja que el
  // interceptor actúe (mismo razonamiento que T1.3). Helper compartido con fast-path.
  const fetchWithTimeout = makeFetchWithTimeout(deps, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const firecrawlBaseUrl = deps.firecrawlBaseUrl ?? FIRECRAWL_BASE_URL;
  const jinaBaseUrl = deps.jinaBaseUrl ?? JINA_BASE_URL;

  /**
   * Descarga los bytes del screenshot. Firecrawl lo entrega como URL http(s) (EXPIRA
   * ~24h → hay que bajarlo YA) o como data-URI base64. Ambos casos se materializan a
   * bytes para que el caller los persista. `null` si no hay screenshot o si la descarga
   * falla (el screenshot es opcional: su ausencia NUNCA rompe la ingesta).
   */
  async function downloadScreenshot(
    screenshot: string | undefined,
    warnings: string[],
  ): Promise<ScreenshotBytes | null> {
    if (!screenshot) return null;
    // data-URI: `data:image/png;base64,<...>` — se decodifica en el sitio, sin red.
    const dataUri = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(screenshot);
    if (dataUri) {
      // El grupo 1 (`[^;,]+`) exige ≥1 char cuando el regex casa; el `??` solo cubre el
      // `undefined` de noUncheckedIndexedAccess (nunca un string vacío real).
      const mime = dataUri[1] ?? 'image/png';
      const isBase64 = dataUri[2] === ';base64';
      const payload = dataUri[3] ?? '';
      const data = isBase64
        ? new Uint8Array(Buffer.from(payload, 'base64'))
        : new TextEncoder().encode(decodeURIComponent(payload));
      return { data, mime };
    }
    // URL: descarga los bytes (con timeout duro). Un fallo aquí es un warning, no un
    // error: el screenshot es un extra.
    try {
      const res = await fetchWithTimeout(screenshot, { headers: { accept: 'image/*' } });
      if (!res.ok) {
        warnings.push(`screenshot_fetch_status_${String(res.status)}`);
        return null;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
      return { data: buf, mime };
    } catch {
      warnings.push('screenshot_fetch_failed');
      return null;
    }
  }

  /**
   * Intenta la scrape de Firecrawl. Devuelve la data cruda si HTTP 200 + success, o
   * `null` en CUALQUIER fallo (401 key inválida — la Verificación, timeout, 5xx, 429,
   * cuerpo no-JSON) para disparar el fallback a Jina. Nunca lanza: el fallo de Firecrawl
   * es una rama esperada.
   */
  async function tryFirecrawl(
    rawUrl: string,
    warnings: string[],
    formats: readonly unknown[] = FIRECRAWL_FORMATS,
    onlyMainContent = true,
  ): Promise<FirecrawlData | null> {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${firecrawlBaseUrl}/scrape`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${deps.apiKey}`,
        },
        body: JSON.stringify({
          url: rawUrl,
          formats,
          // `onlyMainContent` strippea nav/footer. El scrape RICO del landing y las scrapes
          // internas lo quieren `true` (markdown limpio, sin boilerplate — T1.4). PERO el
          // descubrimiento de links del landing lo necesita `false`: los links a
          // /reviews·/faq·/about viven en el nav/footer, que `true` elimina (por eso el
          // mini-crawl skipeaba SIEMPRE en tiendas reales). Ver `fetchDiscoveryLinks`.
          onlyMainContent,
          proxy: 'auto',
        }),
      });
    } catch (err) {
      const reason = classifyFetchError(err);
      warnings.push(`firecrawl_failed_${reason}`);
      return null;
    }
    if (!res.ok) {
      // 401 (key inválida, ES la Verificación), 429, 5xx → fallback a Jina.
      warnings.push(`firecrawl_status_${String(res.status)}`);
      return null;
    }
    let body: FirecrawlResponse;
    try {
      body = (await res.json()) as FirecrawlResponse;
    } catch {
      warnings.push('firecrawl_body_not_json');
      return null;
    }
    if (body.success === false || !body.data) {
      warnings.push('firecrawl_unsuccessful');
      return null;
    }
    return body.data;
  }

  /**
   * Fallback Jina Reader (`r.jina.ai/<URL>`, research §1.2): SOLO markdown (lectura
   * pura, sin product/branding). Devuelve el markdown o `null` si también falla (en
   * cuyo caso el RawContent queda con markdown vacío pero SIGUE siendo válido).
   */
  async function tryJina(rawUrl: string, warnings: string[]): Promise<string | null> {
    // Sin cabecera de formato: `r.jina.ai` DEVUELVE MARKDOWN POR DEFECTO (jina.ai/reader).
    // `x-respond-with: markdown` NO es un header válido de Jina (los válidos son
    // `x-respond-with: readerlm-v2` o `Accept: application/json`); pedirlo no aporta y el
    // markdown ya es el default. La respuesta trae un preámbulo `Title:/URL Source:/
    // Markdown Content:` antes del cuerpo — el caller NO lo recorta (el brief exige
    // "AL MENOS el markdown"; el preámbulo es contexto legítimo, no ruido que rompa nada).
    const headers: Record<string, string> = {};
    // Con API key sube el rate limit; sin ella hay tier gratis (research §1.2).
    if (deps.jinaApiKey) headers.authorization = `Bearer ${deps.jinaApiKey}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(`${jinaBaseUrl}/${rawUrl}`, { headers });
    } catch (err) {
      const reason = classifyFetchError(err);
      warnings.push(`jina_failed_${reason}`);
      return null;
    }
    if (!res.ok) {
      warnings.push(`jina_status_${String(res.status)}`);
      return null;
    }
    try {
      return await res.text();
    } catch {
      warnings.push('jina_body_read_failed');
      return null;
    }
  }

  /**
   * Mini-crawl de páginas internas (T1.5, research §3.5). Sobre los `links` del landing
   * descubre ≤3 URLs same-domain de interés (reviews/faq/about), las scrapea LIGERAS
   * (markdown-only, fallback Jina, SIN recursión) y ANEXA su markdown al del landing con un
   * heading `## <path>` por página (§9.1: se enriquece `RawContent.markdown`, NO se crea
   * campo nuevo). Degradación transparente (filosofía T1.4): una interna que falla al scrape
   * es un WARNING, no un error, y el resto se anexa igual. Devuelve el markdown enriquecido,
   * los créditos internos ACUMULADOS y las páginas efectivamente anexadas (observabilidad).
   *
   * `skipped` = NADA descubierto → markdown SIN cambios, warning 'internal_crawl_skipped',
   * cero créditos, cero error (2ª observable de la Verificación).
   */
  /**
   * Scrape de DESCUBRIMIENTO: pide SOLO `links` con `onlyMainContent:false` para que el
   * nav/footer (donde viven los enlaces a /reviews·/faq·/about) entren en la respuesta. Es
   * una llamada APARTE del scrape rico del landing (que sigue `onlyMainContent:true` para un
   * markdown limpio — no se contamina con boilerplate, invariante de T1.4). Devuelve los
   * links (array<string>) o `null` si la scrape falla → el caller degrada a `skipped` (NO
   * lanza), consistente con la 2ª observable. Cuenta como crédito facturable (sub-céntimo).
   */
  async function fetchDiscoveryLinks(
    landingUrl: string,
    warnings: string[],
  ): Promise<{ links: string[]; credits: number } | null> {
    const data = await tryFirecrawl(
      landingUrl,
      warnings,
      FIRECRAWL_DISCOVERY_FORMATS,
      false, // onlyMainContent:false → ve el nav/footer con los links internos.
    );
    if (!data) {
      warnings.push('internal_links_scrape_failed');
      return null;
    }
    return { links: data.links ?? [], credits: mapCredits(data) };
  }

  async function miniCrawl(
    landingUrl: string,
    landingMarkdown: string,
    warnings: string[],
  ): Promise<{ markdown: string; credits: number; pages: string[] }> {
    // Descubrimiento: scrape full-page de solo-links (aparte del scrape rico del landing).
    const discovery = await fetchDiscoveryLinks(landingUrl, warnings);
    if (discovery === null) {
      // La scrape de links falló → skipped SIN error (2ª observable), markdown intacto.
      warnings.push('internal_crawl_skipped');
      return { markdown: landingMarkdown, credits: 0, pages: [] };
    }

    const candidates = discoverInternalUrls(landingUrl, discovery.links);
    if (candidates.length === 0) {
      warnings.push('internal_crawl_skipped');
      // El scrape de descubrimiento SÍ facturó (aunque no descubriera nada útil).
      return { markdown: landingMarkdown, credits: discovery.credits, pages: [] };
    }

    let markdown = landingMarkdown;
    // El crédito del scrape de descubrimiento cuenta desde el inicio del acumulado.
    let credits = discovery.credits;
    const pages: string[] = [];

    for (const candidate of candidates) {
      // Scrape LIGERA: markdown-only. Firecrawl falla → Jina (mismo fallback del landing).
      const data = await tryFirecrawl(candidate, warnings, FIRECRAWL_INTERNAL_FORMATS);
      let pageMarkdown: string | null;
      if (data) {
        credits += mapCredits(data);
        pageMarkdown = data.markdown ?? '';
      } else {
        pageMarkdown = await tryJina(candidate, warnings);
      }
      const path = new URL(candidate).pathname;
      // Una interna sin markdown útil (ambos caminos vacíos) → warning, NO se anexa hueca.
      if (pageMarkdown === null || pageMarkdown.trim().length === 0) {
        warnings.push(`internal_page_empty_${path}`);
        continue;
      }
      markdown += `\n\n## ${path}\n\n${pageMarkdown}`;
      pages.push(candidate);
    }

    return { markdown, credits, pages };
  }

  /**
   * Ejecuta la ingesta N2 sobre una URL. Firecrawl feliz → RawContent rico + screenshot
   * + créditos; Firecrawl falla → Jina (markdown). SIEMPRE devuelve un `FirecrawlIngestResult`
   * con un RawContent válido. NUNCA lanza por una fuente ausente.
   */
  async function ingest(rawUrl: string): Promise<FirecrawlIngestResult> {
    const platform = classifyUrl(rawUrl);
    const warnings: string[] = [];

    const data = await tryFirecrawl(rawUrl, warnings);

    let raw: RawContent;
    let screenshot: ScreenshotBytes | null = null;
    let credits: number;
    let provider: 'firecrawl' | 'jina';
    let internalPages: string[] = [];
    // Markdown PROPIO del landing (sin las páginas internas anexadas). Es lo que alimenta el
    // `content_hash` (FIX 3): la identidad del análisis es el LANDING, no el enriquecimiento
    // best-effort. Si el hash cubriera el markdown ya anexado, un fallo TRANSITORIO de una
    // interna (5xx una vez, ok la siguiente) daría dos hashes distintos para el MISMO landing.
    let landingMarkdown: string;

    if (data) {
      provider = 'firecrawl';
      credits = mapCredits(data);
      screenshot = await downloadScreenshot(data.screenshot, warnings);
      landingMarkdown = data.markdown ?? '';
      // Mini-crawl de páginas internas (T1.5): solo en el camino Firecrawl (Jina no
      // devuelve links). Enriquece el markdown del landing (RawContent.markdown lleva el
      // enriquecido, que consume el sintetizador T1.8); el HASH usa el markdown propio del
      // landing, ver más abajo. Los créditos internos se ACUMULAN al total (el servicio
      // registra un único cost_entry agregado).
      const crawl = await miniCrawl(rawUrl, landingMarkdown, warnings);
      credits += crawl.credits;
      internalPages = crawl.pages;
      raw = {
        source: 'url',
        url: rawUrl,
        platform,
        markdown: crawl.markdown,
        images: mapImages(data.images),
        branding: mapBranding(data.branding),
        product: mapProduct(data.product),
        // El caller estampa `screenshotRef` tras persistir el asset. Aquí null.
        screenshotRef: null,
      };
    } else {
      // FALLBACK: Firecrawl falló → Jina (solo markdown). Sin créditos de Firecrawl.
      provider = 'jina';
      credits = 0;
      const markdown = await tryJina(rawUrl, warnings);
      landingMarkdown = markdown ?? '';
      raw = {
        source: 'url',
        url: rawUrl,
        platform,
        markdown: landingMarkdown,
        images: [],
        branding: undefined,
        product: undefined,
        screenshotRef: null,
      };
    }

    // El cache key (§12) es `url_normalizada + content_hash`: el hash cubre SOLO el
    // contenido, excluyendo el `url` crudo (dos variantes de la misma URL con el mismo
    // contenido → mismo hash) Y el `screenshotRef` volátil (una storage_key ULID nueva
    // por scrape rompería el dedupe). Además usa el markdown PROPIO del landing, NO el
    // enriquecido con páginas internas (FIX 3): el hash debe ser determinista respecto al
    // landing — un fallo transitorio de una interna no debe cambiar la identidad del análisis.
    const { url: _omitUrl, screenshotRef: _omitRef, ...rest } = raw;
    const content = { ...rest, markdown: landingMarkdown };

    return {
      raw,
      screenshot,
      credits,
      provider,
      platform,
      urlNormalized: normalizeUrl(rawUrl),
      contentHash: contentHash(content),
      warnings,
      internalPages,
    };
  }

  return { ingest };
}

export type FirecrawlIngester = ReturnType<typeof makeFirecrawlIngester>;
