// Parser de OpenGraph / Twitter Card meta tags del HTML (research §1.5): el
// fallback universal cuando no hay Shopify `.json` ni JSON-LD `Product`.
// Determinista, sin red. Extrae `og:title`, `og:description`, `og:image` (puede
// repetirse — varias imágenes), `product:price:amount` + `product:price:currency`
// (Open Graph product namespace; a menudo AUSENTE — HEADLINE 2: solo og:title/image).
//
// Tolerante al mundo real: `property` o `name` como atributo, comillas simples o
// dobles, atributos en cualquier orden, self-closing o no. No parsea HTML entero:
// solo aísla las etiquetas <meta>.
import type { RawImage } from '../../contracts/raw-content';
import type { RawContentPartial } from './types';

// Aísla cada `<meta ...>` tolerando un `>` DENTRO de un valor entrecomillado
// (`<meta content="A > B">` es HTML válido y común). El cuerpo de la etiqueta es una
// secuencia de: literales entre comillas dobles, literales entre comillas simples, o
// cualquier carácter que no sea comilla ni el `>` de cierre. Así el `>` "libre" que
// cierra la etiqueta nunca se confunde con un `>` entrecomillado.
const META_TAG = /<meta\b(?:"[^"]*"|'[^']*'|[^"'>])*>/gi;

/** Extrae un atributo de una etiqueta `<meta ...>` (comillas simples o dobles). */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const m = re.exec(tag);
  return m?.[2] !== undefined ? m[2].trim() : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

/**
 * Parsea los meta OG del HTML. Devuelve `null` si no hay NINGUNA señal OG útil
 * (ni título ni imagen) — fuente ausente. Nunca lanza.
 */
export function parseOpenGraph(html: string): RawContentPartial | null {
  // Recolecta todos los pares (key → valores). `og:image` puede repetirse.
  const single = new Map<string, string>();
  const images: RawImage[] = [];

  for (const match of html.matchAll(META_TAG)) {
    const tag = match[0];
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase() ?? null;
    if (key === null) continue;
    const content = attr(tag, 'content');
    if (content === null) continue;
    const value = decodeEntities(content);
    if (value === '') continue;

    if (key === 'og:image' || key === 'og:image:url' || key === 'og:image:secure_url') {
      images.push({ url: value, alt: null });
    } else if (!single.has(key)) {
      // Primera aparición gana (og:title suele ser único; si se repite, la primera).
      single.set(key, value);
    }
  }

  const title = single.get('og:title') ?? single.get('twitter:title') ?? null;
  const description = single.get('og:description') ?? single.get('twitter:description') ?? null;
  const price = single.get('product:price:amount') ?? single.get('og:price:amount') ?? null;
  const currency = single.get('product:price:currency') ?? single.get('og:price:currency') ?? null;

  // Sin título NI imagen no hay señal OG aprovechable: fuente ausente.
  if (title === null && images.length === 0) return null;

  return {
    source: 'opengraph',
    title,
    description,
    price,
    currency,
    images: images.length > 0 ? images : undefined,
  };
}
