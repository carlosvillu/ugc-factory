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
// LA DEGRADACIÓN DE VERTICAL (T5.12). `vertical` sale de `brief.product.category`, TEXTO LIBRE del LLM
// de análisis (§12). La MISMA URL de CeraVe emitió `beauty` un día y `Cuidado de la piel` al siguiente:
// con el filtro estricto, una etiqueta fuera del enum del seed dejaba el lote MUERTO. Ahora hay DOS
// PASES: (1) estricto — idéntico al de siempre, la especificidad manda; (2) si y solo si el estricto se
// queda SIN candidatos y el contexto fijaba una vertical, se repite ignorando la dimensión `verticals`.
// El resultado degradado viene MARCADO (`relaxedFacet`/`unmatchedValue`) para que el consumidor lo
// registre: degradar sí, en silencio no. Se relaja SOLO `vertical` (las demás facetas son enums
// internos, no texto de LLM). Es el mismo precedente de `resolveGuardPacks`: una category sin pack no
// añade pack y NO falla.
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
  | {
      template: PromptTemplateSeed;
      error?: undefined;
      /**
       * T5.12 — presente SOLO cuando la selección necesitó DEGRADAR: la faceta que se ignoró en el
       * segundo pase (hoy solo `'vertical'`). `undefined` en el camino normal. El consumidor
       * (executor N6) lo convierte en un warning estructurado: la degradación es visible, no muda.
       */
      relaxedFacet?: 'vertical';
      /** El valor de la faceta relajada que NO reconoció ningún template (p.ej. `Cuidado bucal`). */
      unmatchedValue?: string;
    }
  | {
      template?: undefined;
      relaxedFacet?: undefined;
      unmatchedValue?: undefined;
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

/**
 * T5.12 — DEGRADACIÓN POR AUSENCIA DE CANDIDATOS. `vertical` sale de `brief.product.category`, que es
 * TEXTO LIBRE del LLM de análisis (§12): la MISMA URL de CeraVe emitió `beauty` un día y
 * `Cuidado de la piel` al siguiente. Con el filtro estricto, cualquier etiqueta fuera del enum del seed
 * mataba el lote entero (`no_candidates` → `PermanentStepError` en N6) y obligaba a editar la category
 * a mano en CP1. `relaxVertical` marca el SEGUNDO PASE: la dimensión `verticals` se da por satisfecha
 * (no se "desfija" el contexto — poner `vertical: undefined` NO es un comodín: `facetMatches` lo
 * rechaza, y NINGÚN template del seed declara `verticals: []`, así que ese pase daría 0 candidatos
 * otra vez). Solo se relaja `vertical`: `kind`/`hookAngle`/`platform`/`format` son enums INTERNOS, no
 * texto de LLM, y un desajuste ahí sigue siendo un bug que debe reventar.
 */
interface FacetRelaxation {
  relaxVertical: boolean;
}

const STRICT: FacetRelaxation = { relaxVertical: false };
const RELAX_VERTICAL: FacetRelaxation = { relaxVertical: true };

/** Cuenta cuántas dimensiones RESTRINGIDAS del template casan explícitamente con el contexto
 *  (mide especificidad: un template que fija beauty+tiktok y casa puntúa más que uno agnóstico).
 *  En el pase relajado la vertical NO suma: nadie casó, así que el ranking lo deciden ángulo,
 *  plataforma y formato + el desempate por slug — igual de determinista. */
function facetOverlap(
  template: PromptTemplateSeed,
  ctx: SelectTemplateContext,
  relax: FacetRelaxation,
): number {
  let overlap = 0;
  if (template.formats.length > 0 && facetMatches(template.formats, ctx.format)) overlap += 1;
  if (template.hookAngles.length > 0 && facetMatches(template.hookAngles, ctx.hookAngle))
    overlap += 1;
  if (
    !relax.relaxVertical &&
    template.verticals.length > 0 &&
    facetMatches(template.verticals, ctx.vertical)
  )
    overlap += 1;
  if (template.platforms.length > 0 && facetMatches(template.platforms, ctx.platform)) overlap += 1;
  return overlap;
}

/** ¿Pasa el template TODAS las dimensiones del filtro? (kind + las 4 facetas). En el pase relajado
 *  la dimensión `verticals` se considera satisfecha para TODOS los templates. */
function passesFilter(
  template: PromptTemplateSeed,
  ctx: SelectTemplateContext,
  relax: FacetRelaxation,
): boolean {
  const kind = ctx.kind ?? 'video';
  if (template.kind !== kind) return false;
  return (
    facetMatches(template.formats, ctx.format) &&
    facetMatches(template.hookAngles, ctx.hookAngle) &&
    (relax.relaxVertical || facetMatches(template.verticals, ctx.vertical)) &&
    facetMatches(template.platforms, ctx.platform)
  );
}

/**
 * El SCORE de un candidato. Hoy = solape de facetas (perf y coste son 0: perf vacío en el seed,
 * el coste del template no se modela aún). Aislado en su función para que añadir `perf`/coste sea
 * una línea sin tocar el orden ni el desempate. Determinista por construcción.
 */
function scoreTemplate(
  template: PromptTemplateSeed,
  ctx: SelectTemplateContext,
  relax: FacetRelaxation,
): number {
  const facetScore = facetOverlap(template, ctx, relax);
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
  // PASE 1 — ESTRICTO. Es el camino normal y NO cambia: si la vertical del brief casa, gana el
  // template más específico (el scoring premia el solape). La degradación no rebaja nunca este pase.
  const strict = rank(templates, ctx, STRICT);
  if (strict !== undefined) return { template: strict };

  // PASE 2 — DEGRADACIÓN (T5.12). Solo si el pase estricto se quedó SIN candidatos, y solo si la
  // vertical era lo que restringía (el contexto la fija). Un `hookAngle`/`platform`/`kind` que no casa
  // sigue muriendo abajo: son enums internos, no texto libre.
  if (ctx.vertical !== undefined) {
    const relaxed = rank(templates, ctx, RELAX_VERTICAL);
    if (relaxed !== undefined) {
      return { template: relaxed, relaxedFacet: 'vertical', unmatchedValue: ctx.vertical };
    }
  }

  {
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
}

/**
 * Filtra + puntúa + ordena en UN pase con el nivel de relajación dado, y devuelve el ganador (o
 * `undefined` si ese pase no tiene candidatos). Orden estable: score DESC, y a igual score `slug`
 * ASC. `sort` de JS es estable, pero el desempate explícito por slug garantiza el mismo ganador
 * aunque el orden de entrada cambie — es lo que hace REPRODUCIBLES los goldens, también en el pase
 * degradado.
 */
function rank(
  templates: readonly PromptTemplateSeed[],
  ctx: SelectTemplateContext,
  relax: FacetRelaxation,
): PromptTemplateSeed | undefined {
  const candidates = templates.filter((t) => passesFilter(t, ctx, relax));
  if (candidates.length === 0) return undefined;
  const ranked = [...candidates].sort((a, b) => {
    const scoreDiff = scoreTemplate(b, ctx, relax) - scoreTemplate(a, ctx, relax);
    if (scoreDiff !== 0) return scoreDiff;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  return ranked[0];
}
