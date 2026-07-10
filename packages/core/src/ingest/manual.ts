// Síntesis del RawContent en modo MANUAL (T1.6, §7.4). Lógica PURA y determinista:
// sin red, sin BD, sin scraping. Es el SHORT-CIRCUIT del intake manual — NO pasa por
// `makeFastPathIngester` (que hace probe HTTP `.json`): el modo manual construye el
// RawContent directamente del texto que pegó el usuario y de las refs de imágenes ya
// subidas, y el route handler lo persiste con status='done' inmediatamente. CERO
// llamadas HTTP: el verifier LEE LOS LOGS y no debe ver ningún scraping.
//
// El bicondicional de modo de RawContent (raw-content.ts): en manual `source='manual'`,
// `url=null`, `platform='manual'`, `markdown = el texto`, `images = refs subidas`.
// `branding`/`product`/`screenshotRef` ausentes (no hay fast path que los derive).
import { RawContentSchema, type RawContent, type RawImage } from '../contracts/raw-content';

export interface SynthManualRawContentInput {
  /** El texto libre que pegó el usuario (ya trim-eado por el schema de intake). */
  text: string;
  /** Refs de imágenes ya subidas (URL de descarga + alt opcional). */
  imageRefs?: readonly { url: string; alt?: string | null }[];
}

/**
 * Construye el `RawContent` sintético del modo manual y lo valida contra su schema
 * (el bicondicional source/url/platform se comprueba aquí: un input incoherente
 * lanza en core, no llega a la BD). Determinista: mismo input → mismo output.
 */
export function synthManualRawContent(input: SynthManualRawContentInput): RawContent {
  const images: RawImage[] = (input.imageRefs ?? []).map((ref) => ({
    url: ref.url,
    alt: ref.alt ?? null,
  }));

  return RawContentSchema.parse({
    source: 'manual',
    url: null,
    platform: 'manual',
    markdown: input.text,
    images,
  });
}
