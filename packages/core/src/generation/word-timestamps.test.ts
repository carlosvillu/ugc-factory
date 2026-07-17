// Contrato de word timestamps del ASR (T4.5, §13.1). Estos tests VALIDAN contra el output ASR REAL
// capturado en vivo (packages/core/test/fixtures/fal-asr/kokoro-en-asr.json) — NO contra un shape
// inventado (el fallo de T4.2: un schema que solo se valida contra sí mismo va verde y no prueba
// nada). Codifican las cláusulas DETERMINISTAS de la Verificación de T4.5 (regla de trabajo 8):
//  · el output real de `fal-ai/elevenlabs/speech-to-text` PASA `WordTimestampsSchema`;
//  · cobertura del 100% de las palabras (`type:'word'` con start+end válidos);
//  · la duración se deriva del último `end` (kokoro no la emite — verificado en vivo).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  WordTimestampsSchema,
  extractWordTimestamps,
  computeWordCoverage,
  deriveDurationSeconds,
} from './word-timestamps';

/** El output ASR REAL capturado en vivo (kokoro TTS "The future belongs to those who work hard and
 *  dream big" → speech-to-text). Es el mismo JSON que el servicio sella en `asset.word_timestamps`. */
const REAL_ASR = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/fal-asr/kokoro-en-asr.json'), 'utf8'),
) as unknown;

describe('WordTimestampsSchema — valida el output ASR REAL de fal (T4.5)', () => {
  it('el output real de speech-to-text pasa el schema y trae 11 palabras con tiempos', () => {
    const wt = extractWordTimestamps(REAL_ASR);
    expect(wt).not.toBeNull();
    // El shape real: text + language_code + words[] con {text,start,end,type,speaker_id}.
    expect(wt?.text).toBe('The future belongs to those who work hard and dream big');
    expect(wt?.language_code).toBe('eng');
    const words = wt!.words.filter((w) => w.type === 'word');
    expect(words).toHaveLength(11);
    // Cada palabra REAL trae start+end no nulos (la premisa de la cobertura).
    expect(words.every((w) => w.start !== null && w.end !== null)).toBe(true);
  });

  it('CONTROL NEGATIVO: un output de IMAGEN (images[]) NO valida como word timestamps', () => {
    // Si el schema fuera laxo (p. ej. `words` opcional), un output equivocado pasaría y el servicio
    // sellaría basura. `images[]` sin `words` → null.
    expect(extractWordTimestamps({ images: [{ url: 'x' }] })).toBeNull();
    // Un ASR sin NINGUNA palabra (words:[]) es un output roto para una narración → rechazado por min(1).
    expect(extractWordTimestamps({ text: '', words: [] })).toBeNull();
    expect(extractWordTimestamps(null)).toBeNull();
  });

  it('acepta start/end null en spacing/audio_event (no son palabras) sin romper el schema', () => {
    const parsed = WordTimestampsSchema.safeParse({
      text: 'hi',
      words: [
        { text: 'hi', start: 0, end: 0.3, type: 'word', speaker_id: null },
        { text: ' ', start: null, end: null, type: 'spacing', speaker_id: null },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('computeWordCoverage — cobertura 100% (Entrega T4.5)', () => {
  it('el output real cubre el 100% de sus palabras', () => {
    const wt = extractWordTimestamps(REAL_ASR)!;
    const cov = computeWordCoverage(wt);
    expect(cov.wordCount).toBe(11);
    expect(cov.timedWordCount).toBe(11);
    expect(cov.fullyCovered).toBe(true);
    expect(cov.untimedWords).toEqual([]);
  });

  it('CONTROL NEGATIVO: una palabra con start/end null NO cuenta como cubierta', () => {
    // Reintroduce el bug que la cobertura debe cazar: una `word` sin tiempos. `fullyCovered` cae a
    // false y la palabra aparece en `untimedWords` (la evidencia). El drift ASR — spacing con null —
    // NO debe contaminar: solo las `word` cuentan.
    const wt = WordTimestampsSchema.parse({
      text: 'a b',
      words: [
        { text: 'a', start: 0, end: 0.2, type: 'word', speaker_id: null },
        { text: ' ', start: null, end: null, type: 'spacing', speaker_id: null },
        { text: 'b', start: null, end: null, type: 'word', speaker_id: null },
      ],
    });
    const cov = computeWordCoverage(wt);
    expect(cov.wordCount).toBe(2);
    expect(cov.timedWordCount).toBe(1);
    expect(cov.fullyCovered).toBe(false);
    expect(cov.untimedWords).toEqual(['b']);
  });

  it('CONTROL NEGATIVO: end < start (tiempos invertidos) NO cuenta como cubierta', () => {
    const wt = WordTimestampsSchema.parse({
      text: 'x',
      words: [{ text: 'x', start: 1.0, end: 0.5, type: 'word', speaker_id: null }],
    });
    const cov = computeWordCoverage(wt);
    expect(cov.fullyCovered).toBe(false);
    expect(cov.untimedWords).toEqual(['x']);
  });
});

describe('deriveDurationSeconds — la duración sale del ASR (kokoro no la emite)', () => {
  it('deriva la duración del último end del output real (3.179 s)', () => {
    const wt = extractWordTimestamps(REAL_ASR)!;
    expect(deriveDurationSeconds(wt)).toBeCloseTo(3.179, 3);
  });

  it('ignora los null (spacing sin tiempo) al buscar el máximo end', () => {
    const wt = WordTimestampsSchema.parse({
      text: 'a b',
      words: [
        { text: 'a', start: 0, end: 0.5, type: 'word', speaker_id: null },
        { text: ' ', start: null, end: null, type: 'spacing', speaker_id: null },
        { text: 'b', start: 0.5, end: 1.25, type: 'word', speaker_id: null },
      ],
    });
    expect(deriveDurationSeconds(wt)).toBe(1.25);
  });
});
