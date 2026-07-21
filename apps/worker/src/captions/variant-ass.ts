// MERGE de los word timestamps por-segmento del máster + generación del `.ass` de TODA la variante (T5.5,
// §9.7 N8 burn-in). CÓDIGO DE PRODUCCIÓN, lógica pura (sin red/disco/ffmpeg): lo consume el pase final del
// worker (el executor de render cablea `generateVariantAss` como el `CaptionAssGenerator` que `composeVariant`
// de @ugc/services inyecta — services NO puede importar de apps/worker, así que la dependencia va por
// inyección, gemela de `resolveAssetKey`/`runner`).
//
// POR QUÉ AQUÍ y no en el generador base (`ass-generator.ts`): `generateAss` opera sobre UN `WordTimestamps`
// (un voiceover). El máster CONCATENA los voiceovers de sus segmentos en orden (composeMaster concatena las
// voces back-to-back), así que los timestamps de cada segmento hay que OFFSETearlos por el inicio acumulado
// del segmento en el máster antes de fundirlos en una sola transcripción. Ese merge es la pieza que faltaba
// entre "N voiceovers con tiempos locales" y "un `.ass` con tiempos del máster".
//
// INVARIANTE (T5.3 media test): por segmento, la voz dura lo mismo que su vídeo. Por eso el offset de un
// segmento = suma de las duraciones de VÍDEO de los segmentos anteriores (las que el pase final mide con
// ffprobe sobre los clips normalizados). No se re-mide la voz: el contrato de composeMaster ya asume
// voz==vídeo por segmento (un desajuste sería un bug de T5.2/T5.3, no algo que el subtitulador tape).
import type { CompositionSpec } from '@ugc/core/contracts';
import type { WordTimestamps, AsrWord } from '@ugc/core/generation';

import { generateAss, AssGenerationError, type GenerateAssOptions } from './ass-generator';

/**
 * FUNDE los word timestamps de N segmentos en UNA transcripción con los tiempos del máster. Cada segmento
 * aporta su `voWords` (tiempos locales, en segundos desde el inicio de SU voiceover); se OFFSETean por
 * `offsetsS[i]` (el inicio acumulado del segmento i en el máster) y se concatenan en orden. Los elementos
 * sin tiempos (spacing/audio_event con start/end null) se offsetean solo si tienen tiempo (null se preserva).
 *
 * Pura y determinista. LANZA `AssGenerationError` si ningún segmento trae `voWords` (no hay nada que quemar
 * — el caller debería no pedir captions en ese caso; se falla ruidoso en vez de emitir un `.ass` vacío).
 */
export function combineSegmentWordTimestamps(
  perSegmentVoWords: readonly (WordTimestamps | undefined)[],
  offsetsS: readonly number[],
): WordTimestamps {
  if (perSegmentVoWords.length !== offsetsS.length) {
    throw new AssGenerationError(
      `combineSegmentWordTimestamps: ${String(perSegmentVoWords.length)} segmentos pero ${String(offsetsS.length)} offsets`,
    );
  }
  const mergedWords: AsrWord[] = [];
  const texts: string[] = [];
  perSegmentVoWords.forEach((wt, i) => {
    if (wt === undefined) return;
    const offset = offsetsS[i] ?? 0;
    texts.push(wt.text);
    for (const w of wt.words) {
      mergedWords.push({
        ...w,
        start: w.start === null ? null : w.start + offset,
        end: w.end === null ? null : w.end + offset,
      });
    }
  });
  if (mergedWords.length === 0) {
    throw new AssGenerationError(
      'combineSegmentWordTimestamps: ningún segmento trae voWords (nada que subtitular)',
    );
  }
  return { text: texts.join(' '), words: mergedWords };
}

/**
 * Genera el `.ass` de TODA la variante desde su `CompositionSpec` + las duraciones de vídeo de sus
 * segmentos (medidas por el pase final con ffprobe). Funde los `voWords` por-segmento con offsets
 * acumulados y llama al generador base con el preset/plataforma del `spec.captions`. Pura.
 *
 * PRECONDICIÓN: `spec.captions` no es null/undefined (el caller solo llama aquí cuando la variante lleva
 * captions). `segmentVideoDurationsS[i]` = duración del clip de vídeo del segmento i. El offset del
 * segmento i = suma de las duraciones de los i anteriores.
 */
export function generateVariantAss(
  spec: CompositionSpec,
  segmentVideoDurationsS: readonly number[],
): string {
  const captions = spec.captions;
  if (captions === null || captions === undefined) {
    throw new AssGenerationError('generateVariantAss: la variante no declara captions');
  }
  if (segmentVideoDurationsS.length !== spec.segments.length) {
    throw new AssGenerationError(
      `generateVariantAss: ${String(spec.segments.length)} segmentos pero ${String(segmentVideoDurationsS.length)} duraciones`,
    );
  }
  // Offset acumulado: el segmento i empieza tras la suma de las duraciones de vídeo de los i anteriores.
  const offsetsS: number[] = [];
  let acc = 0;
  for (const d of segmentVideoDurationsS) {
    offsetsS.push(acc);
    acc += d;
  }
  const combined = combineSegmentWordTimestamps(
    spec.segments.map((s) => s.voWords),
    offsetsS,
  );
  const opts: GenerateAssOptions = {
    preset: captions.style,
    platform: captions.platform,
    maxWordsPerPage: captions.maxWordsPerPage,
  };
  return generateAss(combined, opts);
}
