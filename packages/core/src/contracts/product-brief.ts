// Contrato central del pipeline (PRD §7.4, Apéndice A): el ProductBrief editable
// que produce la síntesis (T1.8) y consumen matriz/guiones. Traducción fiel del
// JSON Schema de `research/07 §4.3` a Zod, con las TRES divergencias obligatorias
// del Apéndice A (líneas 768-772):
//   1. `meta.platform` añade el valor `manual` (modo texto libre) al enum de §12.
//   2. `meta.source_url` es nullable — null cuando `platform = manual`.
//   3. Cardinalidades (5–10 ángulos, 2–3 hooks, ≤4 segments, ≤5 quotes) viven SOLO
//      en Zod (`.min()/.max()`), no en el espejo JSON Schema (la API de Anthropic
//      ignora los constraints de array — architecture.md §4).
// Regla de diseño (Apéndice A): campos extractivos llevan `evidence` (cita textual);
// inferenciales, justificación/confidence; sin recursión (limitación de Anthropic).
import { z } from 'zod';

// Enums compartidos entre `angles[]`, `audience` y `brand` (definidos una vez).
export const AwarenessLevelSchema = z.enum([
  'unaware',
  'problem_aware',
  'solution_aware',
  'product_aware',
  'most_aware',
]);
export type AwarenessLevel = z.infer<typeof AwarenessLevelSchema>;

/** Tono del anuncio: mapea 1:1 al parámetro `tone` del generador (Apéndice A). */
export const AdToneSchema = z.enum([
  'energetic',
  'professional',
  'friendly',
  'luxury',
  'funny',
  'authentic',
  'dramatic',
]);
export type AdTone = z.infer<typeof AdToneSchema>;

/**
 * Plataforma de origen (§12 `url_analysis.platform`, con la divergencia 1 del
 * Apéndice A): `manual` es el modo texto libre sin URL. El §4.3 de research lista
 * `unknown`; el enum canónico del PRD (§12 línea 463) NO lo incluye — se adopta el
 * del PRD como fuente de verdad (jerarquía PRD > research), con `manual` añadido.
 */
export const PlatformSchema = z.enum(['shopify', 'woocommerce', 'custom', 'amazon', 'manual']);
export type Platform = z.infer<typeof PlatformSchema>;

// Enums de clasificación de imagen COMPARTIDOS por el asset del brief
// (`assets.images[]`) y la salida del VLM (`ClassifiedImage` en visual-analysis.ts):
// misma taxonomía en ambos lados, un solo sitio para que no deriven (un `kind` nuevo
// en uno y no en el otro haría que el synthesizer rechace una clasificación válida).
// Se comparten los ENUMS, no los objetos: la optionality difiere a propósito.
export const ImageKindSchema = z.enum([
  'packshot',
  'lifestyle',
  'detail',
  'before_after',
  'infographic',
  'chart_or_text',
  'other',
]);
export const ImageBackgroundSchema = z.enum(['clean', 'busy', 'transparent', 'unknown']);
export const VideoSuitabilitySchema = z.enum(['hero', 'broll', 'unusable']);

const MetaBaseSchema = z.object({
  // Divergencia 2: nullable. La regla source_url null ⟺ platform=manual se aplica
  // con un `.superRefine` a nivel de `meta` (no representable en JSON Schema, como
  // las cardinalidades — vive SOLO en Zod).
  source_url: z.string().nullable(),
  platform: PlatformSchema,
  language: z.string(),
  extracted_at: z.string(),
  extraction_confidence: z.enum(['high', 'medium', 'low']),
  warnings: z.array(z.string()).optional(),
});

export const BriefMetaSchema = MetaBaseSchema.superRefine((meta, ctx) => {
  // El bicondicional del Apéndice A: en modo manual NO hay URL; con URL el modo no
  // es manual. Un solo constraint cubre las dos direcciones inválidas del brief.
  if (meta.platform === 'manual' && meta.source_url !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['source_url'],
      message: 'source_url debe ser null cuando platform = manual',
    });
  }
  if (meta.platform !== 'manual' && meta.source_url === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['source_url'],
      message: 'source_url es obligatorio salvo en modo manual',
    });
  }
});
export type BriefMeta = z.infer<typeof BriefMetaSchema>;

const FeatureSchema = z.object({
  feature: z.string(),
  evidence: z.string().nullable(), // extractivo: cita textual de la página
});

export const BriefProductSchema = z.object({
  name: z.string(),
  brand_name: z.string().nullable().optional(),
  category: z.string(),
  subcategory: z.string().nullable().optional(),
  one_liner: z.string(),
  description: z.string(),
  features: z.array(FeatureSchema),
  how_it_works: z.string().nullable().optional(),
  variants: z.array(z.string()).optional(),
});

const BenefitSchema = z.object({
  benefit: z.string(),
  linked_feature: z.string().nullable(),
  emotional_outcome: z.string(),
  type: z.enum(['functional', 'emotional', 'social', 'economic']),
});

const SegmentSchema = z.object({
  name: z.string(),
  demographics: z.string(),
  psychographics: z.string(),
  awareness_level: AwarenessLevelSchema,
  usage_context: z.string().nullable().optional(),
  avatar_hint: z.string(),
});

export const BriefAudienceSchema = z.object({
  primary_segment: z.string(),
  // Cardinalidad ≤4 (divergencia 3): solo Zod.
  segments: z.array(SegmentSchema).max(4),
  not_for: z.string().nullable().optional(),
});

const PainPointSchema = z.object({
  pain: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  current_alternative: z.string().nullable(),
  evidence: z.string().nullable().optional(),
});

const ObjectionSchema = z.object({
  objection: z.string(),
  type: z.enum(['price', 'skepticism', 'friction', 'risk', 'timing', 'trust']),
  counter: z.string(),
  counter_source: z.enum(['on_page', 'inferred']),
});

const QuoteSchema = z.object({
  quote: z.string(),
  author: z.string().nullable().optional(),
});

export const BriefSocialProofSchema = z.object({
  rating: z.number().nullable(),
  review_count: z.number().int().nullable(),
  // Cardinalidad ≤5 (divergencia 3): solo Zod.
  quotes: z.array(QuoteSchema).max(5),
  badges: z.array(z.string()),
  stats: z.array(z.string()),
});

const VisualStyleSchema = z.object({
  palette: z.array(z.string()), // hex colors
  typography: z.string().nullable().optional(),
  aesthetic: z.string(),
  photography_style: z.string().nullable().optional(),
});

export const BriefBrandSchema = z.object({
  tone_of_voice: z.string(),
  recommended_ad_tone: AdToneSchema,
  visual_style: VisualStyleSchema,
  banned_or_risky_claims: z.array(z.string()).optional(),
});

export const BriefPricingSchema = z.object({
  price: z.string().nullable(),
  currency: z.string().nullable(),
  compare_at_price: z.string().nullable().optional(),
  active_offer: z.string().nullable().optional(),
  guarantee: z.string().nullable().optional(),
  shipping: z.string().nullable().optional(),
  positioning: z.enum(['budget', 'mid-range', 'premium', 'luxury']),
});

/** Imagen reutilizable clasificada (research §2 faceta 9): decide el frame inicial
 *  de image-to-video en fal.ai. */
const BriefImageSchema = z.object({
  url: z.string(),
  kind: ImageKindSchema,
  has_overlay_text: z.boolean().optional(),
  background: ImageBackgroundSchema.optional(),
  video_suitability: VideoSuitabilitySchema,
});

export const BriefAssetsSchema = z.object({
  hero_image_url: z.string().nullable(),
  images: z.array(BriefImageSchema),
  video_urls: z.array(z.string()).optional(),
});

/** Un ángulo ≈ un anuncio candidato: puente hacia la generación. `suggested_tone`
 *  mapea 1:1 al parámetro `tone` del generador; `suggested_assets` a las imágenes
 *  de image-to-video (Apéndice A). */
export const AngleSchema = z.object({
  name: z.string(),
  framework: z.enum([
    'pain_point',
    'transformation',
    'social_proof',
    'curiosity',
    'us_vs_them',
    'unboxing_demo',
    'offer_urgency',
    'myth_busting',
    'identity',
    'founder_story',
  ]),
  target_segment: z.string(),
  awareness_level: AwarenessLevelSchema,
  // Cardinalidad 2–3 hooks (divergencia 3): solo Zod.
  hook_examples: z.array(z.string()).min(2).max(3),
  key_message: z.string(),
  objection_addressed: z.string().nullable().optional(),
  social_proof_used: z.string().nullable().optional(),
  cta: z.string(),
  suggested_tone: AdToneSchema,
  suggested_assets: z.array(z.string()).optional(),
});
export type Angle = z.infer<typeof AngleSchema>;

/**
 * El ProductBrief completo (Apéndice A). Cardinalidad de ángulos 5–10 (divergencia
 * 3) SOLO en Zod: `.min(5).max(10)` es la única línea que la garantiza — la API de
 * Anthropic la ignoraría, y el `safeParse` tras la llamada es la red de seguridad
 * real (architecture.md §4, unit-core.md §3).
 */
export const ProductBriefSchema = z.object({
  meta: BriefMetaSchema,
  product: BriefProductSchema,
  benefits: z.array(BenefitSchema),
  audience: BriefAudienceSchema,
  pain_points: z.array(PainPointSchema),
  objections: z.array(ObjectionSchema),
  social_proof: BriefSocialProofSchema,
  brand: BriefBrandSchema,
  pricing: BriefPricingSchema,
  assets: BriefAssetsSchema,
  angles: z.array(AngleSchema).min(5).max(10),
});
export type ProductBrief = z.infer<typeof ProductBriefSchema>;
