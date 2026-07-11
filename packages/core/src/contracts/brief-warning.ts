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
 * Perfil de validación por ORIGEN (§9.2). `url`: checks completos (hay fast path con precio
 * y un scraping del que salió la imagen hero). `manual`: texto libre — se OMITE el cross-check
 * de precio (no hay N1 con el que cruzar) y la falta de hero image es una decisión de CP1,
 * no un error.
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
 * Decisión que el pipeline NO toma solo: la delega en el usuario en CP1. Hoy un único
 * `reason` (`missing_hero_image` en perfil `manual`: sin imagen hero, N7a deriva a packshot IA
 * O el usuario sube fotos — §7.2 N3). El brief queda VÁLIDO y el paso NO falla.
 */
export const NeedsUserDecisionWarningSchema = z.object({
  code: z.literal('needs_user_decision'),
  reason: NeedsUserDecisionReasonSchema,
  /** Mensaje ACCIONABLE (patrón de doble entrada de Prizmad, §9.2). Wording nunca es contrato. */
  message: z.string(),
});

/**
 * Perfil `url` sin imagen hero USABLE (ausente, o apuntando a una URL que no está en
 * `assets.images[]`): aquí SÍ es un problema real — hemos scrapeado la página y no ha salido ni
 * una imagen que sirva de frame inicial de i2v. NO es una decisión de CP1 como en manual (§9.2).
 * Es el único warning BLOQUEANTE de hoy (ver `isBlockingWarning`).
 */
export const MissingHeroImageWarningSchema = z.object({
  code: z.literal('missing_hero_image'),
  message: z.string(),
});

/** La union discriminada completa. Un `code` nuevo aquí rompe el `switch` exhaustivo del consumidor. */
export const BriefWarningSchema = z.discriminatedUnion('code', [
  PriceMismatchWarningSchema,
  PrunedSuggestedAssetWarningSchema,
  HookTooLongWarningSchema,
  NeedsUserDecisionWarningSchema,
  MissingHeroImageWarningSchema,
]);
export type BriefWarning = z.infer<typeof BriefWarningSchema>;
export type BriefWarningCode = BriefWarning['code'];

/**
 * Códigos que INVALIDAN el brief (el paso no puede continuar ni delegar en CP1). La severidad
 * viaja CON EL WARNING, y el `ok` del validador se DERIVA de aquí (`isBlockingWarning`) en vez
 * de mantenerse en paralelo: así, añadir un código bloqueante nuevo es imposible de olvidar —
 * antes había dos canales (`ok` y `warnings[]`) que podían divergir en silencio.
 *
 * Ojo con la asimetría deliberada de §9.2: la MISMA falta de hero image es bloqueante en perfil
 * `url` (`missing_hero_image`) y NO bloqueante en `manual` (`needs_user_decision`, decisión de
 * CP1). Quien decide cuál emitir es el validador, según el perfil; la severidad es del código.
 */
const BLOCKING_WARNING_CODES = new Set<BriefWarningCode>(['missing_hero_image']);

/** `true` si este warning invalida el brief. Único criterio de "el brief no sirve". */
export function isBlockingWarning(warning: BriefWarning): boolean {
  return BLOCKING_WARNING_CODES.has(warning.code);
}
