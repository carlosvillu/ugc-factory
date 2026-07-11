// Cliente HTTP fino del fast path (N1, PRD §7.2/§9.1). El ÚNICO efecto del módulo
// `ingest` en T1.3: orquesta classify → probe Shopify `.json` → fetch HTML → parsers
// → merge. Vive en `packages/core` (backend/architecture.md §1: los clientes HTTP de
// proveedores viven en core — la frontera prohibida es BD/cola, no la red; §3 ubica
// `ingest/` como su módulo). `fetch` es inyectable con default global: msw lo
// intercepta a nivel de red en tests, así que NO hace falta un puerto abstracto (YAGNI).
//
// FALLBACK TRANSPARENTE (HEADLINE 1) — el discriminador de la Verificación:
//  - Un 404/401/no-200 del `{url}.json` de Shopify NO es un error: es una rama
//    ESPERADA. Se degrada SILENCIOSAMENTE al parser JSON-LD/OG del HTML.
//  - Cada fuente ausente (sin `.json`, sin JSON-LD, sin OG) es un downgrade
//    silencioso; el merge devuelve lo que haya. NUNCA se lanza por fuente ausente.
//  - SOLO un fallo de infra REAL al traer el HTML (red caída, DNS, 5xx, timeout)
//    puede aflorar — y aun así lo registramos como `warning` en el RawContent, sin
//    tumbar la ingesta cuando ya hay algo del `.json`. "sin fila rota" = siempre se
//    puede construir un RawContent válido.
import type { RawContent } from '../contracts/raw-content';
import { classifyUrl, contentHash, normalizeUrl, type FastPathPlatform } from './url';
import { makeFetchWithTimeout } from './http';
import { mergeRawContent } from './merge';
import { parseJsonLd } from './parsers/json-ld';
import { parseOpenGraph } from './parsers/opengraph';
import { parseShopifyJson } from './parsers/shopify';
import type { RawContentPartial } from './parsers/types';

/** Resultado del fast path: el RawContent + los campos derivados que persiste el
 *  caller (url_analysis). `contentHash` alimenta el cache key `url_normalizada +
 *  content_hash` (§12); la caché en sí NO se implementa aquí (T1.3 guarda de alcance). */
export interface FastPathResult {
  raw: RawContent;
  platform: FastPathPlatform;
  urlNormalized: string;
  contentHash: string;
  warnings: string[];
}

/** Timeout por defecto de cada fetch del fast path (ms). Una URL real que cuelga
 *  NO puede tumbar `ingest()` indefinidamente: sin timeout, el smoke del verifier se
 *  queda sin señal. 10s es holgado para un `.json`/HTML público. Interno: se ajusta
 *  por dep `timeoutMs`, no se exporta (sin consumidor externo). */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/** Deps del ingester. `fetch` con default global para producción; los tests lo
 *  dejan pasar y msw intercepta a nivel de red. `timeoutMs` acota cada request. */
export interface FastPathDeps {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** Construye la URL del endpoint público Shopify `{url}.json` a partir de la URL de
 *  producto: inserta `.json` antes del query/fragment. `/products/x` → `/products/x.json`. */
function shopifyJsonUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    // Quita barra final del path antes de añadir `.json`.
    if (url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
    url.pathname = `${url.pathname}.json`;
    return url.toString();
  } catch {
    return null;
  }
}

export function makeFastPathIngester(deps: FastPathDeps = {}) {
  // Fetch con timeout duro (helper compartido con firecrawl.ts): resuelve `fetch` en
  // cada llamada (default perezoso) para que msw intercepte, y aborta a los `timeoutMs`
  // en vez de bloquear `ingest()` para siempre. El abort se propaga como excepción (lo
  // tratan `tryShopifyJson`/`tryFetchHtml` según su política).
  const fetchWithTimeout = makeFetchWithTimeout(deps, deps.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);

  /**
   * Ejecuta el fast path sobre una URL. NUNCA lanza por fuentes ausentes: devuelve
   * siempre un `FastPathResult` con un RawContent válido (posiblemente escaso).
   */
  async function ingest(rawUrl: string): Promise<FastPathResult> {
    const platform = classifyUrl(rawUrl);
    const warnings: string[] = [];
    const partials: RawContentPartial[] = [];

    // 1) Shopify `.json` — SOLO si la URL se clasificó shopify. Un 404/401/no-200 o
    //    un cuerpo no-JSON degradan silenciosamente (fuente ausente, NO error).
    if (platform === 'shopify') {
      const jsonUrl = shopifyJsonUrl(rawUrl);
      if (jsonUrl !== null) {
        const shopifyPartial = await tryShopifyJson(jsonUrl);
        if (shopifyPartial !== null) partials.push(shopifyPartial);
      }
    }

    // 2) HTML → JSON-LD + OpenGraph. Se intenta SIEMPRE (también en shopify: el
    //    `.json` puede haber fallado o traer poco). Un fallo de infra al traer el
    //    HTML se registra como warning; si ya tenemos algo del `.json` seguimos.
    const html = await tryFetchHtml(rawUrl, warnings);
    if (html !== null) {
      const jsonLd = parseJsonLd(html);
      if (jsonLd !== null) partials.push(jsonLd);
      const og = parseOpenGraph(html);
      if (og !== null) partials.push(og);
    }

    const raw = mergeRawContent({ url: rawUrl, platform, partials, warnings });
    // El cache key (§12) es `url_normalizada + content_hash`: la URL ya viaja aparte
    // en `urlNormalized`, así que el hash cubre SOLO el contenido, excluyendo el `url`
    // crudo del RawContent. Si no, dos variantes de la misma URL (barra final, orden
    // de query) del MISMO contenido darían hashes distintos y romperían el dedupe.
    const { url: _omitUrl, ...content } = raw;
    return {
      raw,
      platform,
      urlNormalized: normalizeUrl(rawUrl),
      contentHash: contentHash(content),
      warnings,
    };
  }

  /** Descarga y parsea el `{url}.json`. Devuelve el parcial o `null` en CUALQUIER
   *  condición de "no disponible" (404/401/no-200, red caída, cuerpo no-JSON). Nunca
   *  lanza: la ausencia del `.json` es una rama esperada del fast path. */
  async function tryShopifyJson(jsonUrl: string): Promise<RawContentPartial | null> {
    let res: Response;
    try {
      res = await fetchWithTimeout(jsonUrl, { headers: { accept: 'application/json' } });
    } catch {
      // red caída o TIMEOUT al probar el `.json`: degrada al HTML, sin ruido (el
      // `.json` es una rama opcional; su ausencia nunca cuelga ni ensucia).
      return null;
    }
    if (!res.ok) return null; // 404/401/410/5xx: la tienda capa el endpoint → fallback.
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return null; // no era JSON (una página de error HTML): fallback.
    }
    return parseShopifyJson(json);
  }

  /** Descarga el HTML de la URL. Un fallo REAL de infra (red/DNS/no-200) se anota
   *  como warning y devuelve `null` — el merge seguirá con lo que tenga del `.json`.
   *  No lanza. */
  async function tryFetchHtml(rawUrl: string, warnings: string[]): Promise<string | null> {
    let res: Response;
    try {
      res = await fetchWithTimeout(rawUrl, { headers: { accept: 'text/html' } });
    } catch (err) {
      // Fallo de infra REAL o TIMEOUT al traer el HTML: warning (no cuelga). Un
      // AbortError de timeout tiene `name === 'TimeoutError'`; lo distinguimos para
      // que el warning sea diagnosticable.
      const reason =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'timeout'
          : err instanceof Error
            ? err.message
            : 'network error';
      warnings.push(`html_fetch_failed: ${reason}`);
      return null;
    }
    if (!res.ok) {
      warnings.push(`html_fetch_status_${String(res.status)}`);
      return null;
    }
    try {
      return await res.text();
    } catch {
      warnings.push('html_body_read_failed');
      return null;
    }
  }

  return { ingest };
}

export type FastPathIngester = ReturnType<typeof makeFastPathIngester>;
