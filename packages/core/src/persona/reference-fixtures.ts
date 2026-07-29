// CARGA DE FOTOS IA COMMITEADAS COMO FIXTURES + MEDIDA DE ENTROPÍA DE UNA REFERENCE (T5.19).
//
// EL DEFECTO QUE CIERRA: la persona batch-capable del seed (Maya) llega a N7c (avatar/OmniHuman), que
// ANIMA su reference_image. Cuando esa reference era el placeholder ABSTRACTO de sharp (rect+banda+circle),
// OmniHuman lo animó fielmente → sujeto alucinado (el chibi masculino del primer máster real, 2026-07-26).
// El fix: para las personas batch-capable el seed carga FOTOS IA reales (`reference-fixtures/*.png`,
// generadas una vez con la receta de T4.12) en vez de dibujar con sharp. Este módulo es la carga de esos
// bytes + la métrica que un test permanente usa para EXIGIR que sean fotos (no un placeholder abstracto).
//
// POR QUÉ VIVE EN `persona/server` (Node) Y NO EN EL BARREL BROWSER: usa `node:fs` + sharp. El barrel
// `@ugc/core/persona` lo importa el navegador; este módulo solo lo consumen procesos Node (el seed de
// `@ugc/db` y su test de integración). Misma frontera que `reference-image.ts`/`validate-reference-image.ts`.
//
// RESOLUCIÓN DE PATH — `new URL('./reference-fixtures/<literal>.jpg', import.meta.url)` POR FICHERO: el
// seed corre desde tres contextos (vitest, `pnpm seed` vía tsx, y el ARRANQUE de `apps/web` donde Next
// (Turbopack) hace file-tracing del código de servidor). Un path relativo al cwd fallaría en el boot de web;
// `import.meta.url` lo ancla al MÓDULO. CADA fixture se referencia con su path ENTERO y literal — NO un
// `new URL(dir, import.meta.url)` seguido de concatenación: Turbopack resuelve un `new URL` estático como
// un ASSET rastreable, pero un URL de DIRECTORIO lo intenta resolver como módulo y ROMPE el build («Can't
// resolve './reference-fixtures/'»). El literal por fichero es lo que hace que el asset viaje al bundle.
//
// LOS FIXTURES SON JPEG (T5.19, fix del FAIL de VERIFY): las fotos IA se commitean recodificadas a JPEG q85
// (0,20–0,31 MB, de 5,3–6,0 MB en PNG) para que N7c pueda DESCARGARLAS — el PNG de ~6 MB daba
// `file_download_error` en fal. Mismo sujeto, mismas dimensiones (1536×2752), entropía intacta (6,4–7,1).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/** URL de CADA fixture, anclada al módulo con path literal completo (rastreable por Turbopack como asset).
 *  Las claves son los nombres que `seed-data.ts` declara en `referenceFixtures`. Añadir un fixture nuevo =
 *  una entrada literal aquí (no se resuelve un directorio en runtime). */
const FIXTURE_URLS: Readonly<Record<string, URL>> = {
  'maya-frontal-headshot.jpg': new URL(
    './reference-fixtures/maya-frontal-headshot.jpg',
    import.meta.url,
  ),
  'maya-three-quarter-portrait.jpg': new URL(
    './reference-fixtures/maya-three-quarter-portrait.jpg',
    import.meta.url,
  ),
  'maya-full-body.jpg': new URL('./reference-fixtures/maya-full-body.jpg', import.meta.url),
};

/**
 * Carga los bytes de un fixture de foto IA por su nombre de fichero (el que declara `referenceFixtures`
 * en `seed-data.ts`). LANZA si el nombre no está registrado en `FIXTURE_URLS` o el fichero no existe — un
 * fixture ausente NO debe degradar en silencio a «sin foto»: es un error de seed que hay que ver (el mismo
 * criterio anti-T1.8 del resto del seed).
 */
export async function loadReferenceFixture(filename: string): Promise<Uint8Array> {
  const url = FIXTURE_URLS[filename];
  if (url === undefined) {
    throw new Error(
      `loadReferenceFixture: «${filename}» no está registrado en FIXTURE_URLS (añade su path literal)`,
    );
  }
  const buf = await readFile(fileURLToPath(url));
  return new Uint8Array(buf);
}

// ── MÉTRICA DE «ES UNA FOTO, NO UN PLACEHOLDER ABSTRACTO» ────────────────────────────────────────────
//
// SHANNON ENTROPY del canal de luminancia (sharp la calcula sobre la imagen entera, en bits/píxel 0–8).
// Una FOTO tiene detalle en cada región → entropía alta (típ. >6.5 bits). El placeholder de sharp es un
// rect de color plano + una banda + un círculo semitransparente → poquísima información → entropía baja
// (típ. <2 bits). Se ELIGIÓ entropía sobre «nº de colores únicos» porque el antialias del círculo del
// placeholder puede producir CIENTOS de colores en el borde (un recuento de colores los contaría y
// acercaría las dos clases); la entropía pondera por ÁREA, así que un borde antialiaseado fino apenas la
// mueve. Ver `reference-fixtures.test.ts` para los valores medidos de ambas clases y el umbral elegido.

/**
 * Entropía de Shannon (bits/píxel, 0–8) de una imagen — la métrica de «cuánta información lleva». Se lee
 * de `sharp().stats()` (canal de luminancia), no se reimplementa. Determinista para unos bytes dados.
 */
export async function referenceImageEntropy(bytes: Uint8Array): Promise<number> {
  const stats = await sharp(Buffer.from(bytes)).stats();
  return stats.entropy;
}

/**
 * EL FLOOR DE ENTROPÍA que separa «foto» de «placeholder abstracto de sharp» (T5.19). MEDIDO (2026-07-29):
 *   · fotos IA de Maya (los 3 fixtures): 6.44 / 6.93 / 7.14 bits — muy por encima.
 *   · placeholder de sharp (`makeSyntheticReferenceImage`, varias seeds): ~1.41 bits — muy por debajo.
 * 5.0 cae en el hueco con margen HOLGADO a ambos lados: >1.4 bits bajo la foto MÁS pobre (6.44) y >3.5 bits
 * sobre el placeholder. Ninguna foto real cae por debajo, ningún placeholder abstracto sube por encima. El
 * test permanente mide ambas clases y verifica que este umbral las separa sin falsos positivos (control
 * positivo = la foto pasa; negativo = el placeholder de sharp falla).
 */
export const REFERENCE_PHOTO_ENTROPY_FLOOR = 5.0;

// EL TECHO DE TAMAÑO `REFERENCE_MAX_BYTES` vive AHORA en `reference-image.ts` (es una constante de
// PRODUCCIÓN: la aplica `normalizeReferenceImage` en el path de escritura, no solo estos tests). Se re-exporta
// aquí para los tests que ya lo importaban de `reference-fixtures` — sin mover sus imports.
export { REFERENCE_MAX_BYTES } from './reference-image';
