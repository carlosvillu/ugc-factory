// Parseo del OUTPUT de un modelo de TTS de fal (§13.1, T4.5 · N7b) — LÓGICA PURA.
//
// `fal-ai/kokoro` (y los TTS de elevenlabs) devuelven `{ audio: { url, content_type?,
// duration? } }` — un SOLO fichero de audio, NO un array (a diferencia de los modelos de
// imagen). Confirmado 2026-07-16 en el openapi de `fal-ai/kokoro`: `KokoroOutput.audio` es
// un `File` con `url`; NO trae word timestamps (esos vienen del ASR encadenado, §13.1 ruta
// por defecto). El servicio necesita la URL para DESCARGAR el .wav a nuestro storage.
//
// Es Zod en la frontera (principio 4 de backend): un output que no encaje es un
// `FalResponseError` en el servicio, no un crash aguas abajo. NO se asume la forma — se valida.
import { z } from 'zod';

/** El fichero de audio del output de un TTS de fal: URL descargable + (opcional) mime y duración.
 *  `duration` NO está garantizada por todos los TTS (kokoro no la documenta) → opcional; la duración
 *  autoritativa del voiceover la deriva el servicio del último `end` de los word timestamps del ASR. */
const FalAudioFileSchema = z.object({
  url: z.string().min(1),
  content_type: z.string().optional(),
  duration: z.number().nonnegative().optional(),
});

/** El output de un modelo TTS: un único fichero de audio bajo `audio`. `seed`/`timings`/etc. se ignoran. */
const FalAudioOutputSchema = z.object({
  audio: FalAudioFileSchema,
});
export type FalAudioOutput = z.infer<typeof FalAudioOutputSchema>;

/**
 * Valida y extrae el output de audio (TTS) de fal. Devuelve `null` si no encaja (el servicio lo
 * mapea a `FalResponseError`: se pagó pero el contrato no se cumplió — rama de validación, NO de
 * proveedor). Nunca lanza.
 */
export function extractAudioOutput(output: unknown): FalAudioOutput | null {
  const parsed = FalAudioOutputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}
