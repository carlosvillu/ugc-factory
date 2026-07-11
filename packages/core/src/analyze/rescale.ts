// Reescalado de imágenes ANTES de mandarlas a la API de visión (T1.7, research/07 §5 P3:
// "screenshot full-page reescalado ≤1080p"). Es COST-CRITICAL, no cosmético: el long-edge
// cap de Haiku 4.5 es ~1568px; si se manda el screenshot RAW (el de oatly era 1920×4453),
// Anthropic lo reescala server-side y FACTURA la imagen completa (hasta ~4784 tokens de
// imagen). Reescalar CLIENT-SIDE a ≤1080p es lo que mantiene el paso <$0,02 (Verificación).
//
// Vive en core (no en web) porque es lógica PURA sobre bytes — sin I/O de datos (la frontera
// prohibida de core es BD/cola, no CPU). Usa `sharp` (nativo, rápido; dep deliberada de T1.7).
import sharp from 'sharp';

/** Techo del lado largo (px) al que se reescala. 1080p = el valor de research §5 P3 y un
 *  buen equilibrio coste/fidelidad para visión (skill claude-api, computer-use §). Por
 *  debajo del cap ~1568 de Haiku ⇒ Anthropic NO vuelve a reescalar server-side ⇒ se
 *  factura la imagen ya reducida, no la original. */
export const MAX_LONG_EDGE_PX = 1080;

/** Bytes de una imagen con su mime, listos para mandar como bloque `image` base64 o para
 *  persistir. Espeja `ScreenshotBytes` del ingester N2 (T1.4). */
export interface ImageBytes {
  data: Uint8Array;
  mime: string;
}

/** Dimensiones de una imagen (px). */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Reescala `input` para que su lado LARGO no supere `maxLongEdge` (default 1080), preservando
 * el aspect ratio. Si la imagen ya cabe (ambos lados ≤ cap), se re-codifica sin ampliar
 * (`withoutEnlargement` evita upscaling de una imagen pequeña — no hay nada que ganar y
 * añadiría bytes). Devuelve SIEMPRE PNG (mime estable para el bloque de visión; el screenshot
 * de Firecrawl ya es PNG y las imágenes de producto se homogenizan). Función PURA: sin red,
 * sin I/O de datos — solo transforma bytes en memoria.
 *
 * Un `input` corrupto/no-imagen hace que `sharp` LANCE: el caller lo trata como "no hay
 * imagen usable" (se salta esa entrada), no como crash del paso.
 */
export async function rescaleImage(
  input: Uint8Array,
  maxLongEdge: number = MAX_LONG_EDGE_PX,
): Promise<ImageBytes> {
  const out = await sharp(Buffer.from(input))
    // `fit: 'inside'` + `withoutEnlargement` ⇒ encoge al cuadro maxLongEdge×maxLongEdge
    // conservando ratio, y NO amplía si ya cabe. Basta pasar el cap a ambos lados: el que
    // limita es el lado largo.
    .resize({
      width: maxLongEdge,
      height: maxLongEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  return { data: new Uint8Array(out), mime: 'image/png' };
}

/** Lee las dimensiones (px) de una imagen sin transformarla. Útil en tests para asertar
 *  que el reescalado dejó el lado largo ≤ cap (Verificación #6) sin inspeccionar la
 *  request interceptada. Lanza si `input` no es una imagen decodificable. */
export async function imageDimensions(input: Uint8Array): Promise<ImageDimensions> {
  const meta = await sharp(Buffer.from(input)).metadata();
  // `sharp` reporta width/height del stream de entrada (números, no opcionales en su tipo).
  return { width: meta.width, height: meta.height };
}
