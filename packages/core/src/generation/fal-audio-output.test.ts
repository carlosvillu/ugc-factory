// Contrato del output de audio (TTS) de fal (T4.5, §13.1). Valida contra el output TTS REAL capturado
// en vivo (kokoro → {audio:{url,content_type,file_name,file_size}}). El [verificar] per-model se cierra
// AQUÍ para kokoro: el output NO trae word timestamps nativos → la cadena ASR es la ruta por defecto.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { extractAudioOutput } from './fal-audio-output';

const REAL_TTS = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/fal-asr/kokoro-en-tts.json'), 'utf8'),
) as Record<string, unknown>;

describe('extractAudioOutput — output TTS real de fal (T4.5)', () => {
  it('el output real de kokoro pasa el schema y trae audio.url', () => {
    const out = extractAudioOutput(REAL_TTS);
    expect(out).not.toBeNull();
    expect(out?.audio.url).toMatch(/^https:/);
    expect(out?.audio.content_type).toBe('audio/wav');
  });

  it('[verificar] kokoro NO emite word timestamps nativos → ASR es la ruta por defecto (§13.1)', () => {
    // El output real capturado NO tiene `words`/`timestamps` a ningún nivel: la única señal es el
    // fichero de audio. Este assert DOCUMENTA y protege contra regresión el resultado observado del
    // [verificar] per-model para kokoro (el que cierra la deuda en model_profile/PRD §13.1).
    expect('words' in REAL_TTS).toBe(false);
    expect('timestamps' in REAL_TTS).toBe(false);
  });

  it('CONTROL NEGATIVO: un output de IMAGEN (images[]) NO valida como audio', () => {
    expect(extractAudioOutput({ images: [{ url: 'x' }] })).toBeNull();
    expect(extractAudioOutput({ audio: {} })).toBeNull(); // sin url
    expect(extractAudioOutput(null)).toBeNull();
  });
});
