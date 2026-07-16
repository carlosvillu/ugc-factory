// Constructor del PROMPT de packshot (T4.4, N7a · ruta `ai_packshot`, §7.2). Lógica PURA: de la
// descripción del producto del brief → el prompt text-to-image que va a `fal-ai/flux-2`. Vive en
// core (no en el worker) porque es determinista y sin red: se testea sin levantar nada.
//
// QUÉ ES UN PACKSHOT SINTÉTICO. La ruta `ai_packshot` existe para el caso "no hay fotos del
// producto" (CP1 §7.2 N3): en vez de una foto real, se GENERA una imagen limpia del producto para
// usarla como material del anuncio. Por eso el prompt describe un PACKSHOT de estudio (producto
// aislado, fondo neutro, luz suave), 9:16 vertical, sin texto ni logos incrustados — no una escena
// UGC con persona (eso es N7c/N7d). El aspecto 9:16 lo fija el `image_size` del payload (flux-2 no
// tiene adapter que lo derive), no este texto; aun así lo mencionamos para reforzar la composición.
import type { ProductBrief } from '../contracts';

/** Un shot de packshot vive dentro de un rango acotado (§7.5-ish): 2 o 3 imágenes por generación de
 *  N7a. Se exporta para que el config Zod del executor lo reuse en vez de duplicar los límites. */
export const PACKSHOT_MIN_SHOTS = 2;
export const PACKSHOT_MAX_SHOTS = 3;

/** Recorta un texto libre a un tamaño razonable para el prompt: la `description` del brief puede ser
 *  larga y el prompt de una imagen no gana nada más allá de un par de frases. No es validación (el
 *  brief ya validó): es higiene del prompt. */
function trimForPrompt(value: string, maxChars: number): string {
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars).trimEnd()}…`;
}

/**
 * Construye el prompt de packshot a partir del `ProductBrief`. Toma la identidad del producto
 * (`name`, `brand_name`, `category`, `one_liner`, `description`) y, si el brief trae estilo visual,
 * la paleta y la estética para que el packshot no choque con la marca. El resultado es un prompt de
 * FOTOGRAFÍA DE PRODUCTO limpia, 9:16 vertical, apta para material UGC.
 *
 * Determinista: mismo brief → mismo prompt (base del `content_hash`; los shots individuales se
 * diferencian por `seed`, no por el prompt).
 */
export function buildPackshotPrompt(brief: ProductBrief): string {
  const { product, brand } = brief;

  const nameWithBrand = product.brand_name ? `${product.brand_name} ${product.name}` : product.name;

  // Núcleo: qué es el producto. `one_liner` da el gancho corto; `description` el detalle (recortado).
  const identity = [
    `Product packshot of "${nameWithBrand}"`,
    `a ${product.category}`,
    trimForPrompt(product.one_liner, 160),
    trimForPrompt(product.description, 240),
  ]
    .filter((s) => s.length > 0)
    .join('. ');

  // Estilo de estudio: lo que hace que sea un PACKSHOT y no una escena. Fijo, no depende del brief.
  const studio =
    'Clean studio product photography, single product centered and isolated, neutral seamless ' +
    'background, soft diffused lighting, sharp focus, high detail, realistic materials, ' +
    'e-commerce hero shot suitable for UGC ads';

  // Encuadre: 9:16 vertical. El `image_size` del payload es quien MANDA (flux-2 sin adapter); esto
  // solo refuerza la composición para que el modelo componga en vertical.
  const framing = 'Vertical 9:16 composition, full product visible, generous negative space';

  // Estilo de marca (opcional): paleta y estética del brief, si están, para no desentonar.
  const brandBits: string[] = [];
  const palette = brand.visual_style.palette.filter((c) => c.trim().length > 0);
  if (palette.length > 0) {
    brandBits.push(`brand color palette: ${palette.slice(0, 4).join(', ')}`);
  }
  const aesthetic = brand.visual_style.aesthetic.trim();
  if (aesthetic.length > 0) brandBits.push(`aesthetic: ${trimForPrompt(aesthetic, 120)}`);
  const brandStyle = brandBits.length > 0 ? `. ${brandBits.join('; ')}` : '';

  // Exclusiones: nada de texto/logos incrustados ni personas (el packshot es solo el producto).
  const negatives = 'No text, no watermark, no logo overlay, no people, no hands';

  return `${identity}. ${studio}. ${framing}${brandStyle}. ${negatives}.`;
}
