// CHECK reutilizable de captions-in-safe-zone (T5.4) — CÓDIGO DE PRODUCCIÓN. Lo consumen:
//   · el QA N9 (`captions_safe_zone`) del pase final (T5.5): parsea el `.ass` que se va a quemar y afirma
//     que NINGÚN evento posiciona texto fuera del área útil universal;
//   · el script de verificación de T5.4 y de T8.3.
//
// VERIFICADOR INDEPENDIENTE, no autorreporte del generador: el box de cada evento se ESTIMA AQUÍ a partir
// de la posición DECLARADA en el `.ass` (`\pos`/márgenes + alignment `\an`) y del tamaño de fuente del
// estilo referenciado × la longitud del texto (misma cota conservadora de glyph advance que usa el
// generador). NO se lee ningún box precomputado: si el generador coloca un `\pos` con texto demasiado
// ancho, este check lo estima ancho y lo marca fuera — que es justo lo que un verificador debe hacer
// (media-composition.md §asserts 3). El ancla sola no basta: un texto centrado tiene el ancla trivialmente
// dentro aunque el texto se desborde por los lados.
import { parseAssDialogues, type AssDialogue, type AssStyle } from './ass-parser';
import {
  estimateTextWidth,
  LINE_HEIGHT_RATIO,
  PLAY_RES_X,
  PLAY_RES_Y,
  SAFE_ZONE_UNIVERSAL,
} from './ass-generator';

export interface SafeZoneBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** El área útil universal sobre 1080×1920 (Apéndice C): x ∈ [65, 940], y ∈ [270, 1248]. */
export const SAFE_ZONE_BOX_UNIVERSAL: SafeZoneBox = {
  minX: SAFE_ZONE_UNIVERSAL.left,
  maxX: PLAY_RES_X - SAFE_ZONE_UNIVERSAL.right,
  minY: SAFE_ZONE_UNIVERSAL.top,
  maxY: PLAY_RES_Y - SAFE_ZONE_UNIVERSAL.bottom,
};

export interface SafeZoneViolation {
  dialogueIndex: number;
  startMs: number;
  endMs: number;
  bbox: SafeZoneBox;
  reason: string;
}

/**
 * Estima el bounding box de un evento en coordenadas PlayRes a partir de su posición DECLARADA y del
 * tamaño de fuente del estilo. Soporta el layout que emite T5.4: alignment 2 (bottom-center) con `\pos`
 * en el punto de ancla inferior-central. Para otros alignments hace una estimación razonable (el punto
 * de ancla + extensión según el numpad). El box es una SOBRESTIMACIÓN (glyph advance alto).
 */
export function estimateDialogueBox(d: AssDialogue, style: AssStyle): SafeZoneBox {
  const fontSize = style.fontSize;
  const lineHeight = Math.round(fontSize * LINE_HEIGHT_RATIO);
  const nLines = Math.max(1, d.lines.length);
  const blockHeight = lineHeight * nLines;
  const widest = Math.max(...d.lines.map((l) => estimateTextWidth(l, fontSize)), 0);

  const align = d.alignment !== 0 ? d.alignment : style.alignment;
  const { x, y } = d.anchor;

  // Numpad ASS: 1-3 = bottom, 4-6 = middle, 7-9 = top; 1/4/7 = left, 2/5/8 = center, 3/6/9 = right.
  const vBand = align <= 3 ? 'bottom' : align <= 6 ? 'middle' : 'top';
  const hBand = align % 3 === 1 ? 'left' : align % 3 === 2 ? 'center' : 'right';

  let minX: number;
  let maxX: number;
  if (hBand === 'center') {
    minX = Math.round(x - widest / 2);
    maxX = Math.round(x + widest / 2);
  } else if (hBand === 'left') {
    minX = x;
    maxX = Math.round(x + widest);
  } else {
    minX = Math.round(x - widest);
    maxX = x;
  }

  let minY: number;
  let maxY: number;
  if (vBand === 'bottom') {
    minY = y - blockHeight;
    maxY = y;
  } else if (vBand === 'middle') {
    minY = Math.round(y - blockHeight / 2);
    maxY = Math.round(y + blockHeight / 2);
  } else {
    minY = y;
    maxY = y + blockHeight;
  }

  return { minX, minY, maxX, maxY };
}

/** ¿Cabe el bounding box ESTIMADO del evento dentro de la safe zone? Devuelve la lista de violaciones
 *  (vacía = ok). Toma los eventos ya parseados (para reutilizar un parseo previo del QA). */
export function findSafeZoneViolations(
  dialogues: AssDialogue[],
  zone: SafeZoneBox = SAFE_ZONE_BOX_UNIVERSAL,
): SafeZoneViolation[] {
  const violations: SafeZoneViolation[] = [];
  dialogues.forEach((d, i) => {
    const bbox = estimateDialogueBox(d, d.style);
    const reasons: string[] = [];
    if (bbox.minX < zone.minX) reasons.push(`left ${String(bbox.minX)} < ${String(zone.minX)}`);
    if (bbox.maxX > zone.maxX) reasons.push(`right ${String(bbox.maxX)} > ${String(zone.maxX)}`);
    if (bbox.minY < zone.minY) reasons.push(`top ${String(bbox.minY)} < ${String(zone.minY)}`);
    if (bbox.maxY > zone.maxY) reasons.push(`bottom ${String(bbox.maxY)} > ${String(zone.maxY)}`);
    if (reasons.length > 0) {
      violations.push({
        dialogueIndex: i,
        startMs: d.startMs,
        endMs: d.endMs,
        bbox,
        reason: reasons.join('; '),
      });
    }
  });
  return violations;
}

/** Conveniencia para el QA/script: parsea el `.ass` y devuelve las violaciones en un paso. */
export function checkAssSafeZone(ass: string, zone?: SafeZoneBox): SafeZoneViolation[] {
  return findSafeZoneViolations(parseAssDialogues(ass), zone);
}
