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
import sharp from 'sharp';
import { MIN_REFERENCE_LONG_EDGE_PX } from './contracts';

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
