// Contratos de la LIBRERÍA sembrada (T2.1): las líneas de hook, las líneas de CTA y
// las 3 recetas por tier. Son los shapes que el validador de seeds (`validateSeeds`)
// comprueba ANTES de que nada toque la BD, y que el script `pnpm seed` inserta.
//
// Por qué el contrato vive en core y no en db: es lógica PURA (§ architecture.md §1)
// y el consumidor real de las recetas es el ESTIMADOR DE COSTE de T2.2, que también
// vive en core. db solo persiste lo que este contrato declara válido.
import { z } from 'zod';

/** Los tres tiers del Apéndice B. Espejo del enum nativo `recipe_tier` de @ugc/db. */
export const RecipeTierSchema = z.enum(['test', 'standard', 'premium']);
export type RecipeTier = z.infer<typeof RecipeTierSchema>;

/** Objetivo del lote (§12 `ad_batch.objective`), y la clave por la que se elige una CTA. */
export const AdObjectiveSchema = z.enum(['hook_test', 'conversion', 'story']);
export type AdObjective = z.infer<typeof AdObjectiveSchema>;

/**
 * Idiomas que cubre el seed inicial (§17: "el seed inicial cubre es + en"). NO es el
 * conjunto de idiomas soportados por el producto — `hook_line.language` es `text` en la
 * BD precisamente para que añadir un idioma no exija migración. Este enum acota lo que
 * ESTA librería sembrada declara.
 */
export const SeedLanguageSchema = z.enum(['es', 'en']);
export type SeedLanguage = z.infer<typeof SeedLanguageSchema>;

/**
 * Los ángulos bajo los que se cataloga un hook. Es la taxonomía de la librería curada
 * (los ángulos que la IA inventa por brief son texto libre: `ProductBrief.angles[].name`).
 * Un hook SIN ángulo no es seleccionable por el compositor de matriz de T2.2 — que elige
 * hooks POR ángulo — y por eso el ángulo es obligatorio y de vocabulario cerrado aquí.
 */
export const HookAngleSchema = z.enum([
  'pain_point',
  'curiosity',
  'social_proof',
  'authority',
  'transformation',
  'objection',
  'urgency',
  'comparison',
]);
export type HookAngle = z.infer<typeof HookAngleSchema>;

/** Verticales para las que una línea es apropiada. `[]` = agnóstica (el caso normal). */
export const VerticalSchema = z.enum(['beauty', 'fitness', 'saas', 'food', 'home', 'fashion']);
export type Vertical = z.infer<typeof VerticalSchema>;

/**
 * Una línea de hook de la librería (§12 `hook_line`). `text` es INTERPOLABLE: puede
 * llevar placeholders `{product}` / `{benefit}` / `{pain}` que el ScriptWriter (T2.4)
 * resuelve con datos del brief.
 *
 * El techo de palabras NO se comprueba aquí (Zod) sino en `validateSeeds`, que reusa
 * `MAX_HOOK_WORDS` (T1.9 — una sola definición del techo en el sistema) y lo aplica al
 * PEOR CASO RENDERIZADO: literal + el presupuesto de palabras de cada placeholder
 * (`placeholders.ts`). Lo que tiene que caber en los 0–3 s del anuncio es lo que el
 * espectador OYE, no la plantilla.
 */
export const HookLineSeedSchema = z.object({
  angle: HookAngleSchema,
  text: z.string().min(1),
  verticals: z.array(VerticalSchema).default([]),
  language: SeedLanguageSchema,
});
export type HookLineSeed = z.infer<typeof HookLineSeedSchema>;

/** Una línea de CTA de la librería (§12 `cta_line`). Se elige por objetivo del lote. */
export const CtaLineSeedSchema = z.object({
  objective: AdObjectiveSchema,
  text: z.string().min(1),
  language: SeedLanguageSchema,
});
export type CtaLineSeed = z.infer<typeof CtaLineSeedSchema>;

/**
 * Un paso de la receta: el componente del vídeo (§12 `recipe.steps`, Apéndice B lo tabula
 * como Avatar / B-roll / Voz / Shots) y el modelo que lo cubre en ese tier.
 *
 * `model`: hoy la ETIQUETA del Apéndice B (p. ej. "Kling AI Avatar v2 Std"). La tabla
 * `model_profile` (F3) todavía no existe; T3.4 —que "recalibra las `recipe` sembradas en
 * T2.1"— es quien lo recableará a un `model_profile_id` real. `params` queda para esa
 * recalibración (duración de clip, resolución…): opcional hoy.
 */
export const RecipeStepSeedSchema = z.object({
  component: z.enum(['avatar', 'broll', 'voice', 'shots']),
  model: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type RecipeStepSeed = z.infer<typeof RecipeStepSeedSchema>;

/**
 * Una receta por tier (§12 `recipe`, Apéndice B).
 *
 * EL COSTE ES UN RANGO EN CÉNTIMOS ENTEROS, no un punto (ver la nota larga en
 * `packages/db/src/schema/gallery.ts`): el Apéndice B da horquillas ($0,3–1,7 · $1,8–5 ·
 * $9–13) y el estimador de T2.2 debe poder enseñar la horquilla al usuario y cuadrar
 * ±10 % contra el Apéndice. Del rango se deriva el punto medio; del punto medio no se
 * recupera el rango.
 *
 * Invariantes que el schema hace IMPOSIBLE violar:
 *  - los dos costes son enteros POSITIVOS (`> 0`): una receta "sin coste" (0, ausente,
 *    null) es exactamente el fixture inválido que el validador debe rechazar;
 *  - `min <= max` (un rango invertido es un dato corrupto, no una receta).
 */
export const RecipeSeedSchema = z
  .object({
    tier: RecipeTierSchema,
    steps: z.array(RecipeStepSeedSchema).min(1),
    estCost30sMinCents: z.number().int().positive(),
    estCost30sMaxCents: z.number().int().positive(),
    notes: z.string().optional(),
  })
  .refine((r) => r.estCost30sMinCents <= r.estCost30sMaxCents, {
    message: 'estCost30sMinCents debe ser <= estCost30sMaxCents',
    path: ['estCost30sMaxCents'],
  });
export type RecipeSeed = z.infer<typeof RecipeSeedSchema>;
