// Contrato `RawContent` del pipeline (PRD §7.4, §9.1). Es la salida del scraping/
// ingesta (P1 fast path + P2 render/scrape de research/07 §5) que consume el
// análisis. Su forma la fija `url_analysis.raw_content jsonb` (§12 línea 464):
// `markdown, images[], branding, product, screenshot_ref`, más el `source` (§12
// `url_analysis.source ENUM(url|manual)`).
//
// En modo `manual` (texto libre, §7.4): `source = 'manual'`, `url = null`, y el
// `markdown` ES el texto que el usuario pegó (contenido sintético); no hay
// `product`/`branding` de un fast path. En modo `url`: `url` presente y los formatos
// de Firecrawl (`product`, `branding`, `images`, `screenshotRef`) pueden venir.
//
// Contrato v1: sus consumidores (scraper T1.4, BriefValidator T1.9, sintetizador
// T1.8) lo afinarán; aquí se fija lo mínimo que el pipeline necesita transportar.
import { z } from 'zod';

import { PlatformSchema } from './product-brief';

/** Una imagen descubierta en la página (formato `images` de Firecrawl, research
 *  §1.1): URL cruda + alt opcional. La CLASIFICACIÓN (kind/video_suitability) es
 *  trabajo del análisis visual — vive en `VisualAnalysis`, no aquí. */
export const RawImageSchema = z.object({
  url: z.string(),
  alt: z.string().nullable().optional(),
});
export type RawImage = z.infer<typeof RawImageSchema>;

/** Design system extraído (formato `branding` de Firecrawl): colores, tipografía. */
export const RawBrandingSchema = z.object({
  palette: z.array(z.string()).optional(), // hex colors
  typography: z.string().nullable().optional(),
});
export type RawBranding = z.infer<typeof RawBrandingSchema>;

/** Extracción determinista e-commerce (formato `product`/fast path §5): título,
 *  precio, variantes, disponibilidad — sin coste LLM. Todo opcional: un fast path
 *  puede fallar o no aplicar (modo manual, página sin JSON-LD). */
export const RawProductSchema = z.object({
  title: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  availability: z.string().nullable().optional(),
  variants: z.array(z.string()).optional(),
});
export type RawProduct = z.infer<typeof RawProductSchema>;

const RawContentBaseSchema = z.object({
  source: z.enum(['url', 'manual']),
  // null en modo manual (texto libre sin dominio); presente en modo url.
  url: z.string().nullable(),
  // Plataforma clasificada (P0, research §5). En modo manual es `manual`.
  platform: PlatformSchema,
  // Contenido textual base. En modo manual ES el texto que pegó el usuario.
  markdown: z.string(),
  images: z.array(RawImageSchema),
  branding: RawBrandingSchema.nullable().optional(),
  product: RawProductSchema.nullable().optional(),
  // Referencia (storage_key) al screenshot full-page, si se capturó. No la imagen.
  screenshotRef: z.string().nullable().optional(),
});

/**
 * `RawContent` con el bicondicional de modo (coherente con `meta` del ProductBrief):
 * en modo `manual` no hay URL; con URL el modo no es manual. Fijado en Zod (no en
 * JSON Schema: RawContent no se envía a Anthropic como `output_config`, pero mantener
 * la regla en Zod protege el pipeline).
 */
export const RawContentSchema = RawContentBaseSchema.superRefine((raw, ctx) => {
  if (raw.source === 'manual') {
    if (raw.url !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'url debe ser null en modo manual',
      });
    }
    if (raw.platform !== 'manual') {
      ctx.addIssue({
        code: 'custom',
        path: ['platform'],
        message: 'platform debe ser manual en modo manual',
      });
    }
  } else {
    if (raw.url === null) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'url es obligatorio en modo url' });
    }
    if (raw.platform === 'manual') {
      ctx.addIssue({
        code: 'custom',
        path: ['platform'],
        message: 'platform no puede ser manual en modo url',
      });
    }
  }
});
export type RawContent = z.infer<typeof RawContentSchema>;
