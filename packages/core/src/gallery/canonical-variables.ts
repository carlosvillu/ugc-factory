// LAS VARIABLES CANÓNICAS §10.4 (contrato v1) — EN CÓDIGO.
//
// Este es el CONTRATO COMPARTIDO que dice qué slots `{namespace.field}` puede llevar el
// `body` de un template de galería y de dónde los resuelve el compilador. Vive en core (no
// dentro del validador de seeds) por una razón de altitud deliberada: **T3.5 (el compilador
// de prompts, N6) resuelve estos MISMOS slots** contra brief/persona/hook/cta/campaign. Si el
// conjunto viviera enterrado en el validador del seed, T3.5 lo duplicaría y las dos copias
// derivarían. Aquí lo importan LOS DOS: `seed-validator.ts` para RECHAZAR un slot inexistente
// en el seed, y (en T3.5) el compilador para RESOLVERLO.
//
// OJO: ESTE NO ES el sistema de `library/placeholders.ts`. Ese cubre los placeholders de las
// LÍNEAS de librería (`{product}`, `{pain}`, `{benefit}`, `{category}`) que el ScriptWriter
// sustituye. Los slots de galería son `{namespace.field}` (`{product.name}`), bare
// (`{pain_point}`, `{platform}`) e indexados (`{benefit[0]}`) — un vocabulario DISTINTO,
// gobernado por §10.4. Son dos sistemas separados a propósito.
//
// El texto es VERBATIM de PRD §10.4 (PRD.md l.453-455). `{claim.safe}` se ELIMINA como
// variable (§10.4 lo dice explícito): los claims seguros los garantiza el linter de §15.2, no
// un slot — por eso NO aparece aquí.

/**
 * Los slots canónicos de nombre FIJO (§10.4). Cada uno es un literal exacto que puede
 * aparecer en el `body` de un template como `{<slot>}`.
 *
 * `{benefit[n]}` NO está aquí: es indexado (`{benefit[0]}`, `{benefit[1]}`…) y se valida con
 * `BENEFIT_INDEXED_SLOT` (un patrón, no un literal) — ver abajo.
 */
export const CANONICAL_SLOTS = [
  // ← brief.product
  'product.name',
  'product.category',
  // asset:image ← brief.assets
  'product.hero_image',
  // ← brief.benefits (el primario; los indexados van por patrón)
  'benefit.primary',
  // ← brief.pain_points
  'pain_point',
  // ← brief.objections
  'objection',
  'rebuttal',
  // ← audiencia/Persona
  'persona.age_range',
  'persona.descriptor',
  'persona.setting',
  // asset:image ← Persona (identity lock)
  'avatar.ref',
  // ← hook_line × ángulo
  'hook.line',
  // ← cta_line × objetivo
  'cta.line',
  // enum ← campaign: BatchPlan/variante
  'platform',
  'aspect',
  'duration',
  'setting',
] as const;

export type CanonicalSlot = (typeof CANONICAL_SLOTS)[number];

/** Búsqueda O(1): un slot fijo es válido si está aquí. */
const CANONICAL_SLOT_SET: ReadonlySet<string> = new Set(CANONICAL_SLOTS);

/**
 * `{benefit[n]}` es indexado (§10.4): `{benefit[0]}`, `{benefit[1]}`… Se valida con un PATRÓN,
 * no con un literal, porque el índice es arbitrario (los beneficios del brief son una lista).
 * Ancla ambos extremos para no aceptar `{benefit[0]x}` ni `{xbenefit[0]}`.
 */
export const BENEFIT_INDEXED_SLOT = /^benefit\[\d+\]$/;

/**
 * Extrae los tokens de slot del texto: todo lo que hay entre `{` y `}`. Devuelve el token
 * INTERIOR (sin llaves): `"body {product.name}"` → `["product.name"]`. Es una función propia
 * (no reusa `library/placeholders.ts`) precisamente porque el vocabulario y la sintaxis son
 * otros: `namespace.field` con puntos, e índices con corchetes.
 */
export function extractSlots(body: string): string[] {
  const matches = body.matchAll(/\{([^}]+)\}/g);
  return Array.from(matches, (m) => m[1] ?? '');
}

/**
 * ¿Es `token` un slot canónico §10.4? Verdadero si es uno de los literales fijos O encaja el
 * patrón indexado de beneficio. Un `{producto.nombre}` (typo/inexistente) devuelve `false`:
 * ese es exactamente el caso que la Verificación de T3.2 rompe a propósito.
 */
export function isCanonicalSlot(token: string): boolean {
  return CANONICAL_SLOT_SET.has(token) || BENEFIT_INDEXED_SLOT.test(token);
}
