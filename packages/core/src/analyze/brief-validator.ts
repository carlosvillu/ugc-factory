// `BriefValidator` (T1.9, PRD §9.2): los checks DETERMINISTAS post-síntesis sobre el
// ProductBrief que devuelve el BriefSynthesizer (T1.8). Sin LLM, sin red, sin I/O: función
// PURA (`validateBrief`) que recibe el brief + el RawContent del fast path y devuelve una
// COPIA CORREGIDA + los warnings tipados. No muta la entrada y no persiste nada: los warnings
// viajan en el retorno (los consume el step de T1.10a y el editor de CP1 de T1.10b).
//
// Perfiles por origen (§9.2):
//   - `url`    : checks completos. Cross-check de precio N1==N3 y hero image OBLIGATORIA.
//   - `manual` : texto libre. Se OMITE el cross-check de precio (no hay fast path con el que
//                cruzar) y la falta de hero image es DECISIÓN DE CP1, no un error.
//
// Cardinalidades (5–10 ángulos, 2–3 hooks, ≤4 segments, ≤5 quotes) Y ENUMS — los otros dos
// checks que §9.2 lista: NO se re-implementan aquí. Su única fuente de verdad es la capa Zod
// del contrato de T1.1 (`ProductBriefSchema`, §13.2: la API de Anthropic ignora los constraints
// de array, y el `safeParse` post-llamada es la red de seguridad real). La entrada de esta
// función es un `ProductBrief` YA parseado: duplicar los `.min()/.max()` o los `z.enum()` aquí
// crearía una segunda fuente de verdad que derivaría en silencio.
import type { ProductBrief } from '../contracts/product-brief';
import type { RawContent } from '../contracts/raw-content';
import { isBlockingWarning } from '../contracts/brief-warning';
import type { BriefValidationProfile, BriefWarning } from '../contracts/brief-warning';

/**
 * Techo de palabras de un hook (§7.2 N3: "hooks ≤12 palabras"). El hook ocupa los 0–3 s del
 * anuncio; a ~2,5 palabras/segundo (la regla de timing de §7.2 N5) 12 palabras ya son ~5 s.
 */
export const MAX_HOOK_WORDS = 12;

export interface ValidateBriefOptions {
  profile: BriefValidationProfile;
  /**
   * El `RawContent` de N1. Aporta el precio del FAST PATH para el cross-check N1==N3 (perfil
   * `url`). Opcional: en perfil `manual` no aplica, y una página sin fast path de precio
   * (`product.price` null/ausente) simplemente NO dispara el check.
   */
  rawContent?: RawContent | null;
}

export interface ValidateBriefResult {
  /**
   * `false` SOLO cuando el brief tiene un problema que el pipeline no puede resolver solo ni
   * delegar en CP1 (hoy: perfil `url` sin hero image usable). Los warnings de corrección
   * (precio, poda), de aviso (hooks) y de decisión de CP1 (`needs_user_decision`) dejan
   * `ok = true`: el brief sigue siendo VÁLIDO y el paso NO falla (§9.2).
   *
   * DERIVADO de `warnings` vía `isBlockingWarning` — no es un canal independiente. Para hacer
   * bloqueante un código nuevo se marca en `BLOCKING_WARNING_CODES` (contrato) y `ok` se entera
   * solo; no hay ningún sitio más que tocar.
   */
  ok: boolean;
  /** Copia CORREGIDA del brief (precio del fast path, `suggested_assets` podadas). */
  brief: ProductBrief;
  warnings: BriefWarning[];
}

/** Cuenta palabras de un hook: tokens separados por espacio en blanco. Determinista. */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Precio como VALOR NUMÉRICO, o `null` si no se puede afirmar cuál es.
 *
 * Los dos lados del cross-check hablan idiomas DISTINTOS y compararlos como strings es un bug:
 *   - N1 (fast path) emite el precio CRUDO tal como lo sirve la tienda: `String(amount)` de
 *     Firecrawl (`"34.9"`) o el string del JSON-LD/Shopify (`"29.99"`, y alguna tienda europea
 *     `"29,99"`). Nunca lleva símbolo de moneda (`ingest/firecrawl.ts` mapProduct,
 *     `ingest/parsers/coerce.ts`).
 *   - N3 (LLM) emite el precio FORMATEADO para humanos: `"34,90 €"`, `"€34.90"`, `"$29.99"`.
 * `"34,90 €" !== "34.9"` es SIEMPRE true: una igualdad de strings dispararía un `price_mismatch`
 * espurio en CADA análisis por URL y sobrescribiría el brief con el número desnudo. Por eso se
 * compara por VALOR.
 *
 * Normalización: se descarta todo lo que no sea dígito, `,`, `.` o `-` (símbolos, códigos ISO,
 * espacios finos) y se resuelve el separador decimal:
 *   - con AMBOS separadores, el ÚLTIMO manda (`1.234,56` → es-ES; `1,234.56` → en-US);
 *   - con solo `,`, es decimal si deja 1–2 dígitos a la derecha (`29,99`), y si no, millares (`1,234`);
 *   - con solo `.`, misma regla simétrica.
 * `null` cuando no queda un número finito: NO se puede afirmar que dos precios discrepen si no
 * se sabe leer uno de ellos (criterio: ante la duda, no se corrige ni se avisa).
 */
export function parsePriceValue(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (cleaned === '') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    // El separador decimal es el ÚLTIMO en aparecer; el otro es de millares.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    normalized = cleaned.split(thousandsSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.';
    const decimals = cleaned.length - cleaned.lastIndexOf(sep) - 1;
    // 1–2 decimales ⇒ separador decimal. Cualquier otra cosa (`1.234`, `1,234567`) ⇒ millares.
    normalized =
      decimals >= 1 && decimals <= 2 ? cleaned.replace(sep, '.') : cleaned.split(sep).join('');
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Formatea el precio del fast path CONSERVANDO la moneda cuando la hay. Degradar `"34,90 €"` a
 * `"34.9"` (el string crudo de Firecrawl) empobrecería el brief que va a CP1 y a los guiones:
 * gana el VALOR del fast path, pero el precio corregido sigue siendo legible. Sin `currency` en
 * el RawContent se devuelve el string crudo (no inventamos una moneda que no se extrajo).
 */
function formatFastPathPrice(rawPrice: string, currency: string | null | undefined): string {
  if (typeof currency !== 'string' || currency.trim() === '') return rawPrice;
  return `${rawPrice} ${currency.trim()}`;
}

/**
 * Ejecuta los checks deterministas de §9.2 sobre un `ProductBrief` ya validado por Zod (T1.1).
 * PURA: no muta `brief` — devuelve una copia con las correcciones aplicadas.
 */
export function validateBrief(
  brief: ProductBrief,
  options: ValidateBriefOptions,
): ValidateBriefResult {
  const { profile, rawContent } = options;
  const warnings: BriefWarning[] = [];

  // ── 1) Cross-check de precio N1 (fast path) vs N3 (síntesis) ────────────────────────────
  // Solo en perfil `url` y solo si el fast path REALMENTE extrajo un precio: sin precio de N1
  // no hay nada que cruzar (una página sin JSON-LD/`.json` es normal, no un hallazgo). Cuando
  // discrepan, GANA EL FAST PATH: es un dato extraído de forma determinista; el del LLM puede
  // ser una alucinación o el precio de otra variante.
  //
  // La comparación es por VALOR NUMÉRICO, no por igualdad de strings (ver `parsePriceValue`):
  // N1 emite el precio crudo (`"34.9"`) y N3 el formateado (`"34,90 €"`) — el MISMO precio en
  // dos idiomas. Compararlos como strings dispararía un mismatch espurio en cada análisis.
  const fastPathPrice = profile === 'url' ? (rawContent?.product?.price ?? null) : null;
  const fastPathCurrency = profile === 'url' ? (rawContent?.product?.currency ?? null) : null;
  const fastPathValue = parsePriceValue(fastPathPrice);

  let pricing = brief.pricing;
  if (fastPathPrice !== null && fastPathValue !== null) {
    const synthesizedValue = parsePriceValue(brief.pricing.price);
    const corrected = formatFastPathPrice(fastPathPrice, fastPathCurrency);

    if (brief.pricing.price === null) {
      // El fast path tiene DATO DURO y el LLM no encontró ninguno: el dato extraído ENTRA. Es el
      // mismo principio ("gana el fast path") aplicado al caso degenerado; dejar `price: null`
      // con un JSON-LD válido delante sería tirar el único dato fiable que tenemos. No es una
      // discrepancia (no hay dos valores que discrepen): se rellena SIN warning de mismatch.
      pricing = {
        ...brief.pricing,
        price: corrected,
        currency: brief.pricing.currency ?? fastPathCurrency,
      };
    } else if (synthesizedValue === null) {
      // El LLM devolvió algo que no sabemos leer como número ("consultar precio", "desde 30€/mes").
      // NO podemos AFIRMAR que discrepen — y corregir a ciegas sería peor: se deja el brief como
      // está. Sin warning: la ausencia de un número parseable no es un hallazgo del cross-check.
    } else if (synthesizedValue !== fastPathValue) {
      // Discrepancia REAL (valores distintos, no formatos distintos).
      warnings.push({
        code: 'price_mismatch',
        synthesized: brief.pricing.price,
        fastPath: corrected,
      });
      pricing = {
        ...brief.pricing,
        price: corrected,
        currency: fastPathCurrency ?? brief.pricing.currency,
      };
    }
    // Mismo valor en distinto formato ⇒ NO hay discrepancia: se conserva el del LLM (más legible).
  }

  // ── 2) Hero image ──────────────────────────────────────────────────────────────────────
  // `assets.hero_image_url` es el veredicto del análisis visual (T1.7): la imagen que sirve
  // como frame inicial de image-to-video. Se exige que EXISTA y que PERTENEZCA a
  // `assets.images[]` — el mismo criterio de pertenencia que `suggested_assets` (§9.2). Un hero
  // ALUCINADO por el LLM (URL que no está en el set de imágenes reales) es tan inservible como
  // no tener hero: N7a lo usaría de frame inicial de i2v y gastaría dinero contra una imagen
  // inexistente. Los dos casos (ausente / fuera del set) se tratan IGUAL, según el perfil (§9.2):
  //   - `manual`: decisión de CP1 (subir fotos o derivar N7a a packshot IA) → warning tipado,
  //     brief VÁLIDO, el paso NO falla.
  //   - `url`   : sí es un problema (hemos scrapeado y no ha salido ninguna imagen usable) → ok=false.
  const validImageUrls = new Set(brief.assets.images.map((image) => image.url));
  const heroUrl = brief.assets.hero_image_url;
  const heroIsUsable = heroUrl !== null && validImageUrls.has(heroUrl);

  let assets = brief.assets;
  if (!heroIsUsable) {
    if (heroUrl !== null) {
      // Hero alucinado: se PODA (a null) además de avisar. Dejarlo apuntando a una imagen que no
      // existe en el brief sería enviar aguas abajo un puntero roto.
      assets = { ...brief.assets, hero_image_url: null };
    }
    if (profile === 'manual') {
      warnings.push({
        code: 'needs_user_decision',
        reason: 'missing_hero_image',
        message:
          'No hay imagen de producto: sube al menos una foto o elige generar un packshot con IA.',
      });
    } else {
      // DIVERGENCIA DELIBERADA con testing/unit-core.md §5, que dice "url sin hero image →
      // error (NO warning)". Aquí es un warning tipado BLOQUEANTE: da el "error" que pide la
      // skill (`ok = false`, derivado abajo) Y ADEMÁS dice POR QUÉ — un `ok=false` sin motivo
      // es un fallo silencioso. Ni el PRD (§9.2/§7.2 N3) ni la Verificación de T1.9 lo prohíben,
      // y la jerarquía es PRD/planning > skill.
      warnings.push({
        code: 'missing_hero_image',
        message:
          'No pudimos leer una imagen de producto usable de la página; sube 3 imágenes y una descripción.',
      });
    }
  }

  // ── 3) Poda de `suggested_assets[]` + longitud de hooks ────────────────────────────────
  // Los dos checks recorren `angles[]`: una sola pasada. `suggested_assets` fuera de
  // `assets.images[]` se ELIMINA con warning (§7.2 N3); los hooks largos solo se AVISAN
  // (reescribir copy es trabajo del usuario en CP1, no del validador).
  //
  // TODO ángulo se copia, haya poda o no. La cabecera promete "copia corregida, sin mutación":
  // devolver por referencia los ángulos intactos rompería esa promesa a medias — el editor de
  // CP1 (T1.10b) manipula estos briefs, y mutar `result.brief.angles[i]` acabaría mutando el
  // brief del caller. Las colecciones internas (`hook_examples`, `suggested_assets`) se copian
  // también: un shallow spread del ángulo compartiría los arrays.
  const angles = brief.angles.map((angle, angleIndex) => {
    angle.hook_examples.forEach((hook, hookIndex) => {
      const wordCount = countWords(hook);
      if (wordCount > MAX_HOOK_WORDS) {
        warnings.push({
          code: 'hook_too_long',
          angleIndex,
          angleName: angle.name,
          hookIndex,
          hook,
          wordCount,
        });
      }
    });

    const suggested = angle.suggested_assets?.filter((url) => {
      if (validImageUrls.has(url)) return true;
      warnings.push({
        code: 'pruned_suggested_asset',
        angleIndex,
        angleName: angle.name,
        url,
      });
      return false;
    });

    return {
      ...angle,
      hook_examples: [...angle.hook_examples],
      ...(suggested === undefined ? {} : { suggested_assets: suggested }),
    };
  });

  return {
    // DERIVADO, nunca acumulado en paralelo: la severidad viaja con el warning
    // (`isBlockingWarning`). Un `let ok` aparte era un segundo canal para "el brief no sirve",
    // y dos canales divergen en silencio: bastaba olvidar un `ok = false` al añadir un código
    // bloqueante nuevo para que el paso aceptara un brief que revienta aguas abajo.
    ok: !warnings.some(isBlockingWarning),
    brief: { ...brief, pricing, assets, angles },
    warnings,
  };
}
