// Unit test (GATE, worker:unit — SIN ffmpeg) del merge de word timestamps por-segmento y del generador ASS
// de toda la variante (T5.5). Es CÓDIGO DE PRODUCCIÓN (el pase final lo cablea como el `CaptionAssGenerator`
// inyectado): que los offsets acumulados sean correctos es load-bearing (un offset mal calculado quema los
// subtítulos desincronizados del máster concatenado). El test parsea el `.ass` resultante con el parser de
// producción (`parseAssDialogues`) y verifica que los tiempos de los eventos caen en la ventana OFFSETeada,
// no en la local del segmento — sin reimplementar el formato (principio 9).
import { makeWordTimestamps } from '@ugc/test-utils';
import type { CompositionSpec } from '@ugc/core/contracts';
import { newUlid } from '@ugc/core/contracts';
import { describe, expect, test } from 'vitest';

import { AssGenerationError } from './ass-generator';
import { parseAssDialogues } from './ass-parser';
import { combineSegmentWordTimestamps, generateVariantAss } from './variant-ass';

describe('combineSegmentWordTimestamps', () => {
  test('offsetea cada segmento por su inicio acumulado y concatena en orden', () => {
    // Seg 0: palabras en [0, 1]. Seg 1: palabras en [0, 1] locales → deben quedar en [5, 6] con offset 5.
    const seg0 = makeWordTimestamps({ onsets: [0, 0.5], texts: ['hola', 'mundo'] });
    const seg1 = makeWordTimestamps({ onsets: [0, 0.5], texts: ['adios', 'tierra'] });
    const combined = combineSegmentWordTimestamps([seg0, seg1], [0, 5]);
    expect(combined.words).toHaveLength(4);
    expect(combined.words[0]?.start).toBe(0);
    expect(combined.words[2]?.text).toBe('adios');
    expect(combined.words[2]?.start).toBe(5); // 0 local + offset 5
    expect(combined.words[3]?.start).toBe(5.5); // 0.5 local + offset 5
  });

  test('un segmento sin voWords (undefined) se omite del merge', () => {
    const seg0 = makeWordTimestamps({ onsets: [0], texts: ['solo'] });
    const combined = combineSegmentWordTimestamps([seg0, undefined], [0, 3]);
    expect(combined.words).toHaveLength(1);
    expect(combined.words[0]?.text).toBe('solo');
  });

  test('preserva los tiempos null (spacing) sin ofsetearlos a un número', () => {
    const seg = makeWordTimestamps({ onsets: [0, 0.5], withNonWords: true });
    const combined = combineSegmentWordTimestamps([seg], [10]);
    const spacings = combined.words.filter((w) => w.type === 'spacing');
    expect(spacings.length).toBeGreaterThan(0);
    for (const s of spacings) expect(s.start).toBeNull();
    // Las palabras SÍ se ofsetean.
    const firstWord = combined.words.find((w) => w.type === 'word');
    expect(firstWord?.start).toBe(10);
  });

  test('lanza si ningún segmento trae voWords', () => {
    expect(() => combineSegmentWordTimestamps([undefined, undefined], [0, 3])).toThrow(
      AssGenerationError,
    );
  });

  test('lanza si el nº de offsets no casa con el nº de segmentos', () => {
    const seg = makeWordTimestamps({ words: 2 });
    expect(() => combineSegmentWordTimestamps([seg], [0, 3])).toThrow(AssGenerationError);
  });
});

describe('generateVariantAss', () => {
  function specWithCaptions(): CompositionSpec {
    // 2 segmentos, cada uno con voWords locales en [0, ~0.8]. Vídeos de 3 s cada uno.
    const seg0Words = makeWordTimestamps({ onsets: [0, 0.4], texts: ['primer', 'hook'] });
    const seg1Words = makeWordTimestamps({ onsets: [0, 0.4], texts: ['segundo', 'cta'] });
    return {
      segments: [
        { type: 'hook', videoAssets: [newUlid()], voAudio: newUlid(), voWords: seg0Words },
        { type: 'cta', videoAssets: [newUlid()], voAudio: newUlid(), voWords: seg1Words },
      ],
      music: null,
      output: { width: 1080, height: 1920, fps: 30, maxDurationS: 30 },
      captions: {
        style: 'karaoke',
        maxWordsPerPage: 2,
        platform: 'universal',
        position: 'safe_zone',
      },
    };
  }

  test('genera un `.ass` cuyos eventos del 2º segmento caen tras la duración del 1º (offset acumulado)', () => {
    const spec = specWithCaptions();
    // Segmentos de 3 s cada uno → el 2º segmento arranca en el segundo 3.
    const ass = generateVariantAss(spec, [3, 3]);
    const dialogues = parseAssDialogues(ass);
    expect(dialogues.length).toBeGreaterThan(0);
    // Hay eventos DESPUÉS del segundo 3 (las palabras del 2º segmento, offseteadas). Sin el offset, todos
    // los eventos caerían en [0, ~1] y ninguno superaría los 3 s.
    const lateEvents = dialogues.filter((d) => d.startMs >= 3000);
    expect(lateEvents.length).toBeGreaterThan(0);
    // Y hay eventos tempranos (el 1º segmento, sin offset).
    const earlyEvents = dialogues.filter((d) => d.startMs < 1000);
    expect(earlyEvents.length).toBeGreaterThan(0);
  });

  test('lanza si la variante no declara captions', () => {
    const spec = specWithCaptions();
    const noCap: CompositionSpec = { ...spec, captions: null };
    expect(() => generateVariantAss(noCap, [3, 3])).toThrow(AssGenerationError);
  });

  test('lanza si el nº de duraciones no casa con el nº de segmentos', () => {
    const spec = specWithCaptions();
    expect(() => generateVariantAss(spec, [3])).toThrow(AssGenerationError);
  });
});
