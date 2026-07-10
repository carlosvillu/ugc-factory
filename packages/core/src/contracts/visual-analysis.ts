// Contrato `VisualAnalysis` del pipeline (PRD §7.4, §9.1 P3). Es la salida del paso
// de visión (research/07 §4.3 y §5 P3): clasifica las imágenes de producto para
// image-to-video (fal.ai pide `image_url`), extrae el tono visual de marca y
// detecta social proof renderizado por JS. Alimenta al sintetizador (T1.8), que lo
// funde con RawContent en el ProductBrief.
//
// En modo `manual` no hay screenshot ni imágenes que analizar: el paso de visión se
// omite y `images` queda vacío (contrato v1 — el consumidor decide si lo salta).
import { z } from 'zod';
import { ImageKindSchema, ImageBackgroundSchema, VideoSuitabilitySchema } from './product-brief';

/** Una imagen ya CLASIFICADA por el VLM (mismos enums que `assets.images[]` del
 *  ProductBrief, research §4.3 — compartidos desde product-brief.ts): `kind`, señales
 *  de reutilización y el veredicto `video_suitability` (hero = válida como frame
 *  inicial de i2v 9:16). Aquí `background` es REQUERIDO (el VLM siempre lo emite); en
 *  el brief es opcional — se comparten los enums, no la optionality. */
export const ClassifiedImageSchema = z.object({
  url: z.string(),
  kind: ImageKindSchema,
  has_overlay_text: z.boolean(),
  background: ImageBackgroundSchema,
  video_suitability: VideoSuitabilitySchema,
});
export type ClassifiedImage = z.infer<typeof ClassifiedImageSchema>;

/** Tono visual de marca leído del screenshot (research §2 faceta 7): lo que no está
 *  en el DOM como texto — paleta, estética, fotografía. */
export const VisualBrandStyleSchema = z.object({
  palette: z.array(z.string()), // hex colors
  aesthetic: z.string(), // minimal / premium / playful / clinical / earthy…
  photography_style: z.string().nullable().optional(),
});
export type VisualBrandStyle = z.infer<typeof VisualBrandStyleSchema>;

/** Social proof que solo se ve renderizado (widgets de reviews JS, research §1.4):
 *  rating agregado y citas capturadas visualmente. */
export const RenderedSocialProofSchema = z.object({
  rating: z.number().nullable().optional(),
  review_count: z.number().int().nullable().optional(),
  quotes: z.array(z.string()).optional(),
});
export type RenderedSocialProof = z.infer<typeof RenderedSocialProofSchema>;

/** Salida completa del análisis visual. `hero_image_url` es el veredicto directo:
 *  la mejor imagen para i2v (o null si ninguna sirve / modo manual). */
export const VisualAnalysisSchema = z.object({
  images: z.array(ClassifiedImageSchema),
  hero_image_url: z.string().nullable(),
  brand_style: VisualBrandStyleSchema.nullable().optional(),
  rendered_social_proof: RenderedSocialProofSchema.nullable().optional(),
});
export type VisualAnalysis = z.infer<typeof VisualAnalysisSchema>;
