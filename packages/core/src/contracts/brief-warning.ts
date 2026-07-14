// Warnings TIPADOS del `BriefValidator` (T1.9, PRD §9.2): la salida accionable de los
// checks deterministas post-síntesis. Union DISCRIMINADA por `code` (architecture.md §4:
// todo canal que transporte varios tipos), de modo que el consumidor hace `switch (w.code)`
// exhaustivo y cada miembro lleva los DATOS del caso (qué precio se descartó, qué asset se
// podó), no solo un string.
//
// Ubicación: `contracts/` transversal y NO `analyze/contracts.ts` local. architecture.md §4
// cita "warnings del BriefValidator" como ejemplo de contrato local, pero su propia regla es
// "si otro módulo empieza a importarlo, muévelo a contracts/": el output del step (T1.10a) y
// el editor de CP1 (T1.10b) los consumen fuera de `analyze`, así que nacen ya transversales.
//
// NO confundir con `ProductBrief.meta.warnings` (T1.1, `string[]`): ese es el canal de
// OBSERVABILIDAD del sintetizador (lo que el LLM quiso contar sobre su propia extracción).
// Estos warnings son la salida del validador determinista y NO se escriben en el brief.
import { z } from 'zod';

/**
 * Perfil de validación por ORIGEN (§9.2). `url`: checks completos (hay fast path con precio con
 * el que cruzar el del LLM). `manual`: texto libre — se OMITE el cross-check de precio (no hay
 * N1 con el que cruzar).
 *
 * La falta de hero image NO depende del perfil (T1.15): en LOS DOS es una decisión de CP1
 * (`needs_user_decision`), nunca un error del run. Ver la cabecera de `NeedsUserDecisionWarningSchema`.
 */
export const BriefValidationProfileSchema = z.enum(['url', 'manual']);
export type BriefValidationProfile = z.infer<typeof BriefValidationProfileSchema>;

/** Decisiones que el validador delega EXPLÍCITAMENTE en el usuario en CP1 (§9.2). */
export const NeedsUserDecisionReasonSchema = z.enum(['missing_hero_image']);
export type NeedsUserDecisionReason = z.infer<typeof NeedsUserDecisionReasonSchema>;

/**
 * Cross-check de precio N1 (fast path determinista) vs N3 (síntesis del LLM). Gana SIEMPRE
 * el fast path: es un dato extraído, no inferido. El warning conserva el precio descartado
 * para que CP1 pueda mostrar la corrección (perfil `url` únicamente).
 */
export const PriceMismatchWarningSchema = z.object({
  code: z.literal('price_mismatch'),
  /** El precio que el LLM puso en `pricing.price` y que se ha DESCARTADO. */
  synthesized: z.string(),
  /** El precio del fast path (N1) que ha ganado y está ya en el brief corregido. */
  fastPath: z.string(),
});

/**
 * Un `angles[].suggested_assets[]` que NO está en `assets.images[]` (§9.2: "los inválidos se
 * eliminan con warning"). El elemento se PODA del brief corregido; el warning dice de qué
 * ángulo salía y qué URL era, para que el hallazgo sea accionable.
 */
export const PrunedSuggestedAssetWarningSchema = z.object({
  code: z.literal('pruned_suggested_asset'),
  /** Índice del ángulo en `angles[]` (los ángulos no tienen id estable en el contrato). */
  angleIndex: z.number().int(),
  angleName: z.string(),
  /** La URL podada (no existía en `assets.images[]`). */
  url: z.string(),
});

/**
 * Hook por encima del techo de palabras. Los hooks son los 0–3 s del anuncio: un hook largo
 * no cabe en el vídeo. Se AVISA (no se recorta: reescribir copy es trabajo del usuario en CP1).
 */
export const HookTooLongWarningSchema = z.object({
  code: z.literal('hook_too_long'),
  angleIndex: z.number().int(),
  angleName: z.string(),
  /** Índice del hook dentro de `angles[i].hook_examples[]`. */
  hookIndex: z.number().int(),
  hook: z.string(),
  wordCount: z.number().int(),
  // El TECHO no viaja en el warning: es la constante `MAX_HOOK_WORDS` (exportada por
  // `analyze/brief-validator`), no un dato del caso. Un campo que solo puede valer 12
  // promete una varianza que no existe y manda al lector a buscar dónde varía.
});

/**
 * Decisión que el pipeline NO toma solo: la delega en el usuario en CP1. Hoy un único `reason`
 * (`missing_hero_image`): sin imagen hero usable, el usuario sube fotos, promueve una de las
 * imágenes scrapeadas, o deriva a packshot IA (N7a) — §7.2 N3. El brief queda VÁLIDO y el paso
 * NO falla.
 *
 * T1.15 — EN LOS DOS PERFILES, y esto REVIERTE la asimetría de T1.9 (que hacía de la falta de
 * hero un fallo TERMINAL del run en perfil `url`). El fallo duro se diseñó pensando en
 * e-commerce («scrapeé una tienda y no salió ni una foto» = algo va mal), pero el uso real
 * incluye webs de servicio/SaaS donde NO tener packshot es lo normal: el run de stayforlong.com
 * murió en N3 con la síntesis de Sonnet YA PAGADA y sin nada que el usuario pudiera hacer salvo
 * leer logs, mientras las 3 imágenes que sí había (un sello de award, un about-us, un banner)
 * estaban ahí, esperando a que alguien las mirase. El mecanismo bueno ya existía en `manual`:
 * llevar la decisión a CP1 (PRD §7.2 N3 y §9.2, cambio de alcance menor).
 */
export const NeedsUserDecisionWarningSchema = z.object({
  code: z.literal('needs_user_decision'),
  reason: NeedsUserDecisionReasonSchema,
  /** Mensaje ACCIONABLE (patrón de doble entrada de Prizmad, §9.2). Wording nunca es contrato. */
  message: z.string(),
});

/**
 * T2.7 — SE ANALIZÓ OTRA PÁGINA. El usuario pidió una URL, la web sirvió otra tras una
 * redirección, y el cambio es SIGNIFICATIVO (cambio de host, o ruta profunda → raíz desnuda:
 * el criterio estrecho de `detectRedirectMismatch`, ingest/url.ts). El caso vivo:
 * `dr-squatch.com/products/pine-tar-bar-soap` → `301` → la home, y el brief describía la home.
 *
 * AVISA, NO BLOQUEA — y es el MISMO precedente que T1.15: el run sigue, CP1 lo enseña y el
 * humano decide. Hay redirecciones legítimas que solo un humano puede juzgar (un producto
 * renombrado, una web reestructurada), y matar el run le quitaría la decisión que el checkpoint
 * existe para darle. Por eso NO es un `needs_user_decision` (que bloquea la aprobación): es un
 * HECHO que se pone delante de los ojos del usuario, sobre un brief que sí se puede aprobar si
 * el destino era el correcto. PRD §7.2 N1 / §9.2.
 *
 * Las URLs viajan NORMALIZADAS (`normalizeUrl`): es lo que la BD guarda y lo que CP1 enseña.
 */
export const UrlRedirectedWarningSchema = z.object({
  code: z.literal('url_redirected'),
  /** Por qué la redirección es significativa (union cerrada del comparador `detectRedirectMismatch`):
   *  `host_changed` (otro sitio), `path_to_root` (la home desnuda) o `path_diverged` (otra rama del
   *  sitio — la CATEGORÍA a la que la tienda manda un producto descatalogado). */
  reason: z.enum(['host_changed', 'path_to_root', 'path_diverged']),
  /** La URL que el usuario PIDIÓ analizar (normalizada). */
  requested: z.string(),
  /** La URL que la web SIRVIÓ y que de verdad se analizó (normalizada). */
  final: z.string(),
});

/** La union discriminada completa. Un `code` nuevo aquí rompe el `switch` exhaustivo del consumidor. */
export const BriefWarningSchema = z.discriminatedUnion('code', [
  PriceMismatchWarningSchema,
  PrunedSuggestedAssetWarningSchema,
  HookTooLongWarningSchema,
  NeedsUserDecisionWarningSchema,
  UrlRedirectedWarningSchema,
]);
export type BriefWarning = z.infer<typeof BriefWarningSchema>;
export type BriefWarningCode = BriefWarning['code'];

// NO HAY WARNINGS BLOQUEANTES (T1.15). Aquí vivían `BLOCKING_WARNING_CODES` +
// `isBlockingWarning`: la maquinaria que derivaba el `ok` del validador y que el executor de N3
// traducía en un `PermanentStepError`. Con `missing_hero_image` fuera, el Set quedaba VACÍO y la
// función devolvía `false` siempre — un mecanismo MUERTO. Se elimina entero (con el `ok` del
// validador, que ya nadie podía poner a false) en vez de dejarlo «por si acaso»: un Set vacío es
// una promesa de que existe un camino que ya no existe, y el siguiente lector tendría que
// demostrarse a sí mismo que ningún warning lo activa.
//
// SI ALGÚN DÍA vuelve a hacer falta invalidar un brief, el sitio es este y el patrón está escrito
// arriba (la severidad viaja CON el warning; el `ok` se DERIVA, jamás se acumula en paralelo).
// Pero que vuelva sea una decisión deliberada, no la inercia de un hueco que quedó abierto.
