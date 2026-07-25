// CONTRATO FORWARD `N6-sources` (T3.5 → F4/T4.11). La frontera por la que un predecesor del DAG de
// generación le pasará al executor N6 las fuentes ya resueltas de una variante (brief + persona +
// guion + facetas de selección). Vive en core (donde vive zod y el motor), NO en el worker: el
// worker no depende de zod, y el executor solo debe llamar a una función PURA que valide+seleccione.
//
// EN T3.5 NINGÚN NODO EMITE `N6-sources` todavía (el DAG de generación es F4), así que en el run real
// N6 se salta (inaplicable). Pero el contrato y su resolución se declaran y testean aquí para que el
// executor llame de VERDAD al motor cuando reciba las fuentes —no es un stub muerto— y F4 solo tenga
// que cablear el productor.
import { z } from 'zod';
import { ProductBriefSchema } from '../contracts/product-brief';
import { AdScriptSchema } from '../contracts/ad-script';
import { PersonaSchema } from '../persona/contracts';
import type { GuardPackSeed, PromptTemplateSeed } from './contracts';
import { selectTemplate } from './select-template';
import type { CompileInput } from './compile-prompt';
import type { VariableSources } from './variable-sources';

/** El `output_refs` que un predecesor emite para que N6 compile la variante. */
export const N6SourcesSchema = z.object({
  node: z.literal('N6-sources'),
  brief: ProductBriefSchema,
  persona: PersonaSchema,
  /** El guion (T2.4): fuente de `hook.line`/`cta.line`. Opcional para compilar antes de guionizar. */
  script: AdScriptSchema.optional(),
  facets: z.object({
    hookAngle: z.string().optional(),
    format: z.string().optional(),
    /** Plataforma destino (`ad_variant.platform_targets[0]` en producción). */
    platform: z.string().min(1),
    aspect: z.string().optional(),
    durationSeconds: z.number().int().positive(),
  }),
});
export type N6Sources = z.infer<typeof N6SourcesSchema>;

/**
 * T5.12 — la selección tuvo que DEGRADAR una faceta para encontrar template. Viaja hasta el executor
 * para que emita un warning estructurado: la degradación es OBSERVABLE, nunca muda.
 */
export interface CompileDegradation {
  facet: 'vertical';
  /** El valor libre que ningún template reconoció (p.ej. `Cuidado de la piel`). */
  value: string;
  /** El template que ganó el pase degradado (para poder auditar qué se compiló de verdad). */
  templateSlug: string;
}

export type ResolveCompileInputResult =
  | { ok: true; input: CompileInput; degraded?: CompileDegradation }
  | { ok: false; error: 'invalid_sources' | 'no_template'; message: string };

/**
 * A partir de un `N6-sources` (ya parseado o crudo) + el catálogo sembrado, selecciona el template
 * por facetas §9.3 y arma el `CompileInput`. Función PURA que NO lanza: el executor decide qué hacer
 * con el error (marcar fallo permanente). `aspect` cae al `defaultAspect` del template si no viene.
 *
 * T5.12: si la `product.category` del brief es texto libre que ningún template reconoce, la selección
 * DEGRADA (ignora la vertical) en vez de morir, y el resultado llega con `degraded` puesto — el
 * executor lo registra como warning. Ver `select-template.ts`.
 */
export function resolveCompileInput(
  rawSources: unknown,
  templates: readonly PromptTemplateSeed[],
  guardPacks: readonly GuardPackSeed[],
): ResolveCompileInputResult {
  const parsed = N6SourcesSchema.safeParse(rawSources);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_sources', message: parsed.error.message };
  }
  const { brief, persona, script, facets } = parsed.data;
  const selection = selectTemplate(templates, {
    vertical: brief.product.category,
    hookAngle: facets.hookAngle,
    platform: facets.platform,
    format: facets.format,
  });
  if (selection.error !== undefined) {
    return { ok: false, error: 'no_template', message: selection.message };
  }
  const sources: VariableSources = {
    brief,
    persona,
    script,
    campaign: {
      platform: facets.platform,
      aspect: facets.aspect ?? selection.template.defaultAspect,
      durationSeconds: facets.durationSeconds,
    },
  };
  const input: CompileInput = { template: selection.template, sources, guardPacks };
  if (selection.relaxedFacet !== undefined && selection.unmatchedValue !== undefined) {
    return {
      ok: true,
      input,
      degraded: {
        facet: selection.relaxedFacet,
        value: selection.unmatchedValue,
        templateSlug: selection.template.slug,
      },
    };
  }
  return { ok: true, input };
}
