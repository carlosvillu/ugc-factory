// `BriefValidator` (T1.9, PRD §9.2): los checks DETERMINISTAS post-síntesis sobre el
// ProductBrief que devuelve el BriefSynthesizer (T1.8). Sin LLM, sin red, sin I/O: función
// PURA (`validateBrief`) que recibe el brief + el RawContent del fast path y devuelve una
// COPIA CORREGIDA + los warnings tipados. No muta la entrada y no persiste nada: los warnings
// viajan en el retorno (los consume el step de T1.10a y el editor de CP1 de T1.10b).
//
// Perfiles por origen (§9.2):
//   - `url`    : checks completos. Cross-check de precio N1==N3.
//   - `manual` : texto libre. Se OMITE el cross-check de precio (no hay fast path con el que cruzar).
//
// La falta de hero image NO ramifica por perfil (T1.15): en los dos es DECISIÓN DE CP1, nunca un
// error del run. Ver el bloque 2) y la cabecera de `NeedsUserDecisionWarningSchema`.
//
// NINGÚN check de aquí puede INVALIDAR el brief: el validador emite warnings, y todos ellos
// (corrección, aviso, decisión) dejan pasar el brief a CP1. No hay `ok` que devolver — lo hubo
// hasta T1.15, cuando el único código bloqueante que existía dejó de serlo.
//
// Cardinalidades (5–10 ángulos, 2–3 hooks, ≤4 segments, ≤5 quotes) Y ENUMS — los otros dos
// checks que §9.2 lista: NO se re-implementan aquí. Su única fuente de verdad es la capa Zod
// del contrato de T1.1 (`ProductBriefSchema`, §13.2: la API de Anthropic ignora los constraints
// de array, y el `safeParse` post-llamada es la red de seguridad real). La entrada de esta
// función es un `ProductBrief` YA parseado: duplicar los `.min()/.max()` o los `z.enum()` aquí
// crearía una segunda fuente de verdad que derivaría en silencio.
import type { ProductBrief } from '../contracts/product-brief';
import type { RawContent } from '../contracts/raw-content';
import type { BriefValidationProfile, BriefWarning } from '../contracts/brief-warning';
// T2.7 — el comparador de redirección significativa vive en `ingest` (junto a `normalizeUrl`,
// que reutiliza): es LÓGICA DE URL, no de validación de brief. Aquí solo se consume.
import { detectRedirectMismatch } from '../ingest/url';

/**
 * Techo de palabras de un hook (§7.2 N3: "hooks ≤12 palabras"). El hook ocupa los 0–3 s del
 * anuncio; a ~2,5 palabras/segundo (la regla de timing de §7.2 N5) 12 palabras ya son ~5 s.
 */
export const MAX_HOOK_WORDS = 12;

export interface ValidateBriefOptions {
  profile: BriefValidationProfile;
  /**
   * El `RawContent` de N1. Aporta DOS datos al validador:
   *  - el precio del FAST PATH para el cross-check N1==N3 (perfil `url`);
   *  - el par (`url` pedida, `urlFinal` servida) para la comprobación de redirección de T2.7.
   *
   * Opcional, pero omitirlo desactiva los dos checks EN SILENCIO — el fallo que costó T1.9. El
   * executor de N3 lo pasa SIEMPRE (también en perfil `manual`, donde el propio validador lo
   * ignora: sin precio scrapeado que cruzar y con `url: null`, no hay nada que comprobar).
   */
  rawContent?: RawContent | null;
}

export interface ValidateBriefResult {
  /** Copia CORREGIDA del brief (precio del fast path, `suggested_assets` podadas, hero alucinado
   *  podado a null). SIEMPRE válido: ningún check del validador puede invalidarlo (T1.15). */
  brief: ProductBrief;
  /** Los hallazgos. Los que exigen una DECISIÓN del usuario los resuelve CP1 (`needs_user_decision`);
   *  el resto son informativos. Ninguno hace fallar el step. */
  warnings: BriefWarning[];
}

/**
 * Cuenta palabras de un hook: tokens separados por espacio en blanco. Determinista.
 *
 * EXPORTADA en T2.1 para que el test del validador de seeds pueda asertar que sus fixtures
 * tienen de verdad N palabras literales. Ojo: la librería NO cuenta con esta función, sino con
 * `countRenderedWords` (core/library/placeholders.ts), que suma el presupuesto de cada
 * `{placeholder}` — una plantilla de 9 palabras puede renderizar 17. Lo que las dos capas SÍ
 * comparten, deliberadamente, es el techo: `MAX_HOOK_WORDS`. Una constante, dos formas de
 * contar, cada una honesta con lo que mide (el hook del LLM no lleva placeholders; el de la
 * librería sí).
 */
export function countWords(text: string): number {
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

  // ── 1b) ¿SE ANALIZÓ LA PÁGINA QUE EL USUARIO PIDIÓ? (T2.7) ──────────────────────────────
  // Comprobación determinista y GRATIS sobre el RawContent: si la web sirvió otra URL tras una
  // redirección SIGNIFICATIVA (`detectRedirectMismatch`: cambio de host, o ruta profunda →
  // raíz), el brief describe otra página — y hasta T2.7 nadie se enteraba (el caso
  // dr-squatch: `/products/pine-tar-bar-soap` → `301` → la home).
  //
  // POR QUÉ VIVE EN EL VALIDADOR y no en el executor: (a) es exactamente su naturaleza —un check
  // determinista post-síntesis sobre el par (brief, RawContent)—, y (b) sus warnings SOBREVIVEN
  // AL REUSO del brief (N3 revalida al reusar un brief ya pagado: los del sintetizador se
  // pierden, los del validador se regeneran). Un aviso que se evaporase en el camino de reuso
  // sería un aviso que a veces no sale, que es peor que no tenerlo.
  //
  // La detección la hace el COMPARADOR de core (una función, un sitio); aquí solo se traduce su
  // hallazgo al warning tipado que CP1 pinta. AVISA, NO BLOQUEA (precedente T1.15).
  //
  // El comparador ya devuelve `null` sin URL final, así que un camino de ingesta que no la
  // expone (o un análisis anterior a T2.7, sin `urlFinal` en su jsonb) simplemente no avisa.
  const redirect =
    rawContent?.url != null ? detectRedirectMismatch(rawContent.url, rawContent.urlFinal) : null;
  if (redirect !== null) {
    warnings.push({
      code: 'url_redirected',
      reason: redirect.reason,
      requested: redirect.requested,
      final: redirect.final,
    });
  }

  // ── 2) Hero image ──────────────────────────────────────────────────────────────────────
  // `assets.hero_image_url` es el veredicto del análisis visual (T1.7): la imagen que sirve
  // como frame inicial de image-to-video. Se exige que EXISTA y que PERTENEZCA a
  // `assets.images[]` — el mismo criterio de pertenencia que `suggested_assets` (§9.2). Un hero
  // ALUCINADO por el LLM (URL que no está en el set de imágenes reales) es tan inservible como
  // no tener hero: N7a lo usaría de frame inicial de i2v y gastaría dinero contra una imagen
  // inexistente. Los dos casos (ausente / fuera del set) se tratan IGUAL.
  //
  // Y EN LOS DOS PERFILES IGUAL (T1.15): es una DECISIÓN DE CP1 (`needs_user_decision`), nunca un
  // fallo del run. Hasta T1.15, la rama `url` emitía un warning BLOQUEANTE que mataba el step con
  // la síntesis de Sonnet ya pagada. La regla se escribió pensando en e-commerce (una tienda sin
  // ni una foto usable = algo va mal), pero el uso real incluye webs de servicio/SaaS donde NO
  // tener packshot es lo NORMAL: stayforlong.com clasificó honestamente sus 3 imágenes (un sello
  // de award `unusable`, un about-us y un banner `broll`) → sin hero → run muerto, sin nada que
  // el usuario pudiera hacer. Ahora el brief llega a CP1 y el usuario elige (PRD §7.2 N3, §9.2).
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
    // El MENSAJE es lo único que ramifica por perfil, y solo porque las salidas ACCIONABLES no
    // son las mismas: con imágenes scrapeadas (rama url) el usuario puede PROMOVER una a hero —
    // la salida que descubrió stayforlong.com— y sin ninguna (manual, o una url de la que no
    // salió ni una imagen) solo puede subir fotos o derivar a packshot IA. El wording no es
    // contrato; el `code` y el `reason`, sí.
    const hasCandidates = brief.assets.images.length > 0;
    warnings.push({
      code: 'needs_user_decision',
      reason: 'missing_hero_image',
      message: hasCandidates
        ? 'No hay una imagen de producto clara: elige una de las imágenes de la página como principal, ' +
          'sube tus propias fotos, o genera un packshot con IA.'
        : 'No hay imagen de producto: sube al menos una foto o elige generar un packshot con IA.',
    });
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

  // Sin `ok` (T1.15): no hay ningún camino por el que este validador pueda decir "este brief no
  // sirve". Cuando lo había, se DERIVABA de los warnings (`isBlockingWarning`) y nunca se acumuló
  // en paralelo — el patrón sigue siendo el bueno si algún día vuelve a hacer falta. Devolver hoy
  // un `ok: true` constante sería peor que no devolverlo: un booleano que nunca es false le hace
  // creer al llamante que tiene algo que comprobar.
  return {
    brief: { ...brief, pricing, assets, angles },
    warnings,
  };
}
