// Parseo del OUTPUT de un modelo de VÍDEO/AVATAR de fal (§7.2 N7c, T4.7) — LÓGICA PURA.
//
// Los modelos de avatar image+audio (`fal-ai/kling-video/ai-avatar/v2/standard`,
// `fal-ai/bytedance/omnihuman/v1.5`) devuelven `{ video: { url, content_type? }, duration? }` — un
// SOLO fichero de vídeo bajo `video`, con la `duration` del clip como campo HERMANO de `video` a NIVEL
// RAÍZ del output (NO anidada dentro de `video`, a diferencia de `{audio:{url,duration}}` de los TTS —
// confirmado 2026-07-17 vs los schemas de Kling/OmniHuman en fal.ai). El servicio necesita la URL para
// DESCARGAR el .mp4 a nuestro storage y la `duration` para `asset.duration_s` + el coste por segundo.
//
// Es Zod en la frontera (principio 4 de backend): un output que no encaje es un `FalResponseError` en
// el servicio, no un crash aguas abajo. NO se asume la forma — se valida. Espeja `fal-audio-output.ts`.
import { z } from 'zod';

/** El fichero de vídeo del output de un avatar de fal: URL descargable + (opcional) mime. La duración
 *  NO vive aquí (es hermana de `video` a nivel raíz, no un campo del fichero). */
const FalVideoFileSchema = z.object({
  url: z.string().min(1),
  content_type: z.string().optional(),
});

/**
 * El output de un modelo de avatar image+audio: un único fichero de vídeo bajo `video` + la `duration`
 * del clip (segundos) a NIVEL RAÍZ. `duration` es opcional: si el modelo no la emite, el servicio cae a
 * la duración del audio de entrada (`duración = audio automáticamente`). `seed`/otros campos se ignoran.
 */
const FalVideoOutputSchema = z.object({
  video: FalVideoFileSchema,
  duration: z.number().nonnegative().optional(),
});
export type FalVideoOutput = z.infer<typeof FalVideoOutputSchema>;

/**
 * Valida y extrae el output de vídeo (avatar) de fal. Devuelve `null` si no encaja (el servicio lo
 * mapea a `FalResponseError`: se pagó pero el contrato no se cumplió — rama de validación, NO de
 * proveedor). Nunca lanza.
 */
export function extractVideoOutput(output: unknown): FalVideoOutput | null {
  const parsed = FalVideoOutputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}
