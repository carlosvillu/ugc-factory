// SELECCIÓN DETERMINISTA DE TEMPLATE POR FACETAS + SCORING (§9.3, T3.5). Función PURA, sin red,
// sin LLM ("sin LLM" es literal de §9.3): dado el catálogo de templates sembrados y el contexto de
// una variante (ángulo, vertical, plataforma, formato), FILTRA los candidatos compatibles y elige
// el mejor por SCORING — con un desempate DETERMINISTA que hace los golden files reproducibles.
//
// EL FILTRO (facetas). Cada template declara arrays `formats/hookAngles/verticals/platforms`. La
// regla, dimensión a dimensión: un array VACÍO en el template = agnóstico → pasa siempre; un array
// no vacío exige que el valor del contexto esté DENTRO. Un template que no case en alguna dimensión
// declarada queda fuera. Es la intersección de facetas de §9.3.
//
// EL SCORING. Sobre los candidatos, la puntuación premia el SOLAPE de facetas (cuántas dimensiones
// del contexto casan explícitamente con el template, no por ser agnóstico) + `perf` + coste.
// ⚠ PERF STATS VACÍAS HOY: el seed NO trae `perf` (vive en la BD, la calibra el runtime). Sin perf
// → contribución NEUTRA (0), NUNCA penalización ni error. El día que haya perf se suma aquí.
//
// EL DESEMPATE. Dos candidatos con el mismo score se ordenan por `slug` ASCENDENTE. Esto es lo que
// hace la selección REPRODUCIBLE: sin un desempate estable, el golden del compilador sería flaky.
//
// NO LANZA (patrón `resolveGuardPacks`): devuelve `{ template }` o `{ error: 'no_candidates' }`.
import type { PromptTemplateSeed } from './contracts';

/** El contexto de selección: las facetas de la variante contra las que se filtra/puntúa. */
export interface SelectTemplateContext {
  /** El ángulo/framework de la variante (`pain_point`, `authority`, `transformation`…). Casa `hookAngles`. */
  hookAngle?: string;
  /** `product.category` del brief. Casa `verticals`. */
  vertical?: string;
  /** Plataforma destino (`tiktok`, `instagram`…). Casa `platforms`. */
  platform?: string;
  /** Formato del anuncio (`grwm`, `unboxing`, `before-after`…), si derivable. Casa `formats`. */
  format?: string;
  /** El `kind` que la variante necesita (`video` por defecto): un template de otro kind no aplica. */
  kind?: PromptTemplateSeed['kind'];
}

export type SelectTemplateResult =
  | { template: PromptTemplateSeed; error?: undefined }
  | {
      template?: undefined;
      error: 'no_candidates';
      /** Las facetas con las que se buscó — el mensaje accionable de "no hay template para esto". */
      message: string;
    };

/** Normaliza una faceta para el match: minúsculas + trim (mismo criterio que `guard-lookup`). */
function norm(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * ¿Casa el contexto una dimensión del template? Array vacío = agnóstico (pasa). Array no vacío:
 * el valor del contexto debe estar dentro (normalizado). Si el contexto no fija la dimensión
 * (`undefined`) pero el template la restringe, NO pasa: el template pide algo que no se le dio.
 */
function facetMatches(
  templateFacets: readonly string[],
  contextValue: string | undefined,
): boolean {
  if (templateFacets.length === 0) return true; // agnóstico
  if (contextValue === undefined) return false; // el template restringe y el contexto no lo fija
  const target = norm(contextValue);
  return templateFacets.some((f) => norm(f) === target);
}

/** Cuenta cuántas dimensiones RESTRINGIDAS del template casan explícitamente con el contexto
 *  (mide especificidad: un template que fija beauty+tiktok y casa puntúa más que uno agnóstico). */
function facetOverlap(template: PromptTemplateSeed, ctx: SelectTemplateContext): number {
  let overlap = 0;
  if (template.formats.length > 0 && facetMatches(template.formats, ctx.format)) overlap += 1;
  if (template.hookAngles.length > 0 && facetMatches(template.hookAngles, ctx.hookAngle))
    overlap += 1;
  if (template.verticals.length > 0 && facetMatches(template.verticals, ctx.vertical)) overlap += 1;
  if (template.platforms.length > 0 && facetMatches(template.platforms, ctx.platform)) overlap += 1;
  return overlap;
}

/** ¿Pasa el template TODAS las dimensiones del filtro? (kind + las 4 facetas). */
function passesFilter(template: PromptTemplateSeed, ctx: SelectTemplateContext): boolean {
  const kind = ctx.kind ?? 'video';
  if (template.kind !== kind) return false;
  return (
    facetMatches(template.formats, ctx.format) &&
    facetMatches(template.hookAngles, ctx.hookAngle) &&
    facetMatches(template.verticals, ctx.vertical) &&
    facetMatches(template.platforms, ctx.platform)
  );
}

/**
 * El SCORE de un candidato. Hoy = solape de facetas (perf y coste son 0: perf vacío en el seed,
 * el coste del template no se modela aún). Aislado en su función para que añadir `perf`/coste sea
 * una línea sin tocar el orden ni el desempate. Determinista por construcción.
 */
function scoreTemplate(template: PromptTemplateSeed, ctx: SelectTemplateContext): number {
  const facetScore = facetOverlap(template, ctx);
  const perfScore = 0; // perf stats VACÍAS hoy → neutro (§9.3): ni bonus ni penalización.
  const costScore = 0; // el coste del template no se modela en T3.5.
  return facetScore + perfScore + costScore;
}

/**
 * Elige el template para una variante (§9.3). Filtra por facetas, puntúa los candidatos y devuelve
 * el de mayor score; DESEMPATE por `slug` ascendente (reproducibilidad de goldens). Sin candidatos
 * → `{ error: 'no_candidates' }` con las facetas buscadas — el "error accionable" del selector.
 */
export function selectTemplate(
  templates: readonly PromptTemplateSeed[],
  ctx: SelectTemplateContext,
): SelectTemplateResult {
  const candidates = templates.filter((t) => passesFilter(t, ctx));
  if (candidates.length === 0) {
    const facets = [
      ctx.kind !== undefined ? `kind=${ctx.kind}` : `kind=video`,
      ctx.format !== undefined ? `format=${ctx.format}` : undefined,
      ctx.hookAngle !== undefined ? `hookAngle=${ctx.hookAngle}` : undefined,
      ctx.vertical !== undefined ? `vertical=${ctx.vertical}` : undefined,
      ctx.platform !== undefined ? `platform=${ctx.platform}` : undefined,
    ].filter((x): x is string => x !== undefined);
    return {
      error: 'no_candidates',
      message: `No hay ningún template de galería que case con las facetas [${facets.join(', ')}].`,
    };
  }

  // Orden estable: score DESC, y a igual score `slug` ASC. `sort` de JS es estable, pero el
  // desempate explícito por slug garantiza el mismo ganador aunque el orden de entrada cambie.
  const ranked = [...candidates].sort((a, b) => {
    const scoreDiff = scoreTemplate(b, ctx) - scoreTemplate(a, ctx);
    if (scoreDiff !== 0) return scoreDiff;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  // `ranked[0]` existe: `candidates` no está vacío (comprobado arriba). El guard explícito evita el
  // non-null assertion y da un error claro si el invariante se rompiera.
  const winner = ranked[0];
  if (winner === undefined) {
    return {
      error: 'no_candidates',
      message: 'No hay candidatos tras el ranking (invariante roto).',
    };
  }
  return { template: winner };
}
