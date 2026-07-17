// WORD TIMESTAMPS del ASR (§13.1, T4.5 · N7b) — CONTRATO + LÓGICA PURA de cobertura.
//
// §13.1 fija la RUTA POR DEFECTO de los word timestamps: NO vienen del TTS (kokoro/elevenlabs no
// los emiten — confirmado en vivo 2026-07-16: el output de kokoro es solo `{audio:{url}}`), sino de
// un ASR encadenado (`fal-ai/elevenlabs/speech-to-text`) sobre el audio TTS ya generado.
//
// EL SHAPE SE CONSTRUYE DESDE EL OUTPUT ASR REAL, capturado en vivo (disciplina anti-arnés, evita el
// verde-auto-consistente de T4.2). La captura (packages/core/test/fixtures/fal-asr/kokoro-en-asr.json)
// mostró EXACTAMENTE:
//   { text, language_code, language_probability, words: [{ text, start, end, type, speaker_id }] }
// donde `type ∈ {word, spacing, audio_event}`. Observaciones que el schema codifica:
//   · las entradas `type:'word'` SIEMPRE traen `start`/`end` no nulos (los son en segundos);
//   · las entradas `spacing`/`audio_event` PUEDEN traer `start`/`end` = null (no son palabras) →
//     por eso `start`/`end` son nullable en el schema y la cobertura solo exige tiempos en las WORD;
//   · NO hay campo de duración a nivel raíz → la duración del voiceover se DERIVA del último `end`.
import { z } from 'zod';

/** El tipo de un elemento de la transcripción ASR (verificado en vivo: `word`/`spacing`; la doc
 *  añade `audio_event`). No es un enum CERRADO: si fal introduce un tipo nuevo, un enum estricto
 *  reventaría la validación de un output por lo demás sano — se acepta el string y la cobertura solo
 *  mira los `word`. */
const AsrWordSchema = z.object({
  text: z.string(),
  /** Segundos desde t=0. Nullable: `spacing`/`audio_event` pueden no tener tiempos. */
  start: z.number().nonnegative().nullable(),
  end: z.number().nonnegative().nullable(),
  type: z.string(),
  /** `speaker_id` de diarización; null cuando `diarize:false`. */
  speaker_id: z.string().nullable().optional(),
});
export type AsrWord = z.infer<typeof AsrWordSchema>;

/**
 * El output del ASR (`fal-ai/elevenlabs/speech-to-text`), validado desde el shape REAL. Es lo que
 * el servicio SELLA en `asset.word_timestamps` (jsonb). Un output que no encaje → `FalResponseError`
 * (se pagó el ASR pero el contrato no se cumplió), no un crash aguas abajo.
 */
export const WordTimestampsSchema = z.object({
  /** La transcripción completa (para depurar; el subtitulador de F5 usa `words`). */
  text: z.string(),
  language_code: z.string().optional(),
  language_probability: z.number().optional(),
  /** Los elementos con tiempo. `.min(1)`: un ASR que no devuelve NINGÚN elemento sobre un audio con
   *  habla es un output roto (el `[verificar]` exige cobertura del 100% de las palabras — no puede
   *  haber 0 palabras para una narración `min(1)`). */
  words: z.array(AsrWordSchema).min(1),
});
export type WordTimestamps = z.infer<typeof WordTimestampsSchema>;

/**
 * Valida y extrae el output de word timestamps del ASR. Devuelve `null` si no encaja (el servicio lo
 * mapea a `FalResponseError`). Nunca lanza. Espeja `extractImageOutput`/`extractAudioOutput`.
 */
export function extractWordTimestamps(output: unknown): WordTimestamps | null {
  const parsed = WordTimestampsSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

/** El veredicto de cobertura: cuántas de las WORD del ASR tienen tiempos válidos y cuáles fallan. */
export interface WordCoverage {
  /** Nº de elementos `type:'word'`. */
  wordCount: number;
  /** Nº de `word` con `start` Y `end` no nulos y `end >= start`. */
  timedWordCount: number;
  /** true ⇔ TODAS las `word` tienen tiempos válidos (la Entrega: "cubren el 100% de las palabras"). */
  fullyCovered: boolean;
  /** Los `text` de las `word` SIN tiempos válidos (la evidencia del fallo de cobertura). */
  untimedWords: string[];
}

/**
 * COBERTURA DEL 100% (Entrega T4.5). La invariante se mide contra la SEGMENTACIÓN DEL ASR, no contra
 * los tokens de la narración original: el ASR re-segmenta y re-escribe (drift ASR-vs-narración), así
 * que un match 1:1 con el texto original marcaría rojo un output legítimo. Lo que se exige es que
 * cada palabra que EL ASR EMITE (`type:'word'`) lleve un `start`+`end` válidos — sin eso, el
 * subtitulador de F5 no puede colocar esa palabra en la timeline. Lógica PURA (sin red, testeable).
 */
export function computeWordCoverage(wt: WordTimestamps): WordCoverage {
  const words = wt.words.filter((w) => w.type === 'word');
  const untimedWords: string[] = [];
  let timedWordCount = 0;
  for (const w of words) {
    const valid = w.start !== null && w.end !== null && w.end >= w.start;
    if (valid) timedWordCount += 1;
    else untimedWords.push(w.text);
  }
  return {
    wordCount: words.length,
    timedWordCount,
    fullyCovered: words.length > 0 && untimedWords.length === 0,
    untimedWords,
  };
}

/**
 * Duración del voiceover en SEGUNDOS, derivada del ASR (el TTS de kokoro no la emite — verificado en
 * vivo). Es el mayor `end` de las PALABRAS (`type:'word'`) — el MISMO filtro que `computeWordCoverage`,
 * para que ambas funciones coincidan en qué es "una palabra": un `spacing`/`audio_event` final (p. ej.
 * un silencio o un aplauso etiquetado tras la última palabra) no debe inflar la duración del voiceover.
 * Se usa para (a) `asset.duration_s` y (b) el coste del ASR. Devuelve 0 si ninguna palabra tiene `end`
 * (output degenerado — el caller ya habrá exigido cobertura, pero el número nunca es NaN/negativo).
 */
export function deriveDurationSeconds(wt: WordTimestamps): number {
  let maxEnd = 0;
  for (const w of wt.words) {
    if (w.type === 'word' && w.end !== null && w.end > maxEnd) maxEnd = w.end;
  }
  return maxEnd;
}
