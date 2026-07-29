// GENERACIÓN DE IMÁGENES DE REFERENCIA SINTÉTICAS (T2.0, decisión del usuario 2026-07-12).
//
// El seed de personas necesita imágenes de referencia REALES —ficheros PNG que el endpoint de
// upload pueda leer y medir— pero la generación IA de retratos consistentes (FLUX/Nano Banana)
// es F4 y CUESTA DINERO. Esta tarea es $0. Solución: PNGs sintéticos ≥2K generados con `sharp`
// (que ya es dependencia de core desde T1.7, `rescale.ts`).
//
// LO IMPORTANTE, Y ES EL PRINCIPIO 9 DE LA SKILL testing: estas imágenes NO se saltan la
// validación de dimensiones. Son ficheros PNG de verdad, de 2048 px de lado largo de verdad, y
// el seed los sube por el MISMO camino que el navegador (fichero → sharp lee sus dimensiones →
// se valida ≥2K). Si el umbral subiera a 4K mañana, el seed FALLARÍA — que es exactamente lo
// que debe pasar. Un fixture que "sabe" sus dimensiones sin que nadie las lea del fichero no
// prueba nada.
//
// Vive en core y no en test-utils porque el SEED de producción (`pnpm seed`) las usa: no es
// código de test. Es CPU pura sobre bytes, sin I/O de datos — la misma frontera que `rescale`.
import sharp, { type Sharp } from 'sharp';
import { AppError } from '../contracts/app-error';
import { MIN_REFERENCE_LONG_EDGE_PX } from './contracts';

// ── NORMALIZACIÓN DE UNA REFERENCE PARA QUE N7c PUEDA DESCARGARLA (T5.19, fix del FAIL de VERIFY) ──────
//
// EL DEFECTO (destapado al generar el clip de avatar real de Maya, 2026-07-29): N7c sube la reference a fal
// storage y pasa su URL como `image_url` a OmniHuman; fal la DESCARGA internamente para animarla. Con los
// PNG de ~5,9 MB de la 1ª entrega, fal devolvía `file_download_error` (422, 3 veces) — la URL era HTTP 200
// externamente, pero el fetcher interno de fal fallaba con ese fichero. Una reference que N7c NO PUEDE
// DESCARGAR es tan inútil como una que animaba un chibi: el fallo solo se movió de «sujeto alucinado» a
// «sin clip». La MISMA foto recomprimida a <1 MB completó el clip. ⇒ PROBABLEMENTE el tamaño en bytes; no
// aislado de dims/formato (el test de recompresión cambió bytes+dims+formato a la vez). El techo de 1 MiB
// es una defensa CONSERVADORA sobre esa conjetura, no una aislación confirmada.
//
// EL FIX: normalizar TODA reference antes de persistirla — recodificar a JPEG (que comprime una FOTO ~20×
// mejor que un PNG palettizado SIN perder profundidad de color, luego SIN hundir la entropía). Medido a q85
// sobre las fotos de Maya: 0,20–0,31 MB (de 5,3–6,0 MB) con entropía 6,4–7,1 (muy por encima del floor de
// 5,0). Se aplica en los TRES sitios que persisten una reference: el seed (`persona-seed.ts`), el upload por
// CRUD (`route.ts`) y la generación IA (`generate-persona-images.ts`) — si no, un usuario que suba su foto
// de 6 MB choca con el MISMO 422 y el defecto sigue vivo para todos menos Maya.
//
// DOS COSAS QUE UNA FOTO DE MÓVIL REAL EXIGE, y que los 3 fixtures ya-medidos de Maya NO ejercitan:
//   1. TECHO REAL: una foto de 24 MP (6000×4000) a q85 puede quedar >1 MiB. El techo `REFERENCE_MAX_BYTES`
//      debe aplicarse en el PATH DE ESCRITURA, no solo en un test sobre fixtures. Si tras recodificar sigue
//      por encima, se REDUCE el lado largo HACIA el floor de §11 (bajando calidad solo tras tocar el floor);
//      si aún no cabe, se RECHAZA con `validation_error` — nunca se persiste un fichero que N7c no descargue.
//   2. ORIENTACIÓN EXIF: una foto en retrato lleva `Orientation=6/8`; sharp NO la aplica al recodificar sin
//      `.autoOrient()`, y strippea el metadata de salida ⇒ la foto quedaría ROTADA 90° en el navegador y en
//      lo que N7c anima. `.autoOrient()` rota los píxeles según el tag y lo elimina.
//
// CONSECUENCIA DE 1+2: la normalización PUEDE cambiar las dimensiones (autoOrient transpone W/H; el shrink
// las reduce). Por eso `normalizeReferenceImage` devuelve AHORA las dimensiones LEÍDAS DEL BUFFER DE SALIDA,
// y cada call site persiste ESAS (no las de `validateReferenceImage(rawBytes)`, que describirían la imagen
// PRE-normalización — la misma clase de mentira que la columna `mime`). El guard ≥2K sobre el LADO LARGO es
// invariante a la transposición (max(w,h) sobrevive a intercambiar W/H), así que autoOrient no puede
// invalidar el guard: solo cambiar qué dims se reportan.

/** Calidad JPEG de la normalización. 85 es el punto donde una foto de retrato queda nítida, pesa <0,5 MB a
 *  2K y conserva la entropía muy por encima del floor de foto. mozjpeg para el mejor ratio a igual calidad. */
const NORMALIZE_JPEG_QUALITY = 85;

/** Calidad mínima a la que se baja SOLO tras haber reducido el lado largo al floor de §11 y seguir por
 *  encima del techo. Por debajo de esto la foto se degrada de más; preferimos rechazar. */
const NORMALIZE_MIN_QUALITY = 60;

/**
 * Techo de bytes de una reference NORMALIZADA. Es una constante de PRODUCCIÓN (la aplica el path de
 * escritura, no solo los tests): un fichero por encima es el que fal/OmniHuman no logró descargar
 * (`file_download_error`). 1 MiB es conservador respecto a los 0,20–0,31 MB de las fotos de Maya.
 * `reference-fixtures.ts` lo RE-EXPORTA para los tests que ya lo importaban de ahí.
 */
export const REFERENCE_MAX_BYTES = 1024 * 1024;

/** El mime de una reference normalizada: SIEMPRE JPEG (el recodificado unifica el formato de salida). */
export const NORMALIZED_REFERENCE_MIME = 'image/jpeg';

/** El resultado de normalizar: los bytes JPEG Y sus dimensiones REALES (leídas del buffer de salida, que
 *  autoOrient/shrink pueden haber cambiado). El caller persiste ESTAS dims, no las del input. */
export interface NormalizedReferenceImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Recodifica a JPEG (autoOrient primero) con una calidad dada, y devuelve bytes + dims del output. */
async function encodeJpeg(pipeline: Sharp, quality: number): Promise<NormalizedReferenceImage> {
  const { data, info } = await pipeline
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), width: info.width, height: info.height };
}

/**
 * Normaliza los bytes de una imagen de referencia a un JPEG que N7c (fal/OmniHuman) puede DESCARGAR:
 *   1. `.autoOrient()`: aplica la orientación EXIF a los píxeles y elimina el tag (una foto de móvil en
 *      retrato ya no sale rotada 90°). Esto puede transponer W/H.
 *   2. recodifica a JPEG q85 (mozjpeg) preservando resolución.
 *   3. si el resultado supera `REFERENCE_MAX_BYTES`: reduce el lado largo HACIA `MIN_REFERENCE_LONG_EDGE_PX`
 *      (nunca por debajo); si en el floor aún no cabe, baja la calidad hasta `NORMALIZE_MIN_QUALITY`.
 *   4. si en (floor, calidad mínima) SIGUE por encima del techo → lanza `AppError('validation_error')`: la
 *      imagen no se puede hacer descargable sin romper el guard ≥2K. Nunca se persiste un fichero inconsumible.
 *
 * Pura sobre bytes (sin I/O de datos, como `makeSyntheticReferenceImage`/`rescale`). Devuelve bytes JPEG +
 * las dimensiones REALES de salida; el caller persiste con `NORMALIZED_REFERENCE_MIME` y ESAS dims.
 */
export async function normalizeReferenceImage(
  bytes: Uint8Array,
): Promise<NormalizedReferenceImage> {
  // El único error de rechazo: no se puede hacer descargable (≤ techo) sin bajar del guard ≥2K.
  const reject = (): never => {
    throw new AppError(
      'validation_error',
      `la imagen de referencia no se puede comprimir por debajo de ${String(REFERENCE_MAX_BYTES)} bytes manteniendo el lado largo ≥${String(MIN_REFERENCE_LONG_EDGE_PX)} px`,
      {
        formErrors: [
          'La imagen es demasiado pesada para procesarla. Sube una foto con menos resolución o menos detalle.',
        ],
        fieldErrors: {},
      },
    );
  };

  // INVARIANTE DE SALIDA: TODO return pasa por aquí. Un resultado solo es válido si cabe bajo el techo Y
  // conserva el lado largo ≥2K. La segunda mitad hace LOUD un caso que el shrink podría producir en silencio
  // (si el redondeo de `fit:'inside'` dejara el lado largo en 2047): en vez de persistir una reference que la
  // UI rechazaría, se rechaza aquí. Cierra la rama del clamp sin fabricar un input que aterrice justo en él.
  const acceptIfValid = (r: NormalizedReferenceImage): NormalizedReferenceImage => {
    if (r.bytes.byteLength > REFERENCE_MAX_BYTES) return reject();
    if (Math.max(r.width, r.height) < MIN_REFERENCE_LONG_EDGE_PX) return reject();
    return r;
  };

  // Paso 1+2: orienta y recodifica a resolución nativa. Un JPEG ya-normalizado (fixtures de Maya) no lleva
  // tag de orientación, así que autoOrient es un no-op sobre ellos → sigue siendo idempotente.
  let result = await encodeJpeg(sharp(Buffer.from(bytes)).autoOrient(), NORMALIZE_JPEG_QUALITY);
  if (result.bytes.byteLength <= REFERENCE_MAX_BYTES) return acceptIfValid(result);

  // Paso 3a: reduce el lado largo hacia el floor de §11, en escalones, a calidad plena. Trabaja sobre el
  // buffer YA orientado (dims de `result`), así que no hay que razonar si autoOrient corrió antes o después.
  const oriented = result.bytes;
  let longEdge = Math.max(result.width, result.height);
  while (result.bytes.byteLength > REFERENCE_MAX_BYTES && longEdge > MIN_REFERENCE_LONG_EDGE_PX) {
    longEdge = Math.max(MIN_REFERENCE_LONG_EDGE_PX, Math.floor(longEdge * 0.85));
    result = await encodeJpeg(
      sharp(Buffer.from(oriented)).resize({ width: longEdge, height: longEdge, fit: 'inside' }),
      NORMALIZE_JPEG_QUALITY,
    );
  }
  if (result.bytes.byteLength <= REFERENCE_MAX_BYTES) return acceptIfValid(result);

  // Paso 3b: ya en el floor de §11; baja la calidad (no las dims — no podemos ir por debajo de 2K). El bucle
  // es INCLUSIVO en `NORMALIZE_MIN_QUALITY`: la calidad mínima declarada SÍ se prueba antes de rechazar.
  const atFloor = result.bytes;
  for (let q = NORMALIZE_JPEG_QUALITY - 10; q >= NORMALIZE_MIN_QUALITY; q -= 5) {
    result = await encodeJpeg(sharp(Buffer.from(atFloor)), q);
    if (result.bytes.byteLength <= REFERENCE_MAX_BYTES) return acceptIfValid(result);
  }

  // Paso 4: imposible hacerla descargable sin bajar de 2K. El usuario debe subir una foto menos pesada.
  return reject();
}

/** Aspect ratio del retrato principal del identity lock: 4:5 vertical (es el que dibuja el
 *  mockup 6c y el encuadre natural de un retrato de referencia). */
const PORTRAIT_RATIO = 4 / 5;

/**
 * Un PNG sintético de retrato, con el lado largo en `longEdge` px (default: EXACTAMENTE el
 * umbral de §11, así que el seed produce la imagen mínima válida — si el umbral cambia, el
 * seed se mueve con él en vez de quedarse holgado y ciego).
 *
 * `seed` decide el tono: cada persona/encuadre sale de un color distinto, así que las dos
 * imágenes de una persona son distinguibles en la ficha sin ser aleatorias entre corridas
 * (determinista ⇒ el checksum del asset es estable ⇒ re-sembrar no cambia bytes).
 */
export async function makeSyntheticReferenceImage(
  seed: number,
  longEdge: number = MIN_REFERENCE_LONG_EDGE_PX,
): Promise<Uint8Array> {
  const height = longEdge;
  const width = Math.round(longEdge * PORTRAIT_RATIO);

  // Color determinista a partir del seed (HSL sobre la rueda, convertido a RGB entero).
  const hue = (seed * 67) % 360;
  const { r, g, b } = hslToRgb(hue, 0.35, 0.55);

  // Un rectángulo de color sólido + una banda diagonal más clara: suficiente para que las
  // referencias sean visualmente distinguibles entre sí en la ficha (mockup 6c) sin fingir
  // que son un retrato. NO se dibuja una cara: son placeholders explícitos.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">
    <rect width="100%" height="100%" fill="rgb(${String(r)},${String(g)},${String(b)})"/>
    <rect x="0" y="${String(Math.round(height * 0.62))}" width="100%" height="${String(Math.round(height * 0.38))}" fill="rgba(255,255,255,0.12)"/>
    <circle cx="${String(Math.round(width / 2))}" cy="${String(Math.round(height * 0.38))}" r="${String(Math.round(width * 0.22))}" fill="rgba(255,255,255,0.18)"/>
  </svg>`;

  const out = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Uint8Array(out);
}

/** HSL → RGB (0–255). Local: es aritmética de 6 líneas, no merece una dependencia. */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = sector(h, c, x);
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function sector(h: number, c: number, x: number): [number, number, number] {
  if (h < 60) return [c, x, 0];
  if (h < 120) return [x, c, 0];
  if (h < 180) return [0, c, x];
  if (h < 240) return [0, x, c];
  if (h < 300) return [x, 0, c];
  return [c, 0, x];
}
