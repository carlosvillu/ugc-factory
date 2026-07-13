// Servicio de análisis visual (T1.7): la superficie INVOCABLE que ejecuta el paso de VISIÓN
// (P3) y persiste su coste. Orquesta core (`makeVisualAnalyzer` — solo red/CPU: la llamada a
// Haiku + el reescalado) + la capa db/storage (leer la key descifrada de secretos T0.14, leer
// el screenshot del StorageAdapter T0.5, registrar el `cost_entry`). Vive en `@ugc/services`
// (T1.10a): cablea, no contiene lógica de negocio — la llamada a Anthropic, el mapeo
// P3→VisualAnalysis y el reescalado viven en core. Lo consume el executor del nodo N2 del
// worker. Espeja `firecrawl-ingest.ts` (T1.4).
//
// Por qué la persistencia está aquí y no en core: leer secretos/BD y el StorageAdapter es I/O
// de datos (la frontera prohibida de core, architecture §1). La key de Anthropic se descifra
// aquí (T0.14) y se pasa en claro al analyzer; el screenshot se lee del StorageAdapter por su
// `screenshotRef` y se pasa como bytes.
//
// COST_ENTRY (Verificación #4, record-first como T1.4): tras la llamada se registra el gasto
// desde `usage`. provider='anthropic', unit='tokens', quantity = input+output tokens,
// amount_cents ENTERO (Haiku: $1/M input, $5/M output). Se registra INCLUSO en refusal/parse_error
// (se pagaron los tokens); NO se registra en 'skipped' (cero llamada, cero coste).
import type { StorageAdapter } from '@ugc/core';
import {
  makeVisualAnalyzer,
  rescaleImage,
  MAX_PRODUCT_IMAGES,
  type ImageBytes,
  type VisualAnalyzerImageInput,
  type VisualAnalyzerUsage,
} from '@ugc/core/analyze';
import type { RawContent, VisualAnalysis } from '@ugc/core/contracts';
import type { DbClient } from '@ugc/db';

import { loadAnthropicKey, recordAnthropicCost } from './anthropic-service';

/** Modelo de visión (T1.7). Su precio ($1/M input, $5/M output) vive en la tabla COMPARTIDA
 *  `anthropic-pricing.ts`, extraída en T1.8 cuando entró un segundo modelo (Sonnet 5 para la
 *  síntesis): un solo sitio donde vive el precio de Anthropic. OJO: una llamada url-mode REAL
 *  (screenshot + hasta 8 imágenes) ≈ 15k tokens ≈ 1,5-2 céntimos — NO es sub-céntimo. El corte
 *  que mantiene el <$0,02 DURO de la Verificación de T1.7 es reescalar las imágenes de PRODUCTO
 *  a ≤768px (≈600 tok c/u vs ≈1600 sin capar). */
const VISION_MODEL = 'claude-haiku-4-5';

/** Techo del lado largo (px) de las imágenes de PRODUCTO enviadas al VLM. 768px es el corte
 *  real de coste: Haiku capa cada imagen a ~1568px SERVER-SIDE (NO es high-res), así que
 *  reescalar a 1080p sería no-op; 768px baja de ~1600 a ~600 tokens/imagen y preserva la
 *  calidad de clasificación (kind/overlay/background) → el ≥7/8 del juicio humano no peligra.
 *  El SCREENSHOT sí va a ≤1080p (paleta + texto de social proof necesitan más resolución). */
const PRODUCT_IMAGE_MAX_EDGE = 768;

/** Timeout duro (ms) del fetch de una imagen CDN. Una descarga colgada no debe bloquear el
 *  paso: se aborta y esa imagen se cae de la lista superviviente. */
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

/** Deps del análisis visual. Todo inyectable para tests (BD real de Testcontainers, storage
 *  sobre tmpdir, fetch mockeado con msw). `fetch`/`baseURL` se pasan AL analyzer de core. */
export interface VisualAnalyzeDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** Clave descifrante de secretos (T0.14) — derivada de la master key en el caller. */
  secretsKey: Buffer;
  /** `fetch` inyectable (msw en tests); default global en producción (lo captura el SDK). */
  fetch?: typeof globalThis.fetch;
  /** Override del base URL de la API de Anthropic (tests legibles con msw). */
  anthropicBaseUrl?: string;
  timeoutMs?: number;
}

export interface VisualAnalyzeInput {
  projectId: string;
  /** El RawContent del análisis (de T1.4 url / T1.6 manual). De él salen el `screenshotRef`
   *  (modo url) y las URLs de imágenes de producto. */
  raw: RawContent;
  /** Subidas del usuario en modo manual (bytes + su ref), si las hay. En modo url va vacío:
   *  las imágenes son URLs CDN dentro de `raw.images`. */
  uploads?: { url: string; data: Uint8Array; mime: string }[];
  /** El step que originó el gasto (T1.10b): atribuye el `cost_entry` a `step_run_id`. OPCIONAL
   *  — el servicio también se invoca fuera de un run (ahí la columna queda NULL, correcto). */
  stepRunId?: string;
}

export interface VisualAnalyzeServiceResult {
  visualAnalysis: VisualAnalysis;
  /** Estado del paso: 'analyzed' | 'skipped' | 'refused' | 'parse_error'. */
  status: string;
  /** Uso de tokens (null si skipped). */
  usage: VisualAnalyzerUsage | null;
  warnings: string[];
}

/** Lee todos los bytes de un ReadableStream del StorageAdapter. */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Extensión SVG en el pathname. Un logo vectorial NO es una imagen de producto: sharp lo
 *  rasterizaría sin quejarse (falso superviviente), así que se excluye por extensión ANTES del
 *  fetch. El query/hash no vive en `URL.pathname`, así que `hero.svg?v=2` también cae. */
const SVG_EXT = /\.svg$/i;

/**
 * Filtra las URLs de `raw.images` (de T1.4, SIN sanear — una landing real mete logos SVG,
 * data-URIs y píxeles de tracking) a las FETCHEABLES como imagen de producto: http(s) absoluta
 * (fuera `data:`/`blob:`) y no-SVG por extensión. NADA MÁS se decide aquí (T1.14): desde el fix
 * de coste de T1.7 TODAS las imágenes se descargan y se re-codifican a PNG con sharp
 * (`rescaleImage`), así que el gate real es «¿fetch OK y decodifica?» — un AVIF o una URL sin
 * extensión (`/_next/image?url=…`, el patrón estándar de Next.js) PASAN y las decide el par
 * fetch+decode, que ya dropea corruptos sin hueco posicional. Filtrar por extensión raster era
 * un vestigio de los bloques `image/url` de la API (que ya no se usan para producto) y descartó
 * imágenes reales (runs de relatio.chat y stayforlong.com, 2026-07-13). Un SVG servido SIN
 * extensión pasa el filtro y lo resuelve el decode (sharp lo rasteriza — comportamiento
 * documentado y asertado en tests; no hacemos content-type sniffing). PURA y determinista
 * (sin red). Preserva el orden (el mapeo posicional depende de él).
 */
export function fetchableProductImageUrls(images: { url: string }[]): string[] {
  const out: string[] = [];
  for (const img of images) {
    let url: URL;
    try {
      url = new URL(img.url);
    } catch {
      continue; // no es una URL absoluta válida (relativa rota, basura, etc.).
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue; // descarta data:/blob:.
    if (SVG_EXT.test(url.pathname)) continue; // descarta SVG explícito (logo vectorial ≠ producto).
    out.push(img.url);
  }
  return out;
}

/** Descarga los bytes de una imagen CDN con timeout duro. `null` si el fetch falla o el status
 *  no es 2xx (esa imagen se cae de la lista superviviente). El `fetch` inyectable es el mismo
 *  que se pasa al analyzer (msw en tests). */
async function fetchImageBytes(
  url: string,
  doFetch: typeof globalThis.fetch,
): Promise<ImageBytes | null> {
  try {
    const res = await doFetch(url, {
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    return { data: buf, mime };
  } catch {
    return null;
  }
}

/**
 * Construye la lista SUPERVIVIENTE de imágenes de producto YA PREPARADAS (bytes reescalados
 * ≤768px) que se pasa al analyzer. Es el fix ACOPLADO coste+desync:
 *  - COSTE: TODAS las imágenes (subidas base64 O CDN url) se reescalan a ≤768px y van base64 —
 *    ninguna como bloque `url` sin capar (Anthropic ya no descarga a tamaño completo).
 *  - DESYNC: si una imagen falla (fetch/decode/rescale) se CAE DE LA LISTA ENTERA (no se
 *    "salta el bloque" dejando un hueco posicional). La lista devuelta es la única fuente de
 *    verdad: bloques del prompt Y map de clasificaciones se construyen sobre ELLA en el
 *    analyzer → sin desplazamiento de índice.
 * En modo manual las imágenes vienen con bytes (subidas); en modo url son URLs CDN de
 * `raw.images` (pre-filtradas a http(s) no-SVG para no fetchear data-URIs/logos vectoriales;
 * el resto lo decide este fetch+decode). Pura respecto a BD/storage (solo red vía `doFetch`).
 *
 * PARA en cuanto tiene `MAX_PRODUCT_IMAGES` supervivientes: el analyzer descarta el resto con
 * un `slice(0, 8)`, así que descargarlas y re-codificarlas era trabajo tirado. No importaba
 * cuando el filtro solo dejaba pasar extensiones raster (la lista salía corta); desde T1.14
 * pasa TODA URL http(s) no-SVG, y una web Next.js emite decenas de `/_next/image?url=…` — sin
 * el corte, 30 fetches + 30 decodificaciones de sharp para quedarse con 8. El tope se importa
 * de core: una sola fuente de verdad (subirlo allí no puede dejar aquí un corte más bajo).
 */
async function prepareProductImages(
  uploads: { url: string; data: Uint8Array; mime: string }[],
  rawImages: { url: string }[],
  doFetch: typeof globalThis.fetch,
): Promise<VisualAnalyzerImageInput[]> {
  // Fuentes de bytes: subidas (modo manual) o URLs CDN pre-filtradas (modo url).
  const sources: { url: string; bytes: ImageBytes | null }[] =
    uploads.length > 0
      ? uploads.map((u) => ({ url: u.url, bytes: { data: u.data, mime: u.mime } }))
      : fetchableProductImageUrls(rawImages).map((url) => ({ url, bytes: null }));

  const prepared: VisualAnalyzerImageInput[] = [];
  for (const src of sources) {
    if (prepared.length >= MAX_PRODUCT_IMAGES) break; // ya hay 8 vivas: lo demás lo tira el analyzer.
    // Modo url: fetch de los bytes CDN. Modo manual: ya vienen.
    const rawBytes = src.bytes ?? (await fetchImageBytes(src.url, doFetch));
    if (rawBytes === null) continue; // fetch falló → fuera de la lista (no hueco).
    try {
      const rescaled = await rescaleImage(rawBytes.data, PRODUCT_IMAGE_MAX_EDGE);
      prepared.push({ url: src.url, bytes: rescaled });
    } catch {
      continue; // decode/rescale falló (bytes corruptos) → fuera de la lista (no hueco).
    }
  }
  return prepared;
}

/**
 * Ejecuta el análisis visual y persiste su coste. Lee la key (secretos T0.14), lee el
 * screenshot del StorageAdapter (modo url), reúne las imágenes de producto, llama a Haiku vía
 * el analyzer de core, y registra el `cost_entry` (salvo skipped). SIEMPRE devuelve un
 * VisualAnalysis válido (el analyzer nunca lanza por refusal/parse fallido).
 */
export async function runVisualAnalyze(
  deps: VisualAnalyzeDeps,
  input: VisualAnalyzeInput,
): Promise<VisualAnalyzeServiceResult> {
  const { db, storage, secretsKey } = deps;
  const apiKey = await loadAnthropicKey(db, secretsKey, 'visual-analyze');

  const analyzer = makeVisualAnalyzer({
    apiKey,
    fetch: deps.fetch,
    baseURL: deps.anthropicBaseUrl,
    timeoutMs: deps.timeoutMs,
  });

  // Screenshot (modo url): se lee del StorageAdapter por su storage_key (`screenshotRef`).
  // El analyzer lo reescala ≤1080p antes de mandarlo (cost-critical).
  let screenshot: { data: Uint8Array; mime: string } | null = null;
  if (input.raw.screenshotRef) {
    const stream = await storage.get(input.raw.screenshotRef);
    const data = await drainStream(stream);
    // El mime del screenshot de Firecrawl es PNG (T1.4). El StorageAdapter no devuelve mime;
    // PNG es correcto para el screenshot full-page (y el analyzer re-codifica a PNG igual).
    screenshot = { data, mime: 'image/png' };
  }

  // Lista SUPERVIVIENTE de imágenes de producto: fetch (CDN) + reescalado ≤768px, dropeando
  // las que fallan (sin hueco posicional → sin desync). TODAS van base64 reescalado (ninguna
  // como bloque url sin capar → corte de coste que mantiene el <$0,02). El fetch usa el mismo
  // `fetch` inyectable que el analyzer (msw en tests). El analyzer acota a 8.
  const uploads = input.uploads ?? [];
  const doFetch: typeof globalThis.fetch = (i, init) => (deps.fetch ?? globalThis.fetch)(i, init);
  const productImages = await prepareProductImages(uploads, input.raw.images, doFetch);

  const result = await analyzer.analyze({ screenshot, productImages });

  // cost_entry (Verificación #4): SOLO si hubo llamada (usage presente). En 'skipped' no hay
  // usage → cero coste, no se registra. En 'refused'/'parse_error' SÍ hay usage → se registra
  // (se pagaron los tokens; record-first, disciplina de T1.4). quantity = total tokens.
  // `recordAnthropicCost` (plomería compartida con T1.8) NUNCA lanza: un modelo sin precio degrada
  // a 0 con warning en vez de tumbar el registro — un throw aquí perdería la fila de un gasto YA
  // realizado.
  const warnings = [...result.warnings];
  if (result.usage) {
    const warning = await recordAnthropicCost(db, {
      model: VISION_MODEL,
      usage: result.usage,
      projectId: input.projectId,
      stepRunId: input.stepRunId,
    });
    if (warning) warnings.push(warning);
  }

  return {
    visualAnalysis: result.visualAnalysis,
    status: result.status,
    usage: result.usage,
    warnings,
  };
}
