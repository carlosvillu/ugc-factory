// Factory de WordTimestamps sintéticos (T5.4, media-composition.md §"Subtítulos ASS"): fabrica un
// `WordTimestamps` VÁLIDO según su schema Zod (T4.5) con onsets EXACTOS y conocidos, para el assert de
// sincronía karaoke ±100 ms del generador ASS. El generador es su consumidor: alimentarlo con onsets
// que controlamos permite afirmar que el highlight `\k` cae donde debe.
//
// GOTCHA que este helper materializa: `start`/`end` van en SEGUNDOS (como el ASR real). El generador los
// convierte a centisegundos para el tag `\k`. Aquí exponemos los onsets en segundos y en ms para que el
// test pueda comparar contra el timestamp de verdad sin recalcularlo.
import type { AsrWord, WordTimestamps } from '@ugc/core/generation';

export interface MakeWordTimestampsOptions {
  /** Nº de palabras `type:'word'` a generar (default 12). */
  words?: number;
  /** Duración por palabra en segundos (default 0.4). El onset de la palabra i es `i * secondsPerWord`. */
  secondsPerWord?: number;
  /** Onsets EXACTOS por palabra en segundos. Si se pasa, `words` se ignora y hay una palabra por onset.
   *  El `end` de cada palabra es el `start` de la siguiente (o `start + secondsPerWord` en la última). */
  onsets?: number[];
  /** Textos por palabra. Default `w0 w1 …`. Debe cuadrar con la longitud efectiva si se pasa. */
  texts?: string[];
  /** Si true, intercala entradas `spacing`/`audio_event` (sin tiempos) entre palabras — para probar que
   *  el generador las FILTRA antes de paginar (mismo criterio que computeWordCoverage). */
  withNonWords?: boolean;
  /** `language_code` del ASR (p. ej. 'eng', 'rus'). Solo metadatos; el fallback de fuente se decide por
   *  el SCRIPT del texto, no por este campo. */
  languageCode?: string;
}

/**
 * Construye un `WordTimestamps` sintético con onsets exactos. Ejemplos:
 *   makeWordTimestamps({ words: 40 })                       // 40 palabras a 0,4 s cada una
 *   makeWordTimestamps({ onsets: [0, 0.5, 1.2] })           // onsets controlados al milisegundo
 *   makeWordTimestamps({ texts: ['Привет', 'мир'] })        // cirílico → activa el fallback de fuente
 */
export function makeWordTimestamps(opts: MakeWordTimestampsOptions = {}): WordTimestamps {
  const secondsPerWord = opts.secondsPerWord ?? 0.4;
  const onsets =
    opts.onsets ??
    Array.from({ length: opts.texts?.length ?? opts.words ?? 12 }, (_, i) => i * secondsPerWord);

  const count = opts.texts?.length ?? onsets.length;
  const texts = opts.texts ?? Array.from({ length: count }, (_, i) => `w${String(i)}`);

  const words: AsrWord[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = onsets[i] ?? i * secondsPerWord;
    const next = onsets[i + 1];
    const end = i + 1 < count && next !== undefined ? next : start + secondsPerWord;
    words.push({ text: texts[i] ?? `w${String(i)}`, start, end, type: 'word', speaker_id: null });
    if (opts.withNonWords) {
      // Un `spacing` sin tiempos entre palabras: el generador DEBE ignorarlo (no es una palabra).
      words.push({ text: ' ', start: null, end: null, type: 'spacing', speaker_id: null });
    }
  }

  return {
    text: texts.join(' '),
    ...(opts.languageCode !== undefined ? { language_code: opts.languageCode } : {}),
    words,
  };
}
